//! Editing strutturale dei topic: testo, aggiunta di sotto-blocchi ed
//! eliminazione. Sono operazioni puramente in memoria: chi le usa deve chiamare
//! `OpenWorkbook::commit()` per registrare lo snapshot di undo/redo.
//!
//! Invarianti rispettate:
//! - i campi sconosciuti (`extra`) dei topic toccati restano intatti;
//! - scrivere un titolo rimuove `titleUnedited` (altrimenti XMind ignora il
//!   testo e ripristina il titolo dedotto dall'equazione);
//! - un topic con equazione conserva `image` + `extensions`: cambia solo il
//!   titolo mostrato accanto alla formula;
//! - la radice di una sheet non è eliminabile (XMind richiede `rootTopic`).

use crate::model::{
    self, Boundary, Children, Marker, Notes, NotesPart, Relationship, Sheet, Summary, Topic,
    CHILD_GROUPS,
};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Genera un id di topic nel formato usato da XMind (UUID v4).
///
/// Usa `/dev/urandom`; se non è disponibile (ambiente insolito) ripiega su uno
/// SHA-256 di tempo + contatore. Nessuna dipendenza esterna.
pub fn new_topic_id() -> String {
    let mut bytes = [0u8; 16];
    let from_urandom = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !from_urandom {
        let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut hasher = Sha256::new();
        hasher.update(nanos.to_le_bytes());
        hasher.update(counter.to_le_bytes());
        let digest = hasher.finalize();
        bytes.copy_from_slice(&digest[..16]);
    }
    // Marca come UUID versione 4 (variant RFC 4122).
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Imposta il testo del topic. Non tocca equazione, immagine o figli: su un
/// blocco con formula modifica solo il titolo visibile.
pub fn set_title(topic: &mut Topic, title: &str) {
    topic.title = Some(title.to_string());
    topic.title_unedited = None;
}

/// Aggiunge un sotto-blocco testuale come figlio `attached` di `parent` e
/// restituisce l'id generato. Crea il contenitore `children` se assente.
pub fn add_child(parent: &mut Topic, title: &str) -> String {
    let id = new_topic_id();
    let child = Topic {
        id: Some(id.clone()),
        title: Some(title.to_string()),
        ..Default::default()
    };
    let children = parent.children.get_or_insert_with(Children::default);
    children.attached.get_or_insert_with(Vec::new).push(child);
    id
}

/// Sostituisce le note del topic con `text` (testo semplice).
///
/// XMind salva entrambe le metà: `plain` (testo) e `realHTML` (XHTML). Le
/// scriviamo sempre insieme per non farle desincronizzare. `realHTML` viene
/// generato escapando il testo (le entità devono essere corrette *dentro* la
/// stringa HTML), una `p` per riga. Testo vuoto rimuove le note.
pub fn set_notes(topic: &mut Topic, text: &str) {
    if text.trim().is_empty() {
        topic.notes = None;
        topic.notes_display = None;
        return;
    }
    topic.notes = Some(Notes {
        plain: Some(NotesPart {
            content: Some(text.to_string()),
            ..Default::default()
        }),
        real_html: Some(NotesPart {
            content: Some(notes_html(text)),
            ..Default::default()
        }),
        ..Default::default()
    });
}

/// Imposta `notesDisplay` (`"icon"` o `"block"`). `None` = valore predefinito
/// di XMind (icona).
pub fn set_notes_display(topic: &mut Topic, display: Option<&str>) {
    topic.notes_display = display
        .map(str::trim)
        .filter(|d| matches!(*d, "icon" | "block"))
        .map(str::to_string);
}

/// Normalizza ed imposta le etichette: rimuove spazi, vuoti e duplicati
/// (mantenendo l'ordine); lista vuota rimuove il campo.
pub fn set_labels(topic: &mut Topic, labels: &[String]) {
    let mut clean: Vec<String> = Vec::new();
    for label in labels {
        let label = label.trim();
        if label.is_empty() || clean.iter().any(|l| l == label) {
            continue;
        }
        clean.push(label.to_string());
    }
    topic.labels = (!clean.is_empty()).then_some(clean);
}

/// Aggiunge o rimuove un marker. Restituisce `true` se il marker è ora
/// presente. Un id vuoto non fa nulla.
pub fn toggle_marker(topic: &mut Topic, marker_id: &str) -> bool {
    let id = marker_id.trim();
    if id.is_empty() {
        return false;
    }
    let removed = {
        let markers = topic.markers.get_or_insert_with(Vec::new);
        match markers
            .iter()
            .position(|m| m.marker_id.as_deref() == Some(id))
        {
            Some(pos) => {
                markers.remove(pos);
                true
            }
            None => {
                markers.push(Marker {
                    marker_id: Some(id.to_string()),
                    ..Default::default()
                });
                false
            }
        }
    };
    let now_empty = topic
        .markers
        .as_ref()
        .map(|m| m.is_empty())
        .unwrap_or(false);
    if now_empty {
        topic.markers = None;
    }
    !removed
}

/// Imposta (o rimuove) il link del topic. Non genera `attributedTitle`: è solo
/// una rappresentazione di visualizzazione di XMind e va preservata com'è.
/// Una forma `#<id>` viene normalizzata nel topic link `xmind:#<id>`.
pub fn set_href(topic: &mut Topic, href: Option<&str>) {
    let clean = href.map(str::trim).filter(|s| !s.is_empty());
    topic.href = clean.map(|s| {
        if let Some(id) = s.strip_prefix('#') {
            format!("xmind:#{id}")
        } else {
            s.to_string()
        }
    });
}

/// Converte testo semplice in XHTML per `notes.realHTML`. Ogni riga diventa
/// un paragrafo; le righe vuote diventano `<p><br></p>`.
pub fn notes_html(text: &str) -> String {
    let mut out = String::new();
    for line in text.split('\n') {
        if line.is_empty() {
            out.push_str("<p><br></p>");
        } else {
            out.push_str("<p>");
            out.push_str(&escape_html(line));
            out.push_str("</p>");
        }
    }
    out
}

/// Escapa `& < > " '` per l'uso dentro `realHTML`. L'ordine conta: `&` per
/// primo, altrimenti si ri-escapano le entità appena prodotte.
fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Stacca e restituisce il topic con `id` (insieme a tutti i suoi figli).
///
/// Restituisce `None` se non esiste o se è la radice di una sheet: la radice
/// non è eliminabile perché XMind richiede un `rootTopic`. Le risorse
/// eventualmente referenziate restano nello ZIP come orfane innocue (l'undo le
/// può ripristinare).
pub fn remove_topic(sheets: &mut [Sheet], id: &str) -> Option<Topic> {
    for sheet in sheets.iter_mut() {
        let Some(root) = sheet.root_topic.as_mut() else {
            continue;
        };
        if root.id.as_deref() == Some(id) {
            return None;
        }
        let mut path = Vec::new();
        if !find_path(root, id, &mut path) {
            continue;
        }
        let (group_index, child_index) = *path.last().unwrap();

        // Prima di staccare: i range di boundary/summary del genitore vanno
        // riallineati all'indice del figlio che sparisce.
        let removed = {
            let parent = descend_mut(root, &path[..path.len() - 1], 0);
            adjust_parent_ranges(parent, group_index, child_index);
            let children = parent.group_mut(CHILD_GROUPS[group_index])?;
            if child_index >= children.len() {
                return None;
            }
            children.remove(child_index)
        };

        // Riferimenti per id (relazioni a livello sheet, summary orfani).
        let mut removed_ids = std::collections::BTreeSet::new();
        {
            let mut all = Vec::new();
            model::walk_topic(&removed, &mut all);
            for t in all {
                if let Some(i) = t.id.clone() {
                    removed_ids.insert(i);
                }
            }
        }
        if let Some(rels) = sheet.relationships.as_mut() {
            rels.retain(|r| !relationship_touches(r, &removed_ids));
            if rels.is_empty() {
                sheet.relationships = None;
            }
        }
        if let Some(root) = sheet.root_topic.as_mut() {
            remove_orphan_summary_refs(root, &removed_ids);
        }
        return Some(removed);
    }
    None
}

/// Vero se una relazione tocca uno degli id rimossi.
fn relationship_touches(rel: &Relationship, removed: &std::collections::BTreeSet<String>) -> bool {
    [rel.end1_id.as_deref(), rel.end2_id.as_deref()]
        .into_iter()
        .flatten()
        .any(|id| removed.contains(id))
}

/// Riallinea boundary/summary del genitore dopo la rimozione di un figlio.
///
/// `group_index` è l'indice in `CHILD_GROUPS`: 0 = `attached`, 2 = `summary`.
fn adjust_parent_ranges(parent: &mut Topic, group_index: usize, child_index: usize) {
    const ATTACHED: usize = 0;
    const SUMMARY: usize = 2;

    if group_index == SUMMARY {
        // Eliminato un topic di sommario: cade il descrittore che lo riferisce.
        let removed_topic_id = parent
            .group("summary")
            .and_then(|v| v.get(child_index))
            .and_then(|t| t.id.clone());
        if let Some(rid) = removed_topic_id {
            if let Some(sums) = parent.summaries.as_mut() {
                sums.retain(|s| s.topic_id.as_deref() != Some(rid.as_str()));
                if sums.is_empty() {
                    parent.summaries = None;
                }
            }
        }
        return;
    }
    if group_index != ATTACHED {
        return;
    }

    if let Some(boundaries) = parent.boundaries.as_mut() {
        boundaries.retain_mut(|b| shift_range(&mut b.range, child_index));
        if boundaries.is_empty() {
            parent.boundaries = None;
        }
    }

    let mut dropped_topics = Vec::new();
    if let Some(sums) = parent.summaries.as_mut() {
        let mut keep = Vec::new();
        for mut s in sums.drain(..) {
            if shift_range(&mut s.range, child_index) {
                keep.push(s);
            } else if let Some(topic_id) = s.topic_id.clone() {
                dropped_topics.push(topic_id);
            }
        }
        parent.summaries = (!keep.is_empty()).then_some(keep);
    }
    for topic_id in dropped_topics {
        if let Some(summary_topics) = parent.children.as_mut().and_then(|c| c.summary.as_mut()) {
            summary_topics.retain(|t| t.id.as_deref() != Some(topic_id.as_str()));
        }
    }
}

/// Sposta di uno un range `(start,end)` per la rimozione dell'indice `removed`.
/// Restituisce `false` se il range si svuota e va eliminato.
fn shift_range(range: &mut Option<String>, removed: usize) -> bool {
    let Some(text) = range.as_deref() else {
        return true;
    };
    let Some((start, end)) = model::parse_range(text) else {
        return true; // "master" e altre forme restano invariate
    };
    if removed > end {
        return true;
    }
    if removed < start {
        *range = Some(model::format_range(start - 1, end - 1));
        return true;
    }
    if end == 0 {
        return false;
    }
    *range = Some(model::format_range(start, end - 1));
    true
}

/// Rimuove i descrittori di summary che puntano a topic non più esistenti.
fn remove_orphan_summary_refs(topic: &mut Topic, removed: &std::collections::BTreeSet<String>) {
    if let Some(sums) = topic.summaries.as_mut() {
        sums.retain(|s| {
            s.topic_id
                .as_deref()
                .map(|id| !removed.contains(id))
                .unwrap_or(true)
        });
        if sums.is_empty() {
            topic.summaries = None;
        }
    }
    for group in CHILD_GROUPS {
        if let Some(children) = topic.group_mut(group) {
            for child in children.iter_mut() {
                remove_orphan_summary_refs(child, removed);
            }
        }
    }
}

/// Punto di rilascio di un trascinamento nell'albero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MovePlacement {
    /// Diventa fratello, subito prima del blocco bersaglio (stesso gruppo).
    Before,
    /// Diventa fratello, subito dopo il blocco bersaglio (stesso gruppo).
    After,
    /// Diventa figlio `attached` del blocco bersaglio (in fondo).
    Into,
}

