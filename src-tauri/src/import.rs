//! Import di una struttura testuale (**Markdown** o **OPML**) in argomenti
//! della mappa.
//!
//! I parser sono volutamente minimali e senza dipendenze: leggono solo la
//! struttura (titoli di primo livello, liste annidate, `<outline>`) e le
//! convenzioni scritte da `crate::export`. Le equazioni `$…$` vengono
//! trasformate in equazioni native dal chiamante (serve il renderer MathJax).

use crate::error::{ErrorPayload, CODE_FORMAT};
use crate::model::{Children, Topic};
use std::collections::HashMap;

/// Nodo intermedio fra il testo e il modello: albero di argomenti.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct OutlineNode {
    pub title: String,
    pub latex: Option<String>,
    pub notes: Option<String>,
    pub labels: Vec<String>,
    pub children: Vec<OutlineNode>,
}

/// Parsa il testo nel formato indicato (`"markdown"`/`"opml"`).
pub fn parse(format: &str, text: &str) -> Result<OutlineNode, ErrorPayload> {
    let root = match format {
        "markdown" => parse_markdown(text),
        "opml" => parse_opml(text),
        other => {
            return Err(ErrorPayload::new(
                CODE_FORMAT,
                format!("formato non supportato: {other}"),
            ))
        }
    };
    if root.children.is_empty() && root.title.is_empty() && root.latex.is_none() {
        return Err(ErrorPayload::new(
            CODE_FORMAT,
            "Nessun argomento riconosciuto nel file.",
        ));
    }
    Ok(root)
}

/// Costruisce un `Topic` (con id nuovi ed eventuali equazioni) dall'albero.
/// `render` applica l'equazione in place, come `equation::apply_equation`.
pub fn node_to_topic<F>(node: &OutlineNode, render: &mut F) -> Result<Topic, ErrorPayload>
where
    F: FnMut(&mut Topic, &str) -> Result<(), ErrorPayload>,
{
    let mut topic = Topic {
        id: Some(crate::edit::new_topic_id()),
        title: Some(node.title.clone()),
        ..Default::default()
    };
    if let Some(latex) = node.latex.as_deref() {
        render(&mut topic, latex)?;
    }
    if let Some(notes) = node.notes.as_deref() {
        crate::edit::set_notes(&mut topic, notes);
    }
    if !node.labels.is_empty() {
        crate::edit::set_labels(&mut topic, &node.labels);
    }
    if !node.children.is_empty() {
        let mut attached = Vec::with_capacity(node.children.len());
        for child in &node.children {
            attached.push(node_to_topic(child, render)?);
        }
        topic.children = Some(Children {
            attached: Some(attached),
            ..Default::default()
        });
    }
    Ok(topic)
}

// ------------------------------------------------------------------ Markdown

/// Legge un sottoinsieme di Markdown: il primo `#` è il titolo della radice,
/// le liste annidate diventano alberi, `>` note, `$…$` equazioni e
/// `` `…` `` etichette (come prodotte da `export::to_markdown`).
pub fn parse_markdown(text: &str) -> OutlineNode {
    let mut arena: Vec<OutlineNode> = vec![OutlineNode::default()];
    let mut children: Vec<Vec<usize>> = vec![Vec::new()];
    let mut stack: Vec<(usize, usize)> = Vec::new();
    let mut last: Option<usize> = None;
    let mut root_title = String::new();
    let mut root_notes: Vec<String> = Vec::new();
    let mut root_latex = None;
    let mut root_labels: Vec<String> = Vec::new();
    let mut seen_heading = false;

    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();

        if let Some(heading) = trimmed.strip_prefix("# ") {
            if !seen_heading {
                root_title = heading.trim().to_string();
                seen_heading = true;
            }
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        if let Some(note) = trimmed.strip_prefix('>') {
            let note = note.trim_start().to_string();
            match last {
                Some(i) => match arena[i].notes.as_mut() {
                    Some(existing) => {
                        existing.push('\n');
                        existing.push_str(&note);
                    }
                    None => arena[i].notes = Some(note),
                },
                None => root_notes.push(note),
            }
            continue;
        }
        if let Some((indent, content)) = parse_bullet(line) {
            while let Some(&(parent_indent, _)) = stack.last() {
                if parent_indent >= indent {
                    stack.pop();
                } else {
                    break;
                }
            }
            let parent = stack.last().map(|&(_, i)| i).unwrap_or(0);
            let idx = arena.len();
            arena.push(parse_item(&content));
            children.push(Vec::new());
            children[parent].push(idx);
            stack.push((indent, idx));
            last = Some(idx);
            continue;
        }
        if last.is_none() {
            if let Some(latex) = bare_latex(trimmed) {
                root_latex = Some(latex);
                continue;
            }
            if let Some(labels) = bare_labels(trimmed) {
                root_labels = labels;
            }
        }
    }

    let mut root = assemble(&arena, &children, 0);
    root.title = root_title;
    root.latex = root_latex;
    if !root_notes.is_empty() {
        root.notes = Some(root_notes.join("\n"));
    }
    root.labels = root_labels;
    root
}

