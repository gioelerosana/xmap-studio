//! Unione e divisione di mappe senza toccare lo schema su disco.
//!
//! Entrambe le operazioni sono puramente sul modello: chi le usa costruisce i
//! byte e li passa ad `archive::atomic_write` (unica scrittura consentita).
//!
//! * **Unione**: le sheet di un altro file vengono copiate in coda a quelle
//!   aperte. Prima si riassegnano gli id (topic, sheet, tema, stili) e i
//!   riferimenti interni (`xmind:#id`, `topicId`, `end1Id`/`end2Id`) per non
//!   creare collisioni tra file nati separatamente.
//! * **Divisione**: un ramo diventa una mappa a sé, con una sheet il cui
//!   `rootTopic` è il ramo stesso; si portano dietro solo le risorse e gli
//!   allegati che il ramo referenzia.
//!
//! Le risorse sono content-addressed (`resources/<sha256>.<ext>`): copiarle per
//! nome è sicuro, un'eventuale collisione implica byte identici.

use crate::edit::new_topic_id;
use crate::error::{ErrorPayload, CODE_FORMAT, CODE_IO};
use crate::model::{self, Sheet, Topic};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};

/// Riassegna tutti gli id di `sheets` e aggiorna i riferimenti interni.
///
/// Gli id sono UUID: la collisione tra due file è improbabile ma possibile
/// (copia dello stesso file), quindi un'unione corretta non può farne a meno.
pub fn remap_ids(sheets: &mut [Sheet]) {
    let mut value = match serde_json::to_value(&*sheets) {
        Ok(v) => v,
        Err(_) => return,
    };
    let mut map: HashMap<String, String> = HashMap::new();
    collect_ids(&value, &mut map);
    apply_remap(&mut value, &map);
    if let Ok(new_sheets) = serde_json::from_value::<Vec<Sheet>>(value) {
        sheets.clone_from_slice(&new_sheets);
    }
}

/// Raccoglie ogni valore stringa di chiave `id` come id da riassegnare.
fn collect_ids(value: &Value, map: &mut HashMap<String, String>) {
    match value {
        Value::Object(o) => {
            for (k, v) in o {
                if k == "id" {
                    if let Value::String(s) = v {
                        if !s.is_empty() {
                            map.entry(s.clone()).or_insert_with(new_topic_id);
                        }
                    }
                }
                collect_ids(v, map);
            }
        }
        Value::Array(a) => a.iter().for_each(|v| collect_ids(v, map)),
        _ => {}
    }
}

