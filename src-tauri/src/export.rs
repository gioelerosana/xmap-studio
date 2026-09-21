//! Export testuale della mappa: **Markdown** e **OPML**.
//!
//! Non tocca lo schema `.xmind` né il disco (i byte li scrive il chiamante):
//! legge il modello già in memoria. Le equazioni diventano `$latex$`, le note
//! righe di citazione (`>`), le etichette segmenti `` `…` ``; i marker (icone)
//! non hanno una resa testuale sensata e vengono omessi.

use crate::model::{Sheet, Topic, CHILD_GROUPS};

/// Intera mappa in Markdown. Un `#` per sheet, poi una lista annidata di
/// argomenti a partire dai figli della radice (il titolo della radice fa da
/// intestazione).
pub fn to_markdown(sheets: &[Sheet]) -> String {
    let mut out = String::new();
    for sheet in sheets {
        let root = sheet.root_topic.as_ref();
        let heading = root
            .map(Topic::title_str)
            .filter(|t| !t.is_empty())
            .or_else(|| {
                let t = sheet.title_str();
                (!t.is_empty()).then_some(t)
            })
            .unwrap_or("Mappa");
        out.push_str("# ");
        out.push_str(&heading.replace('\n', " "));
        out.push_str("\n\n");

        if let Some(root) = root {
            write_preamble(root, &mut out);
            for group in CHILD_GROUPS {
                if let Some(children) = root.group(group) {
                    for child in children {
                        write_markdown_topic(child, 0, &mut out);
                    }
                }
            }
        }
        out.push('\n');
    }
    out
}

/// Note/equazione/etichette della radice, che non compare come bullet.
fn write_preamble(topic: &Topic, out: &mut String) {
    if let Some(notes) = topic.notes_text() {
        for line in notes.lines() {
            out.push_str("> ");
            out.push_str(line);
            out.push('\n');
        }
        out.push('\n');
    }
    if let Some(latex) = topic.latex() {
        out.push('$');
        out.push_str(&latex.replace('\n', " "));
        out.push_str("$\n\n");
    }
    if !topic.labels_list().is_empty() {
        out.push_str(&labels_line(topic));
        out.push_str("\n\n");
    }
}

fn write_markdown_topic(topic: &Topic, depth: usize, out: &mut String) {
    let indent = "  ".repeat(depth);
    out.push_str(&indent);
    out.push_str("- ");
    out.push_str(&topic_text(topic));
    out.push('\n');
    if let Some(notes) = topic.notes_text() {
        for line in notes.lines() {
            out.push_str(&indent);
            out.push_str("  > ");
            out.push_str(line);
            out.push('\n');
        }
    }
    for group in CHILD_GROUPS {
        if let Some(children) = topic.group(group) {
            for child in children {
                write_markdown_topic(child, depth + 1, out);
            }
        }
    }
}

/// Testo del bullet: titolo e/o `$latex$`, più le etichette come `` `x` ``.
fn topic_text(topic: &Topic) -> String {
    let title = topic.title_str().replace('\n', " ").trim().to_string();
    let mut text = match topic.latex() {
        Some(latex) => {
            if title.is_empty() {
                format!("${}$", latex.replace('\n', " "))
            } else {
                format!("{title} ${}$", latex.replace('\n', " "))
            }
        }
        None => title,
    };
    if !topic.labels_list().is_empty() {
        text.push(' ');
        text.push_str(&labels_line(topic));
    }
    text
}