/// `(indent, contenuto)` per una riga di lista (`-`, `*`, `+`, `1.`).
fn parse_bullet(line: &str) -> Option<(usize, String)> {
    let mut indent = 0;
    let mut rest = line;
    loop {
        if let Some(r) = rest.strip_prefix(' ') {
            indent += 1;
            rest = r;
        } else if let Some(r) = rest.strip_prefix('\t') {
            indent += 4;
            rest = r;
        } else {
            break;
        }
    }
    let content = if let Some(r) = rest.strip_prefix("- ") {
        Some(r)
    } else if rest == "-" {
        Some("")
    } else if let Some(r) = rest.strip_prefix("* ") {
        Some(r)
    } else if rest == "*" {
        Some("")
    } else if let Some(r) = rest.strip_prefix("+ ") {
        Some(r)
    } else if rest == "+" {
        Some("")
    } else {
        let digits = rest.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 {
            let tail = &rest[digits..];
            if let Some(r) = tail.strip_prefix(". ") {
                Some(r)
            } else if tail == "." {
                Some("")
            } else {
                None
            }
        } else {
            None
        }
    }?;
    Some((indent, content.trim().to_string()))
}

fn parse_item(content: &str) -> OutlineNode {
    let (content, labels) = split_labels(content);
    let (title, latex) = split_latex(&content);
    OutlineNode {
        title,
        latex,
        notes: None,
        labels,
        children: Vec::new(),
    }
}

/// Stacca le etichette in coda (`` `a` `b` ``) dal testo.
fn split_labels(s: &str) -> (String, Vec<String>) {
    let mut rest = s.trim_end().to_string();
    let mut labels = Vec::new();
    loop {
        let trimmed = rest.trim_end();
        if !trimmed.ends_with('`') {
            break;
        }
        let Some(open) = trimmed[..trimmed.len() - 1].rfind('`') else {
            break;
        };
        let label = &trimmed[open + 1..trimmed.len() - 1];
        let before = &trimmed[..open];
        if label.is_empty() || !(before.is_empty() || before.ends_with(' ')) {
            break;
        }
        labels.push(label.to_string());
        rest = before.trim_end().to_string();
    }
    labels.reverse();
    (rest.trim().to_string(), labels)
}

/// `"Titolo $x$"` → `("Titolo", Some("x"))`; `"$x$"` → `("", Some("x"))`.
fn split_latex(s: &str) -> (String, Option<String>) {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('$') && s.ends_with('$') {
        let inner = &s[1..s.len() - 1];
        if !inner.is_empty() {
            return (String::new(), Some(inner.to_string()));
        }
    }
    if let Some(close) = s.rfind('$') {
        if let Some(open) = s[..close].rfind('$') {
            let before = &s[..open];
            if !before.is_empty() && before.ends_with(' ') && close > open + 1 {
                return (
                    before.trim().to_string(),
                    Some(s[open + 1..close].to_string()),
                );
            }
        }
    }
    (s.to_string(), None)
}

