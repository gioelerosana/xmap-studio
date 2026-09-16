//! Validazione dell'archivio PRIMA di sovrascrivere il file dell'utente.
//!
//! Verifica, in memoria:
//!  1. lo ZIP si riapre e ogni entry ha CRC valido;
//!  2. `content.json` è un array JSON, `manifest.json`/`metadata.json` JSON validi;
//!  3. ogni riferimento `xap:resources/X` ha il file `resources/X` nello ZIP;
//!  4. ogni `resources/X` presente nello ZIP è registrato nel manifest.
//!
//! Se una sola fallisce, il chiamante non tocca il file di destinazione.

use crate::model::collect_resource_refs;

/// Prefisso reale delle entry nello ZIP (senza `xap:`).
const ZIP_RESOURCE_DIR: &str = "resources/";
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::collections::BTreeSet;
use std::io::{Cursor, Read};
use zip::ZipArchive;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ValidationReport {
    pub entries: usize,
    pub resources: usize,
    pub resource_refs: usize,
}

pub fn validate_archive_bytes(bytes: &[u8]) -> Result<ValidationReport> {
    let mut zip =
        ZipArchive::new(Cursor::new(bytes.to_vec())).context("lo ZIP prodotto non si riapre")?;

    let mut names: BTreeSet<String> = BTreeSet::new();
    let mut contents: std::collections::BTreeMap<String, Vec<u8>> =
        std::collections::BTreeMap::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).context("entry illeggibile")?;
        let name = f.name().to_string();
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .with_context(|| format!("CRC non valido su {name}"))?;
        names.insert(name.clone());
        if ["content.json", "manifest.json", "metadata.json"].contains(&name.as_str()) {
            contents.insert(name, buf);
        }
    }

    let content_bytes = contents
        .get("content.json")
        .context("content.json assente nell'output")?;
    let content: Value =
        serde_json::from_slice(content_bytes).context("content.json non è JSON")?;
    if !content.is_array() {
        bail!("content.json non è un array di sheet");
    }

    let manifest: Value = match contents.get("manifest.json") {
        Some(b) => serde_json::from_slice(b).context("manifest.json non è JSON")?,
        None => bail!("manifest.json assente nell'output"),
    };
    if let Some(b) = contents.get("metadata.json") {
        let _: Value = serde_json::from_slice(b).context("metadata.json non è JSON")?;
    }

    let file_entries = manifest
        .get("file-entries")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    // (3) ogni riferimento deve avere il file
    let mut refs = BTreeSet::new();
    collect_resource_refs(&content, &mut refs);
    for r in &refs {
        let path = format!("{ZIP_RESOURCE_DIR}{r}");
        if !names.contains(&path) {
            bail!("riferimento {path} senza risorsa nello ZIP");
        }
        if !file_entries.contains_key(&path) {
            bail!("riferimento {path} non registrato nel manifest");
        }
    }

    // (4) ogni risorsa presente deve essere nel manifest
    let mut resource_count = 0usize;
    for n in &names {
        if n.starts_with("resources/") && !n.ends_with('/') {
            resource_count += 1;
            if !file_entries.contains_key(n) {
                bail!("risorsa {n} presente nello ZIP ma assente dal manifest");
            }
        }
    }

    for required in ["content.json", "metadata.json"] {
        if !file_entries.contains_key(required) {
            bail!("{required} non registrato nel manifest");
        }
    }

    Ok(ValidationReport {
        entries: names.len(),
        resources: resource_count,
        resource_refs: refs.len(),
    })
}