fn labels_line(topic: &Topic) -> String {
    topic
        .labels_list()
        .iter()
        .map(|l| format!("`{}`", l.replace('`', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Intera mappa in OPML 2.0. Un `<outline>` per sheet, poi gli argomenti
/// annidati; note in `_note`, equazione in `_equation`, etichette in `_labels`.
pub fn to_opml(sheets: &[Sheet], title: &str) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<opml version=\"2.0\">\n  <head>\n    <title>");
    out.push_str(&xml_escape(title));
    out.push_str("</title>\n  </head>\n  <body>\n");
    for sheet in sheets {
        let root = sheet.root_topic.as_ref();
        let sheet_title = root
            .map(Topic::title_str)
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| sheet.title_str());
        out.push_str(&format!(
            "    <outline {}>\n",
            opml_attrs(sheet_title, root)
        ));
        if let Some(root) = root {
            for group in CHILD_GROUPS {
                if let Some(children) = root.group(group) {
                    for child in children {
                        write_opml_topic(child, 3, &mut out);
                    }
                }
            }
        }
        out.push_str("    </outline>\n");
    }
    out.push_str("  </body>\n</opml>\n");
    out
}

/// Attributi di un `<outline>`: `text` più note/equazione/etichette.
fn opml_attrs(text: &str, topic: Option<&Topic>) -> String {
    let mut attrs = format!("text=\"{}\"", xml_escape(text));
    if let Some(topic) = topic {
        if let Some(notes) = topic.notes_text() {
            attrs.push_str(&format!(" _note=\"{}\"", xml_escape(notes)));
        }
        if let Some(latex) = topic.latex() {
            attrs.push_str(&format!(" _equation=\"{}\"", xml_escape(latex)));
        }
        if !topic.labels_list().is_empty() {
            attrs.push_str(&format!(
                " _labels=\"{}\"",
                xml_escape(&topic.labels_list().join(", "))
            ));
        }
    }
    attrs
}

fn write_opml_topic(topic: &Topic, depth: usize, out: &mut String) {
    let indent = "  ".repeat(depth);
    let attrs = opml_attrs(topic.title_str(), Some(topic));
    let has_children = topic.all_children().next().is_some();
    if has_children {
        out.push_str(&format!("{indent}<outline {attrs}>\n"));
        for group in CHILD_GROUPS {
            if let Some(children) = topic.group(group) {
                for child in children {
                    write_opml_topic(child, depth + 1, out);
                }
            }
        }
        out.push_str(&format!("{indent}</outline>\n"));
    } else {
        out.push_str(&format!("{indent}<outline {attrs}/>\n"));
    }
}

/// Escaping XML per testo e attributi (`& < > " '`), in quest'ordine.
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sheets() -> Vec<Sheet> {
        serde_json::from_value(json!([
            {
                "id": "s",
                "title": "Studio",
                "rootTopic": {
                    "id": "r",
                    "title": "Logica",
                    "notes": {"plain": {"content": "ripasso\nesame"}},
                    "children": {
                        "attached": [
                            {"id": "a", "title": "Insiemi", "labels": ["mate"],
                             "children": {"attached": [{"id": "a1", "title": ""}]}},
                            {"id": "b", "title": "",
                             "extensions": [{"provider": "org.xmind.ui.mathJax", "content": {"content": "A \\cup B"}}]}
                        ]
                    }
                }
            }
        ]))
        .unwrap()
    }

    #[test]
    fn markdown_has_headings_bullets_notes_and_equation() {
        let md = to_markdown(&sheets());
        assert!(md.starts_with("# Logica\n"), "{md}");
        assert!(md.contains("> ripasso\n> esame\n"), "{md}");
        assert!(md.contains("- Insiemi `mate`\n"), "{md}");
        assert!(md.contains("  - \n"), "{md}");
        assert!(md.contains("- $A \\cup B$\n"), "{md}");
    }

    #[test]
    fn opml_is_wellformed_and_escapes() {
        let opml = to_opml(&sheets(), "Mia & Mappa");
        assert!(opml.starts_with("<?xml"));
        assert!(opml.contains("<title>Mia &amp; Mappa</title>"));
        assert!(opml.contains("_note=\"ripasso\nesame\""));
        assert!(opml.contains("_equation=\"A \\cup B\""));
        assert!(opml.contains("_labels=\"mate\""));
        assert!(opml.ends_with("</opml>\n"));
    }
}