fn bare_latex(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('$') && s.ends_with('$') {
        let inner = &s[1..s.len() - 1];
        if !inner.is_empty() {
            return Some(inner.to_string());
        }
    }
    None
}

fn bare_labels(s: &str) -> Option<Vec<String>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let mut labels = Vec::new();
    for token in s.split_whitespace() {
        if token.len() >= 2 && token.starts_with('`') && token.ends_with('`') {
            labels.push(token[1..token.len() - 1].to_string());
        } else {
            return None;
        }
    }
    (!labels.is_empty()).then_some(labels)
}

// ---------------------------------------------------------------------- OPML

/// Legge un OPML: ogni `<outline>` è un argomento, annidato com'è nel file.
/// `text` è il titolo; `_note`, `_equation` e `_labels` sono le estensioni
/// scritte da `export::to_opml`.
pub fn parse_opml(text: &str) -> OutlineNode {
    let head_title = extract_tag_text(text, "title").unwrap_or_default();
    let mut arena: Vec<OutlineNode> = vec![OutlineNode::default()];
    let mut children: Vec<Vec<usize>> = vec![Vec::new()];
    let mut stack: Vec<usize> = Vec::new();
    let mut i = 0;

    while let Some(rel) = text[i..].find('<') {
        let start = i + rel;
        let Some(end) = find_tag_end(text, start) else {
            break;
        };
        let tag = &text[start + 1..end];
        i = end + 1;
        if tag.starts_with('?') || tag.starts_with('!') {
            continue;
        }
        if let Some(rest) = tag.strip_prefix('/') {
            if rest.split_whitespace().next() == Some("outline") {
                stack.pop();
            }
            continue;
        }
        let self_closing = tag.ends_with('/');
        let name = tag
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("");
        if name != "outline" {
            continue;
        }
        let attrs = parse_attrs(tag);
        let node = OutlineNode {
            title: attrs.get("text").cloned().unwrap_or_default(),
            latex: attrs.get("_equation").cloned().filter(|s| !s.is_empty()),
            notes: attrs.get("_note").cloned().filter(|s| !s.is_empty()),
            labels: attrs
                .get("_labels")
                .map(|s| {
                    s.split(',')
                        .map(|x| x.trim().to_string())
                        .filter(|x| !x.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            children: Vec::new(),
        };
        let parent = stack.last().copied().unwrap_or(0);
        let idx = arena.len();
        arena.push(node);
        children.push(Vec::new());
        children[parent].push(idx);
        if !self_closing {
            stack.push(idx);
        }
    }

    let mut root = assemble(&arena, &children, 0);
    root.title = head_title.trim().to_string();
    root
}

/// Indice di `>` che chiude il tag aperto in `start`, rispettando le virgolette.
fn find_tag_end(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut quote = 0u8;
    let mut i = start + 1;
    while i < bytes.len() {
        let b = bytes[i];
        if quote != 0 {
            if b == quote {
                quote = 0;
            }
        } else if b == b'"' || b == b'\'' {
            quote = b;
        } else if b == b'>' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Attributi `name="value"` di un tag (l'eventuale nome del tag è ignorato).
fn parse_attrs(tag: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let bytes = tag.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r' | b'/') {
            i += 1;
        }
        let name_start = i;
        while i < bytes.len() && !matches!(bytes[i], b'=' | b' ' | b'/' | b'>') {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let name = &tag[name_start..i];
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
                i += 1;
            }
            if i < bytes.len() && matches!(bytes[i], b'"' | b'\'') {
                let quote = bytes[i];
                i += 1;
                let value_start = i;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                let value = xml_unescape(&tag[value_start..i]);
                if i < bytes.len() {
                    i += 1;
                }
                if !name.is_empty() {
                    out.insert(name.to_string(), value);
                }
            }
        }
    }
    out
}

fn extract_tag_text(text: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let start = text.find(&open)?;
    let gt = start + text[start..].find('>')?;
    let close = format!("</{name}>");
    let end = gt + text[gt..].find(&close)?;
    Some(xml_unescape(text[gt + 1..end].trim()))
}

/// Decodifica le entità XML usate da OPML (`&amp;` e i riferimenti numerici).
pub fn xml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s.as_bytes()[i] == b'&' {
            if let Some(semi) = s[i..].find(';') {
                if let Some(ch) = decode_entity(&s[i + 1..i + semi]) {
                    out.push(ch);
                    i += semi + 1;
                    continue;
                }
            }
        }
        let ch = s[i..].chars().next().unwrap_or('\u{fffd}');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => {
            let digits = entity.strip_prefix('#')?;
            let code = if let Some(hex) = digits.strip_prefix(['x', 'X']) {
                u32::from_str_radix(hex, 16).ok()?
            } else {
                digits.parse::<u32>().ok()?
            };
            char::from_u32(code)
        }
    }
}

fn assemble(arena: &[OutlineNode], children: &[Vec<usize>], i: usize) -> OutlineNode {
    let mut node = arena[i].clone();
    node.children = children[i]
        .iter()
        .map(|&child| assemble(arena, children, child))
        .collect();
    node
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_builds_nested_tree_with_notes_and_equation() {
        let md = "# Logica\n\n> ripasso\n> esame\n\n$A \\cup B$\n\n- Insiemi `mate`\n  - Unione\n- Relazioni\n";
        let root = parse_markdown(md);
        assert_eq!(root.title, "Logica");
        assert_eq!(root.notes.as_deref(), Some("ripasso\nesame"));
        assert_eq!(root.latex.as_deref(), Some("A \\cup B"));
        assert_eq!(root.children.len(), 2);
        assert_eq!(root.children[0].title, "Insiemi");
        assert_eq!(root.children[0].labels, ["mate"]);
        assert_eq!(root.children[0].children[0].title, "Unione");
        assert_eq!(root.children[1].title, "Relazioni");
    }

    #[test]
    fn markdown_handles_inline_equation_and_ordered_lists() {
        let md = "# M\n\n- Teoria $x^2$\n1. Primo\n2. Secondo\n";
        let root = parse_markdown(md);
        assert_eq!(root.children[0].title, "Teoria");
        assert_eq!(root.children[0].latex.as_deref(), Some("x^2"));
        assert_eq!(root.children[1].title, "Primo");
        assert_eq!(root.children[2].title, "Secondo");
    }

    #[test]
    fn opml_parses_nesting_attrs_and_entities() {
        let opml = r#"<?xml version="1.0"?>
<opml version="2.0">
  <head><title>La mia &amp; mappa</title></head>
  <body>
    <outline text="Radice">
      <outline text="Figlio &lt;uno&gt;" _note="nota" _equation="x &gt; 1" _labels="a, b"/>
      <outline text="Secondo"/>
    </outline>
  </body>
</opml>"#;
        let root = parse_opml(opml);
        assert_eq!(root.title, "La mia & mappa");
        assert_eq!(root.children.len(), 1);
        let child = &root.children[0];
        assert_eq!(child.title, "Radice");
        assert_eq!(child.children.len(), 2);
        assert_eq!(child.children[0].title, "Figlio <uno>");
        assert_eq!(child.children[0].notes.as_deref(), Some("nota"));
        assert_eq!(child.children[0].latex.as_deref(), Some("x > 1"));
        assert_eq!(child.children[0].labels, ["a", "b"]);
        assert_eq!(child.children[1].title, "Secondo");
    }

    #[test]
    fn parse_rejects_empty_and_unsupported() {
        assert!(parse("opml", "<opml><body></body></opml>").is_err());
        assert!(parse("rtf", "x").is_err());
    }

    #[test]
    fn xml_unescape_numeric_entities() {
        assert_eq!(xml_unescape("a&#233;&#x41;b"), "aéAb");
        assert_eq!(xml_unescape("&amp;"), "&");
    }
}
