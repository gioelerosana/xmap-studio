//! Stato del workbook aperto: contenuto tipizzato, archivio grezzo, cronologia
//! undo/redo e logica di salvataggio (atomico + backup + validazione + lock).

use crate::archive::{self, RawArchive};
use crate::error::{
    ErrorPayload, CODE_CONFLICT, CODE_FORMAT, CODE_NO_WORKBOOK, CODE_VALIDATION, CODE_XMIND_RUNNING,
};
use crate::model::{Sheet, Topic, CHILD_GROUPS};
use crate::safety;
use crate::validate::{self, ValidationReport};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const MAX_HISTORY: usize = 200;

pub struct OpenWorkbook {
    pub path: PathBuf,
    pub archive: RawArchive,
    pub content: Vec<Sheet>,
    pub manifest: Value,
    pub opened_hash: String,
    pub opened_mtime: Option<SystemTime>,
    pub history: Vec<Vec<Sheet>>,
    pub pos: usize,
    pub saved_pos: usize,
}

#[derive(Debug)]
pub struct SaveOutcome {
    pub path: PathBuf,
    pub backup: Option<PathBuf>,
    pub bytes: usize,
    pub validation: ValidationReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookDto {
    pub path: String,
    pub file_name: String,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub sheets: Vec<SheetDto>,
    pub xmind_running: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDto {
    pub index: usize,
    pub id: Option<String>,
    pub title: String,
    pub topics: Vec<TopicView>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicView {
    pub id: String,
    pub sheet_index: usize,
    pub parent_id: Option<String>,
    pub depth: usize,
    pub group: String,
    pub title: String,
    pub display_title: String,
    pub kind: &'static str,
    pub latex: Option<String>,
    pub image_src: Option<String>,
    pub path: Vec<String>,
    pub child_count: usize,
}

impl OpenWorkbook {
    pub fn open(path: &Path) -> Result<Self, ErrorPayload> {
        let archive = archive::read_archive(path)
            .map_err(|e| ErrorPayload::new(CODE_FORMAT, format!("{e:#}")))?;

        let content_bytes = archive
            .entries
            .get("content.json")
            .ok_or_else(|| ErrorPayload::new(CODE_FORMAT, "content.json assente"))?;
        let content: Vec<Sheet> = serde_json::from_slice(content_bytes)
            .map_err(|e| ErrorPayload::new(CODE_FORMAT, format!("content.json non valido: {e}")))?;

        // Il manifest può mancare in file molto vecchi: lo ricostruiamo al salvataggio.
        let manifest: Value = archive
            .entries
            .get("manifest.json")
            .and_then(|b| serde_json::from_slice(b).ok())
            .unwrap_or_else(|| serde_json::json!({ "file-entries": {} }));

        let opened_hash = archive::hash_file(path)
            .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
        let opened_mtime = archive::mtime(path);

        Ok(Self {
            path: path.to_path_buf(),
            archive,
            content: content.clone(),
            manifest,
            opened_hash,
            opened_mtime,
            history: vec![content],
            pos: 0,
            saved_pos: 0,
        })
    }

    pub fn is_dirty(&self) -> bool {
        self.pos != self.saved_pos
    }

    /// Registra lo stato corrente nella cronologia (da chiamare DOPO la modifica).
    pub fn commit(&mut self) {
        self.history.truncate(self.pos + 1);
        self.history.push(self.content.clone());
        if self.history.len() > MAX_HISTORY {
            self.history.remove(0);
        }
        self.pos = self.history.len() - 1;
    }

    pub fn undo(&mut self) -> bool {
        if self.pos == 0 {
            return false;
        }
        self.pos -= 1;
        self.content = self.history[self.pos].clone();
        true
    }

    pub fn redo(&mut self) -> bool {
        if self.pos + 1 >= self.history.len() {
            return false;
        }
        self.pos += 1;
        self.content = self.history[self.pos].clone();
        true
    }

    /// Aggiorna archive (content.json + manifest.json) e produce i byte dello ZIP.
    /// Non scrive su disco.
    pub fn build_bytes(&mut self) -> Result<(Vec<u8>, ValidationReport), ErrorPayload> {
        // 1) content.json dalla struttura tipizzata
        let content_bytes = serde_json::to_vec(&self.content)
            .map_err(|e| ErrorPayload::new(CODE_FORMAT, format!("serializzazione content: {e}")))?;
        self.archive
            .entries
            .insert("content.json".to_string(), content_bytes);

        // 2) thumbnail stantia: la rigenera XMind al prossimo salvataggio
        self.archive
            .entries
            .shift_remove("Thumbnails/thumbnail.png");

        // 3) manifest: registra tutte le risorse + content/metadata
        let resource_names: Vec<String> = self.archive.resources.keys().cloned().collect();
        validate::refresh_manifest(&mut self.manifest, resource_names.into_iter(), true);
        let manifest_bytes = serde_json::to_vec(&self.manifest).map_err(|e| {
            ErrorPayload::new(CODE_FORMAT, format!("serializzazione manifest: {e}"))
        })?;
        self.archive
            .entries
            .insert("manifest.json".to_string(), manifest_bytes);

        // 4) ZIP in memoria + validazione preventiva
        let bytes = archive::build_archive_bytes(&self.archive)
            .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
        let report = validate::validate_archive_bytes(&bytes).map_err(|e| {
            ErrorPayload::new(CODE_VALIDATION, format!("validazione fallita: {e:#}"))
        })?;
        Ok((bytes, report))
    }

    /// Salva. `check_xmind` blocca se XMind è aperto; `force` ignora i blocchi.
    pub fn save_to(
        &mut self,
        target: &Path,
        force: bool,
        make_backup: bool,
        check_xmind: bool,
    ) -> Result<SaveOutcome, ErrorPayload> {
        if check_xmind && !force {
            let procs = safety::xmind_processes();
            if !procs.is_empty() {
                return Err(ErrorPayload::new(
                    CODE_XMIND_RUNNING,
                    format!(
                        "XMind è aperto ({} processo/i). Chiudi XMind prima di salvare, \
                         altrimenti al suo salvataggio sovrascriverebbe le tue equazioni.",
                        procs.len()
                    ),
                ));
            }
        }

        // Conflitto solo quando si sovrascrive lo stesso file aperto.
        if !force && target == self.path && safety::has_conflict(target, &self.opened_hash) {
            return Err(ErrorPayload::new(
                CODE_CONFLICT,
                "Il file è cambiato su disco dopo l'apertura (Nextcloud?). \
                 Ricarica il file oppure forza il salvataggio.",
            ));
        }

        let (bytes, validation) = self.build_bytes()?;

        let report = archive::atomic_write(target, &bytes, make_backup).map_err(|e| {
            ErrorPayload::new(crate::error::CODE_IO, format!("scrittura fallita: {e:#}"))
        })?;

        // Validazione post-scrittura del file reale.
        let written = std::fs::read(target).map_err(|e| {
            ErrorPayload::new(crate::error::CODE_IO, format!("rilettura fallita: {e:#}"))
        })?;
        validate::validate_archive_bytes(&written).map_err(|e| {
            ErrorPayload::new(
                CODE_VALIDATION,
                format!(
                    "ATTENZIONE: il file scritto non è valido ({e:#}). \
                     Recupera un backup dalla cartella .xmap-studio/backups/."
                ),
            )
        })?;

        let new_hash = archive::sha256_hex(&written);
        self.path = target.to_path_buf();
        self.opened_hash = new_hash;
        self.opened_mtime = archive::mtime(target);
        self.saved_pos = self.pos;

        Ok(SaveOutcome {
            path: target.to_path_buf(),
            backup: report.backup,
            bytes: report.bytes_written,
            validation,
        })
    }

    pub fn to_dto(&self) -> WorkbookDto {
        WorkbookDto {
            path: self.path.display().to_string(),
            file_name: self
                .path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            dirty: self.is_dirty(),
            can_undo: self.pos > 0,
            can_redo: self.pos + 1 < self.history.len(),
            sheets: self.build_sheets(),
            xmind_running: safety::xmind_processes(),
        }
    }

    fn build_sheets(&self) -> Vec<SheetDto> {
        let mut out = Vec::new();
        for (index, sheet) in self.content.iter().enumerate() {
            let sheet_title = sheet.title_str().to_string();
            let mut topics = Vec::new();
            if let Some(root) = sheet.root_topic.as_ref() {
                let mut ancestors: Vec<String> = Vec::new();
                visit(
                    root,
                    0,
                    None,
                    "root",
                    index,
                    &sheet_title,
                    &mut ancestors,
                    &mut topics,
                );
            }
            out.push(SheetDto {
                index,
                id: sheet.id.clone(),
                title: sheet_title,
                topics,
            });
        }
        out
    }

    pub fn require_open(slot: &Option<OpenWorkbook>) -> Result<&OpenWorkbook, ErrorPayload> {
        slot.as_ref()
            .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))
    }
}

fn display_title(t: &Topic) -> String {
    let title = t.title_str();
    if let Some(latex) = t.latex() {
        if title.is_empty() {
            return format!("⟨{latex}⟩");
        }
        return title.to_string();
    }
    if title.is_empty() {
        if t.is_plain_image() {
            return "⟨immagine⟩".to_string();
        }
        return "(senza titolo)".to_string();
    }
    title.to_string()
}

fn kind_of(t: &Topic) -> &'static str {
    if t.latex().is_some() {
        "equation"
    } else if t.is_plain_image() {
        "image"
    } else {
        "text"
    }
}