/// Motivo per cui `move_topic` rifiuta lo spostamento.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveError {
    /// `id` o `target_id` non esistono.
    NotFound,
    /// La radice di una sheet non si sposta.
    Immovable,
    /// Il bersaglio è il blocco stesso o un suo discendente (ciclo).
    Cycle,
    /// `Before`/`After` su una radice, che non ha fratelli.
    NoSiblings,
}

impl MoveError {
    /// Messaggio in italiano per l'utente.
    pub fn message(self) -> &'static str {
        match self {
            MoveError::NotFound => "Blocco da spostare non trovato.",
            MoveError::Immovable => "La radice della mappa non si può spostare.",
            MoveError::Cycle => "Un blocco non può essere spostato dentro sé stesso.",
            MoveError::NoSiblings => "La radice non ha fratelli con cui riordinarsi.",
        }
    }
}

/// Sposta il blocco `id` (con tutto il suo sotto-albero) rispetto a
/// `target_id`. Operazione puramente in memoria: chi la usa deve chiamare
/// `OpenWorkbook::commit()`.
///
/// Il sotto-albero non cambia mai: per spostarlo lo si stacca e lo si
/// reinserisce. Le risorse referenziate seguono il blocco e non vengono toccate.
pub fn move_topic(
    sheets: &mut [Sheet],
    id: &str,
    target_id: &str,
    placement: MovePlacement,
) -> Result<(), MoveError> {
    if id == target_id {
        return Err(MoveError::Cycle);
    }
    if model::find_topic(sheets, target_id).is_none() {
        return Err(MoveError::NotFound);
    }
    if is_sheet_root(sheets, id) {
        return Err(MoveError::Immovable);
    }
    // Il bersaglio non può stare dentro il blocco che si muove, altrimenti lo
    // stacco si porterebbe via la destinazione.
    {
        let source = model::find_topic(sheets, id).ok_or(MoveError::NotFound)?;
        let mut subtree = Vec::new();
        model::walk_topic(source, &mut subtree);
        if subtree.iter().any(|t| t.id.as_deref() == Some(target_id)) {
            return Err(MoveError::Cycle);
        }
    }
    if matches!(placement, MovePlacement::Before | MovePlacement::After)
        && is_sheet_root(sheets, target_id)
    {
        return Err(MoveError::NoSiblings);
    }

    let moved = remove_topic(sheets, id).ok_or(MoveError::NotFound)?;
    match placement {
        MovePlacement::Into => {
            let target = model::find_topic_mut(sheets, target_id).ok_or(MoveError::NotFound)?;
            target
                .children
                .get_or_insert_with(Children::default)
                .attached
                .get_or_insert_with(Vec::new)
                .push(moved);
        }
        MovePlacement::Before | MovePlacement::After => {
            insert_sibling(sheets, target_id, moved, placement == MovePlacement::After)?;
        }
    }
    Ok(())
}