/// Aggiorna il manifest: registra tutte le risorse, garantisce content/metadata,
/// elimina la thumbnail stantia.
pub fn refresh_manifest(
    manifest: &mut Value,
    resource_names: impl Iterator<Item = String>,
    drop_thumbnail: bool,
) {
    if !manifest.is_object() {
        *manifest = serde_json::json!({});
    }
    let obj = manifest.as_object_mut().unwrap();
    let entries = obj
        .entry("file-entries")
        .or_insert_with(|| serde_json::json!({}));
    if !entries.is_object() {
        *entries = serde_json::json!({});
    }
    let entries = entries.as_object_mut().unwrap();

    entries
        .entry("content.json".to_string())
        .or_insert_with(|| serde_json::json!({}));
    entries
        .entry("metadata.json".to_string())
        .or_insert_with(|| serde_json::json!({}));

    if drop_thumbnail {
        entries.remove("Thumbnails/thumbnail.png");
    }

    for name in resource_names {
        entries.entry(name).or_insert_with(|| serde_json::json!({}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::{build_archive_bytes, RawArchive};
    use indexmap::IndexMap;

    fn archive_with(content: &str, manifest: &str, resources: &[(&str, &[u8])]) -> Vec<u8> {
        let mut entries: IndexMap<String, Vec<u8>> = IndexMap::new();
        entries.insert("content.json".into(), content.as_bytes().to_vec());
        entries.insert("manifest.json".into(), manifest.as_bytes().to_vec());
        entries.insert(
            "metadata.json".into(),
            b"{\"dataStructureVersion\":\"3\"}".to_vec(),
        );
        let mut res: IndexMap<String, Vec<u8>> = IndexMap::new();
        for (n, b) in resources {
            res.insert((*n).to_string(), b.to_vec());
        }
        build_archive_bytes(&RawArchive {
            entries,
            resources: res,
        })
        .unwrap()
    }

    #[test]
    fn valid_archive_passes() {
        let content = r#"[{"id":"s","rootTopic":{"id":"r","title":"x"}}]"#;
        let manifest =
            r#"{"file-entries":{"content.json":{},"metadata.json":{},"resources/a.png":{}}}"#;
        let bytes = archive_with(content, manifest, &[("resources/a.png", b"png")]);
        let report = validate_archive_bytes(&bytes).unwrap();
        assert_eq!(report.resources, 1);
    }

    #[test]
    fn missing_resource_is_rejected() {
        let content = r#"[{"rootTopic":{"image":{"src":"xap:resources/missing.png"}}}]"#;
        let manifest =
            r#"{"file-entries":{"content.json":{},"metadata.json":{},"resources/missing.png":{}}}"#;
        let bytes = archive_with(content, manifest, &[]);
        let err = validate_archive_bytes(&bytes).unwrap_err().to_string();
        assert!(err.contains("senza risorsa"), "{err}");
    }

    #[test]
    fn resource_not_in_manifest_is_rejected() {
        let content = r#"[{"rootTopic":{"title":"x"}}]"#;
        let manifest = r#"{"file-entries":{"content.json":{},"metadata.json":{}}}"#;
        let bytes = archive_with(content, manifest, &[("resources/orphan.png", b"x")]);
        let err = validate_archive_bytes(&bytes).unwrap_err().to_string();
        assert!(err.contains("assente dal manifest"), "{err}");
    }

    #[test]
    fn invalid_content_json_is_rejected() {
        let manifest = r#"{"file-entries":{"content.json":{},"metadata.json":{}}}"#;
        let bytes = archive_with("{not json", manifest, &[]);
        assert!(validate_archive_bytes(&bytes).is_err());
    }

    #[test]
    fn refresh_manifest_registers_and_drops_thumbnail() {
        let mut m = serde_json::json!({"file-entries":{"Thumbnails/thumbnail.png":{},"x":{}}});
        refresh_manifest(
            &mut m,
            vec!["resources/new.png".to_string()].into_iter(),
            true,
        );
        let e = &m["file-entries"];
        assert!(e.get("resources/new.png").is_some());
        assert!(e.get("content.json").is_some());
        assert!(e.get("metadata.json").is_some());
        assert!(e.get("Thumbnails/thumbnail.png").is_none());
        assert!(e.get("x").is_some(), "voci preesistenti preservate");
    }
}