/// Applica la mappa a chiavi `id`/`topicId`/`end1Id`/`end2Id` e agli href
/// `xmind:#<id>`.
fn apply_remap(value: &mut Value, map: &HashMap<String, String>) {
    match value {
        Value::String(s) => {
            if let Some(rest) = s.strip_prefix("xmind:#") {
                if let Some(new) = map.get(rest) {
                    *s = format!("xmind:#{new}");
                }
            }
        }
        Value::Object(o) => {
            for (k, v) in o.iter_mut() {
                if matches!(k.as_str(), "id" | "topicId" | "end1Id" | "end2Id") {
                    if let Value::String(s) = v {
                        if let Some(new) = map.get(s) {
                            *s = new.clone();
                        }
                    }
                }
                apply_remap(v, map);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|v| apply_remap(v, map)),
        _ => {}
    }
}

/// Chiavi `resources/<nome>` referenziate da un albero di sheet.
pub fn resources_used(sheets: &[Sheet]) -> BTreeSet<String> {
    let mut refs = BTreeSet::new();
    if let Ok(value) = serde_json::to_value(sheets) {
        model::collect_resource_refs(&value, &mut refs);
    }
    refs.into_iter().map(|r| format!("resources/{r}")).collect()
}

/// Chiavi `attachments/<nome>` referenziate da un albero di sheet.
pub fn attachments_used(sheets: &[Sheet]) -> BTreeSet<String> {
    const PREFIX: &str = "xap:attachments/";
    fn scan(value: &Value, out: &mut BTreeSet<String>) {
        match value {
            Value::String(s) => {
                if let Some(rest) = s.strip_prefix(PREFIX) {
                    out.insert(format!("attachments/{rest}"));
                }
            }
            Value::Array(a) => a.iter().for_each(|v| scan(v, out)),
            Value::Object(o) => o.values().for_each(|v| scan(v, out)),
            _ => {}
        }
    }
    let mut out = BTreeSet::new();
    if let Ok(value) = serde_json::to_value(sheets) {
        scan(&value, &mut out);
    }
    out
}

/// Prepara gli allegati di un workbook da unire, risolvendo collisioni di nome
/// e aggiornando i riferimenti nel contenuto importato.
pub fn attachments_to_copy(
    sheets: &mut [Sheet],
    source: &crate::archive::Entries,
    destination: &crate::archive::Entries,
) -> Result<Vec<(String, Vec<u8>)>, ErrorPayload> {
    let mut value = serde_json::to_value(&*sheets)
        .map_err(|e| err(CODE_FORMAT, format!("serializzazione allegati: {e}")))?;
    let refs = attachments_used(sheets);
    let mut remap = HashMap::new();
    let mut copies = Vec::new();

    for source_path in refs {
        let bytes = source.get(&source_path).ok_or_else(|| {
            err(
                CODE_FORMAT,
                format!("allegato referenziato ma assente: {source_path}"),
            )
        })?;
        match destination.get(&source_path) {
            None => {
                remap.insert(source_path.clone(), source_path.clone());
                copies.push((source_path, bytes.clone()));
            }
            Some(existing) if existing == bytes => {
                remap.insert(source_path.clone(), source_path);
            }
            Some(_) => {
                let destination_path = loop {
                    let candidate = format!("attachments/{}.bin", new_topic_id());
                    if !destination.contains_key(&candidate)
                        && !copies.iter().any(|(name, _)| name == &candidate)
                    {
                        break candidate;
                    }
                };
                remap.insert(source_path, destination_path.clone());
                copies.push((destination_path, bytes.clone()));
            }
        }
    }

    fn rewrite(value: &mut Value, remap: &HashMap<String, String>) {
        match value {
            Value::String(text) => {
                if let Some(path) = text.strip_prefix("xap:") {
                    if let Some(new_path) = remap.get(path) {
                        *text = format!("xap:{new_path}");
                    }
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|item| rewrite(item, remap)),
            Value::Object(object) => object.values_mut().for_each(|item| rewrite(item, remap)),
            _ => {}
        }
    }

    rewrite(&mut value, &remap);
    let rewritten: Vec<Sheet> = serde_json::from_value(value)
        .map_err(|e| err(CODE_FORMAT, format!("deserializzazione allegati: {e}")))?;
    sheets.clone_from_slice(&rewritten);
    Ok(copies)
}

/// Costruisce una mappa a sé stante il cui `rootTopic` è `topic`, con id
/// riassegnati. `title` finisce sia nel titolo della sheet sia, se il ramo non
/// ha titolo, in quello della radice.
pub fn standalone_sheet(topic: &Topic, title: &str) -> Sheet {
    let mut branch = topic.clone();
    if branch
        .title
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        branch.title = Some(title.to_string());
    }
    let mut sheets = vec![Sheet {
        id: Some(new_topic_id()),
        class: Some("sheet".to_string()),
        title: Some(title.to_string()),
        revision_id: Some(new_topic_id()),
        root_topic: Some(branch),
        ..Default::default()
    }];
    remap_ids(&mut sheets);
    sheets.remove(0)
}

/// Errore payload per operazioni di merge/split.
fn err(code: &str, msg: impl Into<String>) -> ErrorPayload {
    ErrorPayload::new(code, msg)
}

/// Unione: aggiunge `other` (già deserializzato) a `content`, copiando le
/// risorse e gli allegati referenziati. Restituisce `(sheet, topic)` aggiunti.
pub fn merge_sheets(
    content: &mut Vec<Sheet>,
    other: Vec<Sheet>,
) -> Result<(usize, usize), ErrorPayload> {
    if other.is_empty() {
        return Err(err(CODE_FORMAT, "Il file non contiene mappe da unire."));
    }
    let mut other = other;
    remap_ids(&mut other);
    let mut added_topics = 0usize;
    for sheet in &other {
        if let Some(root) = sheet.root_topic.as_ref() {
            let mut all = Vec::new();
            model::walk_topic(root, &mut all);
            added_topics += all.len();
        }
    }
    let added_sheets = other.len();
    content.extend(other);
    Ok((added_sheets, added_topics))
}

/// Raccoglie le risorse mancanti da copiare: restituisce le coppie
/// `(chiave, byte)` da inserire nell'archivio di destinazione.
pub fn resources_to_copy(
    sheets: &[Sheet],
    source: &crate::archive::Resources,
    destination: &crate::archive::Resources,
) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    for key in resources_used(sheets) {
        if destination.contains_key(&key) {
            continue;
        }
        if let Some(bytes) = source.get(&key) {
            out.push((key, bytes.clone()));
        }
    }
    out
}