/// Vero se `id` è `rootTopic` di una sheet.
fn is_sheet_root(sheets: &[Sheet], id: &str) -> bool {
    sheets
        .iter()
        .any(|sheet| sheet.root_topic.as_ref().and_then(|t| t.id.as_deref()) == Some(id))
}

/// Inserisce `moved` nello stesso gruppo di `target_id`, prima o dopo di esso.
fn insert_sibling(
    sheets: &mut [Sheet],
    target_id: &str,
    moved: Topic,
    after: bool,
) -> Result<(), MoveError> {
    for sheet in sheets.iter_mut() {
        let Some(root) = sheet.root_topic.as_mut() else {
            continue;
        };
        let mut path = Vec::new();
        if !find_path(root, target_id, &mut path) {
            continue;
        }
        // `target_id` è la radice: gestito prima, ma niente panic in produzione.
        let Some(&(group_index, child_index)) = path.last() else {
            return Err(MoveError::NoSiblings);
        };
        let parent = descend_mut(root, &path[..path.len() - 1], 0);
        let children = parent
            .group_mut(CHILD_GROUPS[group_index])
            .ok_or(MoveError::NotFound)?;
        let at = (child_index + usize::from(after)).min(children.len());
        children.insert(at, moved);
        return Ok(());
    }
    Err(MoveError::NotFound)
}