#[allow(clippy::too_many_arguments)]
fn visit(
    topic: &Topic,
    depth: usize,
    parent_id: Option<&str>,
    group: &str,
    sheet_index: usize,
    sheet_title: &str,
    ancestors: &mut Vec<String>,
    out: &mut Vec<TopicView>,
) {
    let mut path: Vec<String> = Vec::new();
    if !sheet_title.is_empty() {
        path.push(sheet_title.to_string());
    }
    path.extend(ancestors.iter().cloned());

    out.push(TopicView {
        id: topic.id.clone().unwrap_or_default(),
        sheet_index,
        parent_id: parent_id.map(str::to_string),
        depth,
        group: group.to_string(),
        title: topic.title_str().to_string(),
        display_title: display_title(topic),
        kind: kind_of(topic),
        latex: topic.latex().map(str::to_string),
        image_src: topic.image_src().map(str::to_string),
        path,
        child_count: topic.child_count(),
    });

    ancestors.push(display_title(topic));
    for g in CHILD_GROUPS {
        if let Some(children) = topic.group(g) {
            for child in children {
                visit(
                    child,
                    depth + 1,
                    topic.id.as_deref(),
                    g,
                    sheet_index,
                    sheet_title,
                    ancestors,
                    out,
                );
            }
        }
    }
    ancestors.pop();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::{build_archive_bytes, Entries};
    use indexmap::IndexMap;
    use serde_json::json;

    fn fixture_bytes() -> Vec<u8> {
        let content = json!([
            {
                "id": "sheet",
                "title": "Mappa",
                "revisionId": "r1",
                "rootTopic": {
                    "id": "root",
                    "title": "Radice",
                    "structureClass": "org.xmind.ui.tree.right",
                    "children": {
                        "attached": [
                            {"id": "a", "title": "Alfa"},
                            {"id": "b", "title": "", "image": {"src": "xap:resources/e.png", "width": 10, "height": 4, "isMathJaxImage": true},
                             "extensions": [{"provider": "org.xmind.ui.mathJax", "content": {"content": "a=b"}}]}
                        ]
                    }
                }
            }
        ]);
        let mut entries: Entries = IndexMap::new();
        entries.insert("content.json".into(), serde_json::to_vec(&content).unwrap());
        entries.insert(
            "metadata.json".into(),
            b"{\"dataStructureVersion\":\"3\"}".to_vec(),
        );
        entries.insert(
            "manifest.json".into(),
            br#"{"file-entries":{"content.json":{},"metadata.json":{},"resources/e.png":{}}}"#
                .to_vec(),
        );
        entries.insert("content.xml".into(), b"<x/>".to_vec());
        let mut resources = IndexMap::new();
        resources.insert("resources/e.png".into(), vec![9u8, 9, 9]);
        build_archive_bytes(&RawArchive { entries, resources }).unwrap()
    }

    fn open_fixture() -> (tempfile::TempDir, OpenWorkbook) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.xmind");
        std::fs::write(&path, fixture_bytes()).unwrap();
        let wb = OpenWorkbook::open(&path).unwrap();
        (dir, wb)
    }

    #[test]
    fn dto_lists_topics_with_breadcrumb_and_kind() {
        let (_d, wb) = open_fixture();
        let dto = wb.to_dto();
        let topics = &dto.sheets[0].topics;
        assert_eq!(topics.len(), 3);
        assert_eq!(topics[0].id, "root");
        assert_eq!(topics[0].depth, 0);
        assert_eq!(topics[1].id, "a");
        assert_eq!(topics[1].path[0], "Mappa");
        assert_eq!(topics[2].kind, "equation");
        assert_eq!(topics[2].latex.as_deref(), Some("a=b"));
        assert_eq!(topics[2].display_title, "⟨a=b⟩");
        assert_eq!(topics[2].path.last().unwrap(), "Radice");
        assert!(!wb.is_dirty());
    }

    #[test]
    fn undo_redo_restores_content() {
        let (_d, mut wb) = open_fixture();
        let original = wb.content.clone();
        let t = crate::model::find_topic_mut(&mut wb.content, "a").unwrap();
        t.title = Some("Modificato".into());
        wb.commit();
        assert!(wb.is_dirty());
        assert!(wb.undo());
        assert_eq!(
            serde_json::to_value(&wb.content).unwrap(),
            serde_json::to_value(&original).unwrap()
        );
        assert!(!wb.is_dirty());
        assert!(wb.redo());
        assert_eq!(
            crate::model::find_topic(&wb.content, "a")
                .unwrap()
                .title_str(),
            "Modificato"
        );
    }

    #[test]
    fn save_roundtrip_preserves_unknown_and_validates() {
        let (dir, mut wb) = open_fixture();
        // modifica: cambia titolo + aggiungi risorsa fittizia
        crate::model::find_topic_mut(&mut wb.content, "a")
            .unwrap()
            .title = Some("Alfa 2".into());
        wb.archive
            .resources
            .insert("resources/z.png".into(), vec![1, 2, 3, 4]);
        let target = dir.path().join("out.xmind");
        wb.save_to(&target, false, false, false).unwrap();

        // riapre e verifica
        let reopened = OpenWorkbook::open(&target).unwrap();
        assert_eq!(
            crate::model::find_topic(&reopened.content, "a")
                .unwrap()
                .title_str(),
            "Alfa 2"
        );
        // campi sconosciuti preservati
        let v = serde_json::to_value(&reopened.content).unwrap();
        assert_eq!(v[0]["revisionId"], json!("r1"));
        // la thumbnail è stata rimossa e manifest aggiornato
        assert!(!reopened
            .archive
            .entries
            .contains_key("Thumbnails/thumbnail.png"));
        validate::validate_archive_bytes(&std::fs::read(&target).unwrap()).unwrap();
        // risorsa nuova registrata
        let reopened_raw = archive::read_archive(&target).unwrap();
        assert!(reopened_raw.resources.contains_key("resources/z.png"));
    }

    #[test]
    fn conflict_blocks_overwrite_but_force_wins() {
        let (_d, mut wb) = open_fixture();
        // altera il file su disco
        std::fs::write(&wb.path, b"changed externally").unwrap();
        let err = wb
            .save_to(&wb.path.clone(), false, false, false)
            .unwrap_err();
        assert_eq!(err.code, CODE_CONFLICT);
        assert!(wb.save_to(&wb.path.clone(), true, false, false).is_ok());
    }
}
