//! Media: allegati di file a un topic.
//!
//! In XMind un allegato **non** è una extension e **non** vive in `resources/`:
//! è un'entry ZIP `attachments/<id>.bin`, registrata in `manifest.json`, e il
//! topic porta un link `xap:attachments/<id>.bin`. Il nome originale del file
//! diventa il titolo del topic, esattamente come fa XMind.
//!
//! Il modulo è puro rispetto al disco (legge solo il file di origine): chi lo
//! usa inserisce i byte in `archive.entries` e il salvataggio registra la entry
//! nel manifest.

use crate::archive::Entries;
use crate::edit::new_topic_id;
use crate::error::{ErrorPayload, CODE_IO};
use crate::model::Topic;
use std::path::Path;

/// Legge `source`, registra l'allegato in `entries` e collega `topic`.
/// Restituisce la chiave della entry (`attachments/<uuid>.bin`).
pub fn attach_file(
    topic: &mut Topic,
    source: &Path,
    entries: &mut Entries,
) -> Result<String, ErrorPayload> {
    let bytes = std::fs::read(source)
        .map_err(|e| ErrorPayload::new(CODE_IO, format!("lettura {}: {e:#}", source.display())))?;
    let filename = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "allegato".to_string());
    attach_bytes(topic, &filename, bytes, entries)
}

/// Variante testabile: i byte sono già in memoria.
pub fn attach_bytes(
    topic: &mut Topic,
    filename: &str,
    bytes: Vec<u8>,
    entries: &mut Entries,
) -> Result<String, ErrorPayload> {
    if bytes.is_empty() {
        return Err(ErrorPayload::new(
            crate::error::CODE_FORMAT,
            "Il file da allegare è vuoto.",
        ));
    }
    let key = attachment_key();
    entries.insert(key.clone(), bytes);
    crate::edit::set_href(topic, Some(&format!("xap:{key}")));
    if topic.title_str().trim().is_empty() {
        topic.title = Some(filename.to_string());
        topic.title_unedited = None;
    }
    Ok(key)
}

/// Nome canonico della entry, con estensione `.bin` come XMind.
pub fn attachment_key() -> String {
    format!("attachments/{}.bin", new_topic_id())
}

/// Vero se `href` punta a un allegato interno.
pub fn is_attachment_href(href: &str) -> bool {
    href.starts_with("xap:attachments/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn attach_sets_href_and_title() {
        let mut topic: Topic = serde_json::from_value(json!({"id": "t"})).unwrap();
        let mut entries = Entries::new();
        let key = attach_bytes(&mut topic, "relazione.pdf", vec![1, 2, 3], &mut entries).unwrap();
        assert!(key.starts_with("attachments/") && key.ends_with(".bin"));
        assert!(entries.contains_key(&key));
        assert_eq!(topic.href.as_deref(), Some(format!("xap:{key}").as_str()));
        assert_eq!(topic.title_str(), "relazione.pdf");
    }

    #[test]
    fn attach_keeps_existing_title() {
        let mut topic: Topic =
            serde_json::from_value(json!({"id": "t", "title": "Titolo"})).unwrap();
        let mut entries = Entries::new();
        attach_bytes(&mut topic, "a.png", vec![9], &mut entries).unwrap();
        assert_eq!(topic.title_str(), "Titolo");
    }

    #[test]
    fn empty_file_is_rejected() {
        let mut topic = Topic::default();
        let mut entries = Entries::new();
        assert!(attach_bytes(&mut topic, "vuoto", Vec::new(), &mut entries).is_err());
        assert!(entries.is_empty());
    }

    #[test]
    fn attachment_href_is_recognized() {
        assert!(is_attachment_href("xap:attachments/x.bin"));
        assert!(!is_attachment_href("xap:resources/x.png"));
    }
}