/// Percorso (indice gruppo, indice figlio) verso `id`, in sola lettura.
fn find_path(topic: &Topic, id: &str, path: &mut Vec<(usize, usize)>) -> bool {
    if topic.id.as_deref() == Some(id) {
        return true;
    }
    for (gi, group) in CHILD_GROUPS.iter().enumerate() {
        if let Some(children) = topic.group(group) {
            for (ci, child) in children.iter().enumerate() {
                path.push((gi, ci));
                if find_path(child, id, path) {
                    return true;
                }
                path.pop();
            }
        }
    }
    false
}

/// Ripercorre `path` in mutazione (due fasi per il borrow checker).
fn descend_mut<'a>(topic: &'a mut Topic, path: &[(usize, usize)], i: usize) -> &'a mut Topic {
    if i == path.len() {
        return topic;
    }
    let (gi, ci) = path[i];
    let children = topic.group_mut(CHILD_GROUPS[gi]).unwrap();
    descend_mut(&mut children[ci], path, i + 1)
}

// ------------------------------------------------------- struttura (Fase 3)

/// Aggiunge una relazione tra due topic alla sheet. Restituisce l'id.
pub fn add_relationship(
    sheet: &mut Sheet,
    end1_id: &str,
    end2_id: &str,
    title: Option<&str>,
) -> String {
    let id = new_topic_id();
    let rel = Relationship {
        id: Some(id.clone()),
        class: Some("relationship".to_string()),
        end1_id: Some(end1_id.to_string()),
        end2_id: Some(end2_id.to_string()),
        title: title
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string),
        ..Default::default()
    };
    sheet.relationships.get_or_insert_with(Vec::new).push(rel);
    id
}