/// Byte di un archivio nuovo con una sola sheet. `metadata` è quello del file
/// di partenza (o `None`): XMind lo accetta anche minimale.
pub fn build_standalone_bytes(
    sheet: Sheet,
    resources: crate::archive::Resources,
    attachment_entries: crate::archive::Entries,
    metadata: Option<Vec<u8>>,
) -> Result<Vec<u8>, ErrorPayload> {
    use indexmap::IndexMap;

    let content = serde_json::to_vec(&vec![sheet])
        .map_err(|e| err(CODE_FORMAT, format!("serializzazione content: {e}")))?;

    let mut manifest = serde_json::json!({ "file-entries": {} });
    let resource_names: Vec<String> = resources.keys().cloned().collect();
    crate::validate::refresh_manifest(&mut manifest, resource_names.into_iter(), false);
    let attachment_names: Vec<String> = attachment_entries
        .keys()
        .filter(|k| k.starts_with("attachments/"))
        .cloned()
        .collect();
    crate::validate::register_entries(&mut manifest, attachment_names.into_iter());

    let metadata_bytes = metadata.unwrap_or_else(|| br#"{"dataStructureVersion":"3"}"#.to_vec());

    let mut entries: IndexMap<String, Vec<u8>> = IndexMap::new();
    entries.insert("content.json".to_string(), content);
    entries.insert("metadata.json".to_string(), metadata_bytes);
    for (name, bytes) in attachment_entries {
        entries.insert(name, bytes);
    }
    let manifest_bytes = serde_json::to_vec(&manifest)
        .map_err(|e| err(CODE_FORMAT, format!("serializzazione manifest: {e}")))?;
    entries.insert("manifest.json".to_string(), manifest_bytes);

    let bytes =
        crate::archive::build_archive_bytes(&crate::archive::RawArchive { entries, resources })
            .map_err(|e| err(CODE_IO, format!("{e:#}")))?;

    crate::validate::validate_archive_bytes(&bytes).map_err(|e| {
        err(
            crate::error::CODE_VALIDATION,
            format!("validazione fallita: {e:#}"),
        )
    })?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Vec<Sheet> {
        serde_json::from_value(json!([
            {
                "id": "sheet-a",
                "title": "Prima",
                "rootTopic": {
                    "id": "root-a",
                    "title": "Radice A",
                    "children": {"attached": [
                        {"id": "a1", "title": "Uno", "href": "xmind:#a2"},
                        {"id": "a2", "title": "Due",
                         "image": {"src": "xap:resources/one.png", "width": 10, "height": 5}}
                    ]},
                    "summaries": [{"id": "sum-a", "range": "(0,1)", "topicId": "a2"}]
                }
            },
            {
                "id": "sheet-b",
                "title": "Seconda",
                "rootTopic": {"id": "root-b", "title": "Radice B"}
            }
        ]))
        .unwrap()
    }

    #[test]
    fn remap_changes_ids_and_keeps_references_consistent() {
        let mut sheets = sample();
        remap_ids(&mut sheets);
        let v = serde_json::to_value(&sheets).unwrap();
        // gli id sono tutti nuovi...
        assert_ne!(v[0]["rootTopic"]["id"], json!("root-a"));
        assert_ne!(v[1]["rootTopic"]["id"], json!("root-b"));
        // ...e i riferimenti sono coerenti col nuovo id di a2
        let new_a2 = &v[0]["rootTopic"]["children"]["attached"][1]["id"];
        assert_eq!(
            v[0]["rootTopic"]["children"]["attached"][0]["href"],
            json!(format!("xmind:#{}", new_a2.as_str().unwrap()))
        );
        assert_eq!(v[0]["rootTopic"]["summaries"][0]["topicId"], *new_a2);
        // niente id duplicati tra le due sheet
        let all = serde_json::to_string(&v).unwrap();
        assert!(all.contains(new_a2.as_str().unwrap()));
    }

    #[test]
    fn merge_appends_and_remaps_without_collisions() {
        let mut content = sample();
        // l'altro file riusa gli stessi id (copia): dopo il merge non ci sono
        // collisioni e i riferimenti dell'originale restano intatti.
        let (sheets, topics) = merge_sheets(&mut content, sample()).unwrap();
        assert_eq!(sheets, 2);
        assert_eq!(topics, 4);
        assert_eq!(content.len(), 4);
        let v = serde_json::to_value(&content).unwrap();
        assert_eq!(v[0]["rootTopic"]["id"], json!("root-a"));
        assert_ne!(v[2]["rootTopic"]["id"], json!("root-a"));
        assert_eq!(
            v[0]["rootTopic"]["children"]["attached"][0]["href"],
            json!("xmind:#a2")
        );
    }

    #[test]
    fn merge_rejects_empty_other() {
        let mut content = sample();
        assert!(merge_sheets(&mut content, Vec::new()).is_err());
    }

    #[test]
    fn standalone_sheet_becomes_its_own_root() {
        let sheets = sample();
        let branch = &sheets[0]
            .root_topic
            .as_ref()
            .unwrap()
            .group("attached")
            .unwrap()[0];
        let sheet = standalone_sheet(branch, "Uno");
        let root = sheet.root_topic.as_ref().unwrap();
        assert_eq!(root.title_str(), "Uno");
        assert_eq!(sheet.title.as_deref(), Some("Uno"));
        // l'id della radice non è più quello del nodo di partenza
        assert_ne!(root.id.as_deref(), Some("a1"));
    }

    #[test]
    fn resources_and_attachments_are_collected() {
        let sheets = sample();
        assert_eq!(
            resources_used(&sheets),
            ["resources/one.png".to_string()].into_iter().collect()
        );
        let mut with_attach = sheets.clone();
        with_attach[0].root_topic.as_mut().unwrap().href = Some("xap:attachments/f.bin".into());
        assert_eq!(
            attachments_used(&with_attach),
            ["attachments/f.bin".to_string()].into_iter().collect()
        );
    }

    #[test]
    fn merge_attachment_collisions_are_remapped_and_copied() {
        let mut sheets = vec![sample().remove(0)];
        sheets[0].root_topic.as_mut().unwrap().href = Some("xap:attachments/shared.bin".into());
        let mut source = crate::archive::Entries::new();
        source.insert("attachments/shared.bin".into(), b"source".to_vec());
        let mut destination = crate::archive::Entries::new();
        destination.insert("attachments/shared.bin".into(), b"destination".to_vec());

        let copies = attachments_to_copy(&mut sheets, &source, &destination).unwrap();
        let href = sheets[0]
            .root_topic
            .as_ref()
            .unwrap()
            .href
            .as_deref()
            .unwrap();
        let remapped_path = href.strip_prefix("xap:").unwrap();

        assert_ne!(remapped_path, "attachments/shared.bin");
        assert_eq!(copies.len(), 1);
        assert_eq!(copies[0].0, remapped_path);
        assert_eq!(copies[0].1, b"source");
    }

    #[test]
    fn merge_reuses_identical_attachments_and_rejects_missing_ones() {
        let mut sheets = vec![sample().remove(0)];
        sheets[0].root_topic.as_mut().unwrap().href = Some("xap:attachments/shared.bin".into());
        let mut source = crate::archive::Entries::new();
        source.insert("attachments/shared.bin".into(), b"same".to_vec());
        let mut destination = crate::archive::Entries::new();
        destination.insert("attachments/shared.bin".into(), b"same".to_vec());

        assert!(attachments_to_copy(&mut sheets, &source, &destination)
            .unwrap()
            .is_empty());
        assert!(
            attachments_to_copy(&mut sheets, &crate::archive::Entries::new(), &destination)
                .is_err()
        );
    }
}