/// Rimuove una relazione per id. `true` se esisteva.
pub fn remove_relationship(sheet: &mut Sheet, relationship_id: &str) -> bool {
    let Some(rels) = sheet.relationships.as_mut() else {
        return false;
    };
    let before = rels.len();
    rels.retain(|r| r.id.as_deref() != Some(relationship_id));
    let removed = rels.len() != before;
    if rels.is_empty() {
        sheet.relationships = None;
    }
    removed
}

/// Aggiunge un boundary sui figli `attached` del topic, nell'intervallo
/// inclusivo `[start, end]`. Restituisce l'id.
pub fn add_boundary(parent: &mut Topic, start: usize, end: usize, title: Option<&str>) -> String {
    let id = new_topic_id();
    let boundary = Boundary {
        id: Some(id.clone()),
        class: Some("boundary".to_string()),
        range: Some(model::format_range(start, end)),
        title: title
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string),
        ..Default::default()
    };
    parent
        .boundaries
        .get_or_insert_with(Vec::new)
        .push(boundary);
    id
}

/// Rimuove un boundary per id. `true` se esisteva.
pub fn remove_boundary(parent: &mut Topic, boundary_id: &str) -> bool {
    let Some(boundaries) = parent.boundaries.as_mut() else {
        return false;
    };
    let before = boundaries.len();
    boundaries.retain(|b| b.id.as_deref() != Some(boundary_id));
    let removed = boundaries.len() != before;
    if boundaries.is_empty() {
        parent.boundaries = None;
    }
    removed
}

/// Aggiunge un sommario sui figli `attached` di `parent` nell'intervallo
/// inclusivo `[start, end]` e restituisce l'id del **topic** di sommario.
///
/// Servono entrambe le rappresentazioni: il topic reale in `children.summary` e
/// il descrittore in `summaries` che lo riferisce con lo stesso id.
pub fn add_summary(parent: &mut Topic, start: usize, end: usize, title: &str) -> String {
    let topic_id = new_topic_id();
    let summary_topic = Topic {
        id: Some(topic_id.clone()),
        title: Some(title.to_string()),
        ..Default::default()
    };
    parent
        .children
        .get_or_insert_with(Children::default)
        .summary
        .get_or_insert_with(Vec::new)
        .push(summary_topic);
    let descriptor = Summary {
        id: Some(new_topic_id()),
        class: Some("summary".to_string()),
        range: Some(model::format_range(start, end)),
        topic_id: Some(topic_id.clone()),
        ..Default::default()
    };
    parent
        .summaries
        .get_or_insert_with(Vec::new)
        .push(descriptor);
    topic_id
}

/// Rimuove il sommario che punta a `summary_topic_id` (descrittore + topic).
pub fn remove_summary(parent: &mut Topic, summary_topic_id: &str) -> bool {
    let mut removed = false;
    if let Some(sums) = parent.summaries.as_mut() {
        let before = sums.len();
        sums.retain(|s| s.topic_id.as_deref() != Some(summary_topic_id));
        removed = sums.len() != before;
        if sums.is_empty() {
            parent.summaries = None;
        }
    }
    if let Some(summary_topics) = parent.children.as_mut().and_then(|c| c.summary.as_mut()) {
        let before = summary_topics.len();
        summary_topics.retain(|t| t.id.as_deref() != Some(summary_topic_id));
        removed = removed || summary_topics.len() != before;
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tree() -> Vec<Sheet> {
        serde_json::from_value(json!([
            {
                "id": "sheet",
                "rootTopic": {
                    "id": "root",
                    "title": "Radice",
                    "children": {
                        "attached": [
                            {
                                "id": "a",
                                "title": "Alfa",
                                "titleUnedited": true,
                                "children": {"attached": [{"id": "a1", "title": "Figlio"}]}
                            },
                            {
                                "id": "b",
                                "title": "",
                                "image": {"src": "xap:resources/x.png", "width": 10, "height": 5, "isMathJaxImage": true},
                                "extensions": [{"provider": "org.xmind.ui.mathJax", "content": {"content": "a=b"}}]
                            }
                        ]
                    }
                }
            }
        ]))
        .unwrap()
    }

    #[test]
    fn new_id_is_uuid_v4_shaped_and_unique() {
        let a = new_topic_id();
        let b = new_topic_id();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        assert_eq!(&a[14..15], "4", "versione 4");
    }

    #[test]
    fn set_title_sets_text_and_drops_title_unedited() {
        let mut sheets = tree();
        let t = crate::model::find_topic_mut(&mut sheets, "a").unwrap();
        set_title(t, "Alfa 2");
        assert_eq!(t.title.as_deref(), Some("Alfa 2"));
        assert!(t.title_unedited.is_none());
    }

    #[test]
    fn set_title_keeps_equation_and_image() {
        let mut sheets = tree();
        let t = crate::model::find_topic_mut(&mut sheets, "b").unwrap();
        set_title(t, "Titolo formula");
        assert_eq!(t.latex(), Some("a=b"));
        assert!(!t.is_plain_image());
        assert_eq!(t.image.as_ref().unwrap().is_mathjax_image, Some(true));
        assert_eq!(t.title.as_deref(), Some("Titolo formula"));
    }

    #[test]
    fn add_child_creates_attached_topic_with_new_id() {
        let mut sheets = tree();
        let id = {
            let t = crate::model::find_topic_mut(&mut sheets, "a").unwrap();
            let id = add_child(t, "Nuovo blocco");
            assert_eq!(t.child_count(), 2);
            id
        };
        let added = crate::model::find_topic(&sheets, &id).expect("topic aggiunto");
        assert_eq!(added.title.as_deref(), Some("Nuovo blocco"));
    }

    #[test]
    fn add_child_creates_children_container_when_missing() {
        let mut parent = Topic {
            id: Some("p".into()),
            ..Default::default()
        };
        let id = add_child(&mut parent, "x");
        assert_eq!(parent.group("attached").unwrap().len(), 1);
        assert_eq!(
            parent.group("attached").unwrap()[0].id.as_deref(),
            Some(id.as_str())
        );
    }

    #[test]
    fn remove_topic_detaches_nested_topic() {
        let mut sheets = tree();
        let removed = remove_topic(&mut sheets, "a1").expect("rimosso");
        assert_eq!(removed.id.as_deref(), Some("a1"));
        assert!(crate::model::find_topic(&sheets, "a1").is_none());
        // il resto è intatto
        assert!(crate::model::find_topic(&sheets, "a").is_some());
        assert!(crate::model::find_topic(&sheets, "b").is_some());
    }

    #[test]
    fn remove_root_is_refused() {
        let mut sheets = tree();
        assert!(remove_topic(&mut sheets, "root").is_none());
        assert!(crate::model::find_topic(&sheets, "root").is_some());
    }

    #[test]
    fn remove_unknown_is_none() {
        let mut sheets = tree();
        assert!(remove_topic(&mut sheets, "ghost").is_none());
    }

    #[test]
    fn move_into_reparents_as_last_child() {
        let mut sheets = tree();
        move_topic(&mut sheets, "a1", "b", MovePlacement::Into).unwrap();
        let b = crate::model::find_topic(&sheets, "b").unwrap();
        assert_eq!(
            b.group("attached").unwrap().last().unwrap().id.as_deref(),
            Some("a1")
        );
        // staccato dal vecchio padre
        let a = crate::model::find_topic(&sheets, "a").unwrap();
        assert_eq!(a.child_count(), 0);
        assert_eq!(
            crate::model::find_topic(&sheets, "a1").unwrap().title_str(),
            "Figlio"
        );
    }

    #[test]
    fn move_before_and_after_reorder_siblings() {
        let mut sheets = tree();
        // "b" prima di "a" → ordine b, a
        move_topic(&mut sheets, "b", "a", MovePlacement::Before).unwrap();
        let root = sheets[0].root_topic.as_ref().unwrap();
        let ids: Vec<&str> = root
            .group("attached")
            .unwrap()
            .iter()
            .map(|t| t.id.as_deref().unwrap())
            .collect();
        assert_eq!(ids, vec!["b", "a"]);

        // e adesso "b" dopo "a" → torna a, b
        move_topic(&mut sheets, "b", "a", MovePlacement::After).unwrap();
        let root = sheets[0].root_topic.as_ref().unwrap();
        let ids: Vec<&str> = root
            .group("attached")
            .unwrap()
            .iter()
            .map(|t| t.id.as_deref().unwrap())
            .collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn move_into_descendant_is_refused() {
        let mut sheets = tree();
        let before = serde_json::to_value(&sheets).unwrap();
        assert_eq!(
            move_topic(&mut sheets, "a", "a1", MovePlacement::Into),
            Err(MoveError::Cycle)
        );
        assert_eq!(
            serde_json::to_value(&sheets).unwrap(),
            before,
            "nessuna modifica"
        );
    }

    #[test]
    fn move_self_is_refused() {
        let mut sheets = tree();
        assert_eq!(
            move_topic(&mut sheets, "a", "a", MovePlacement::Into),
            Err(MoveError::Cycle)
        );
    }

    #[test]
    fn move_root_is_refused() {
        let mut sheets = tree();
        assert_eq!(
            move_topic(&mut sheets, "root", "a", MovePlacement::Into),
            Err(MoveError::Immovable)
        );
        assert_eq!(
            move_topic(&mut sheets, "a", "root", MovePlacement::Before),
            Err(MoveError::NoSiblings)
        );
    }

    #[test]
    fn set_notes_writes_both_halves_and_escapes_html() {
        let mut t = Topic::default();
        set_notes(&mut t, "a < b & c\n\nfine");
        let notes = t.notes.as_ref().unwrap();
        assert_eq!(
            notes.plain.as_ref().unwrap().content.as_deref(),
            Some("a < b & c\n\nfine")
        );
        assert_eq!(
            notes.real_html.as_ref().unwrap().content.as_deref(),
            Some("<p>a &lt; b &amp; c</p><p><br></p><p>fine</p>")
        );
        assert_eq!(t.notes_text(), Some("a < b & c\n\nfine"));
    }

    #[test]
    fn empty_notes_are_removed() {
        let mut t = Topic::default();
        set_notes(&mut t, "  ");
        assert!(t.notes.is_none());
        assert!(t.notes_display.is_none());
    }

    #[test]
    fn labels_are_normalized_and_deduped() {
        let mut t = Topic::default();
        set_labels(&mut t, &[" a ".into(), "b".into(), "a".into(), "".into()]);
        assert_eq!(
            t.labels.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
        set_labels(&mut t, &[]);
        assert!(t.labels.is_none());
    }

    #[test]
    fn toggle_marker_adds_and_removes() {
        let mut t = Topic::default();
        assert!(toggle_marker(&mut t, "priority-1"));
        assert!(toggle_marker(&mut t, "flag-red"));
        assert_eq!(
            t.marker_ids().collect::<Vec<_>>(),
            vec!["priority-1", "flag-red"]
        );
        assert!(!toggle_marker(&mut t, "priority-1"));
        assert_eq!(t.marker_ids().collect::<Vec<_>>(), vec!["flag-red"]);
        assert!(!toggle_marker(&mut t, "flag-red"));
        assert!(t.markers.is_none());
    }

    #[test]
    fn href_normalizes_topic_link_and_clears() {
        let mut t = Topic::default();
        set_href(&mut t, Some("#abc"));
        assert_eq!(t.href.as_deref(), Some("xmind:#abc"));
        set_href(&mut t, Some("https://example.org"));
        assert_eq!(t.href.as_deref(), Some("https://example.org"));
        set_href(&mut t, None);
        assert!(t.href.is_none());
    }

    fn structured() -> Vec<Sheet> {
        serde_json::from_value(json!([
            {
                "id": "sheet",
                "relationships": [
                    {"id": "rel1", "end1Id": "a", "end2Id": "b"},
                    {"id": "rel2", "end1Id": "a", "end2Id": "a1"}
                ],
                "rootTopic": {
                    "id": "root",
                    "title": "Radice",
                    "children": {
                        "attached": [
                            {"id": "a", "title": "A", "children": {"attached": [{"id": "a1"}]}},
                            {"id": "b", "title": "B"}
                        ],
                        "summary": [{"id": "sum1", "title": "Sommario"}]
                    },
                    "boundaries": [{"id": "bd1", "range": "(0,1)"}],
                    "summaries": [{"id": "sm1", "range": "(0,1)", "topicId": "sum1"}]
                }
            }
        ]))
        .unwrap()
    }

    #[test]
    fn relationship_add_and_remove() {
        let mut sheets = structured();
        {
            let sheet = &mut sheets[0];
            let id = add_relationship(sheet, "a", "b", Some("nota"));
            assert_eq!(sheet.relationships_list().len(), 3);
            assert!(remove_relationship(sheet, &id));
        }
        assert_eq!(sheets[0].relationships_list().len(), 2);
        assert!(!remove_relationship(&mut sheets[0], "ghost"));
    }

    #[test]
    fn remove_topic_drops_relationships_and_shifts_ranges() {
        let mut sheets = structured();
        // rimuove "b" (indice 1): rela rel1 e rel2 toccano b/a1? rel1 tocca b,
        // rel2 no. boundary (0,1) e summary (0,1) diventano (0,0).
        remove_topic(&mut sheets, "b").unwrap();
        let sheet = &sheets[0];
        assert_eq!(sheet.relationships_list().len(), 1);
        assert_eq!(sheet.relationships_list()[0].id.as_deref(), Some("rel2"));
        let root = sheet.root_topic.as_ref().unwrap();
        assert_eq!(root.boundaries_list()[0].range.as_deref(), Some("(0,0)"));
        assert_eq!(root.summaries_list()[0].range.as_deref(), Some("(0,0)"));
    }

    #[test]
    fn removing_last_child_drops_now_empty_summary_and_boundary() {
        let mut sheets = structured();
        // toglie prima "b" poi "a": con un solo figlio il range diventa (0,0),
        // rimuovendo anche l'ultimo il range si svuota e sparisce.
        remove_topic(&mut sheets, "b").unwrap();
        remove_topic(&mut sheets, "a").unwrap();
        let root = sheets[0].root_topic.as_ref().unwrap();
        assert!(root.boundaries_list().is_empty());
        assert!(root.summaries_list().is_empty());
        assert!(root.group("summary").map(|s| s.is_empty()).unwrap_or(true));
    }

    #[test]
    fn add_summary_writes_both_representations() {
        let mut sheets = structured();
        let parent = model::find_topic_mut(&mut sheets, "root").unwrap();
        let sid = add_summary(parent, 0, 1, "Nuovo sommario");
        assert!(parent
            .group("summary")
            .unwrap()
            .iter()
            .any(|t| t.id.as_deref() == Some(sid.as_str())));
        assert!(parent
            .summaries_list()
            .iter()
            .any(|s| s.topic_id.as_deref() == Some(sid.as_str())));
        assert!(remove_summary(parent, &sid));
        assert!(!parent
            .summaries_list()
            .iter()
            .any(|s| s.topic_id.as_deref() == Some(sid.as_str())));
    }

    #[test]
    fn removing_summary_topic_removes_descriptor() {
        let mut sheets = structured();
        remove_topic(&mut sheets, "sum1").unwrap();
        let root = sheets[0].root_topic.as_ref().unwrap();
        assert!(root.summaries_list().is_empty());
    }

    #[test]
    fn move_from_missing_or_unknown_placement_is_none() {
        let mut sheets = tree();
        assert_eq!(
            move_topic(&mut sheets, "ghost", "b", MovePlacement::Into),
            Err(MoveError::NotFound)
        );
        assert_eq!(
            move_topic(&mut sheets, "a", "ghost", MovePlacement::Into),
            Err(MoveError::NotFound)
        );
    }
}
