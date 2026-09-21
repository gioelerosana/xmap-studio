//! Test end-to-end su una mappa REALE (default: Relazioni.xmind dell'utente).
//!
//! Se il file non esiste, il test viene saltato con un messaggio: così la suite
//! resta verde su altre macchine. Sovrascrivibile con `XMIND_TEST_MAP`.

use std::path::{Path, PathBuf};
use xmap_studio_lib::archive::{read_archive, sha256_hex};
use xmap_studio_lib::equation::{apply_equation, TitleMode};
use xmap_studio_lib::mathjax::Renderer;
use xmap_studio_lib::model::{self, Sheet};
use xmap_studio_lib::state::OpenWorkbook;
use xmap_studio_lib::validate::validate_archive_bytes;

fn test_map() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("XMIND_TEST_MAP") {
        let p = PathBuf::from(p);
        return p.exists().then_some(p);
    }
    let home = std::env::var_os("HOME")?;
    let p = PathBuf::from(home).join("Nextcloud/Polimi/Logica e Algebra/Relazioni.xmind");
    p.exists().then_some(p)
}

fn copy_to_temp(src: &Path) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let dst = dir.path().join(src.file_name().unwrap());
    std::fs::copy(src, &dst).unwrap();
    (dir, dst)
}

#[test]
fn round_trip_of_real_map_preserves_every_field() {
    let Some(map) = test_map() else {
        eprintln!("skip: nessuna mappa di test disponibile");
        return;
    };
    let archive = read_archive(&map).unwrap();
    let raw: serde_json::Value =
        serde_json::from_slice(archive.entries.get("content.json").unwrap()).unwrap();
    let typed: Vec<Sheet> = serde_json::from_value(raw.clone()).unwrap();
    let reserialized = serde_json::to_value(&typed).unwrap();
    assert_eq!(
        raw, reserialized,
        "il round-trip ha alterato campi della mappa reale"
    );
}

#[test]
fn e2e_apply_save_validate_reopen() {
    let Some(map) = test_map() else {
        eprintln!("skip: nessuna mappa di test disponibile");
        return;
    };
    let (_dir, working) = copy_to_temp(&map);

    let renderer = match Renderer::discover(None) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("skip: renderer non disponibile: {e:#}");
            return;
        }
    };

    let mut wb = OpenWorkbook::open(&working).unwrap();

    // snapshot dello stato originale per confronti
    let original_content = serde_json::to_value(&wb.content).unwrap();
    let original_topics: Vec<(String, serde_json::Value)> = {
        let mut v = Vec::new();
        for sheet in &wb.content {
            if let Some(root) = sheet.root_topic.as_ref() {
                let mut all = Vec::new();
                model::walk_topic(root, &mut all);
                for t in all {
                    // Solo i campi propri del nodo: i discendenti del target
                    // cambiano legittimamente, ma i sottoalberi degli altri no.
                    let mut own = serde_json::to_value(t).unwrap();
                    if let Some(o) = own.as_object_mut() {
                        o.remove("children");
                    }
                    v.push((t.id.clone().unwrap_or_default(), own));
                }
            }
        }
        v
    };

    // scegli una foglia di testo senza equazione (caso d'uso reale)
    let (target_id, target_title) = {
        let mut chosen = None;
        'outer: for sheet in &wb.content {
            if let Some(root) = sheet.root_topic.as_ref() {
                let mut all = Vec::new();
                model::walk_topic(root, &mut all);
                for t in all {
                    if t.child_count() == 0 && !t.title_str().trim().is_empty() && !t.is_equation()
                    {
                        chosen = Some((t.id.clone().unwrap(), t.title_str().to_string()));
                        break 'outer;
                    }
                }
            }
        }
        chosen.expect("nessuna foglia di testo nella mappa")
    };
    eprintln!("target: {target_title} ({target_id})");

    let latex = "A \\cup B = B \\iff A \\subseteq B";
    let (outcome, png) = {
        let topic = model::find_topic_mut(&mut wb.content, &target_id).unwrap();
        let (o, png) = apply_equation(
            &renderer,
            topic,
            latex,
            23.33,
            3.0,
            TitleMode::FormulaOnly,
            "#000000",
        )
        .unwrap();
        (o, png)
    };

    // nome risorsa = sha256 dei byte del PNG
    assert_eq!(
        outcome.resource,
        format!("resources/{}.png", sha256_hex(&png)),
        "il nome risorsa non è lo sha256 del PNG"
    );
    assert!(outcome.width > 0 && outcome.height > 0);

    wb.archive
        .resources
        .insert(outcome.resource.clone(), png.clone());
    wb.commit();
    assert!(wb.is_dirty());

    // salvataggio con backup
    let save = wb.save_to(&working, false, true, false).unwrap();
    assert!(save.backup.is_some(), "backup atteso su sovrascrittura");
    assert!(save.bytes > 0);

    // validazione esplicita del file su disco
    let bytes = std::fs::read(&working).unwrap();
    let report = validate_archive_bytes(&bytes).unwrap();
    assert!(report.resources >= 1);
    assert!(report.resource_refs >= 1);

    // la thumbnail stantia è stata rimossa
    let reread = read_archive(&working).unwrap();
    assert!(!reread.entries.contains_key("Thumbnails/thumbnail.png"));

    // riapertura: forma JSON esatta richiesta da XMind
    let reopened = OpenWorkbook::open(&working).unwrap();
    let topic = model::find_topic(&reopened.content, &target_id).unwrap();
    assert_eq!(topic.latex(), Some(latex));
    assert_eq!(
        topic.title_str(),
        "",
        "formula-only deve svuotare il titolo"
    );
    assert!(topic.title_unedited.is_none());

    let image = topic.image.as_ref().expect("image annidata presente");
    assert_eq!(image.is_mathjax_image, Some(true));
    let src = image.src.as_deref().unwrap();
    assert!(src.starts_with("xap:resources/"), "src errato: {src}");
    assert_eq!(src, format!("xap:{}", outcome.resource));
    assert_eq!(image.width.as_ref().unwrap().as_i64(), Some(outcome.width));
    assert_eq!(
        image.height.as_ref().unwrap().as_i64(),
        Some(outcome.height)
    );

    // risorsa presente nello ZIP e registrata nel manifest
    assert!(reread.resources.contains_key(&outcome.resource[..]));
    let manifest: serde_json::Value =
        serde_json::from_slice(reread.entries.get("manifest.json").unwrap()).unwrap();
    assert!(manifest["file-entries"].get(&outcome.resource).is_some());

    // niente chiavi flat (errore classico)
    let flat_present = serde_json::to_value(topic)
        .unwrap()
        .as_object()
        .unwrap()
        .contains_key("imageSource");
    assert!(!flat_present);

    // gli ALTRI topic sono rimasti identici
    let new_topics: Vec<(String, serde_json::Value)> = {
        let mut v = Vec::new();
        for sheet in &reopened.content {
            if let Some(root) = sheet.root_topic.as_ref() {
                let mut all = Vec::new();
                model::walk_topic(root, &mut all);
                for t in all {
                    // Solo i campi propri del nodo: i discendenti del target
                    // cambiano legittimamente, ma i sottoalberi degli altri no.
                    let mut own = serde_json::to_value(t).unwrap();
                    if let Some(o) = own.as_object_mut() {
                        o.remove("children");
                    }
                    v.push((t.id.clone().unwrap_or_default(), own));
                }
            }
        }
        v
    };
    assert_eq!(
        new_topics.len(),
        original_topics.len(),
        "numero topic cambiato"
    );
    for (id, before) in &original_topics {
        if id == &target_id {
            continue;
        }
        let after = new_topics.iter().find(|(i, _)| i == id).unwrap();
        assert_eq!(before, &after.1, "topic {id} alterato dal salvataggio");
    }

    // sheet-level: revisionId e theme preservati
    let new_content = serde_json::to_value(&reopened.content).unwrap();
    assert_eq!(
        original_content[0].get("revisionId"),
        new_content[0].get("revisionId")
    );
    assert_eq!(
        original_content[0].get("theme"),
        new_content[0].get("theme")
    );

    eprintln!(
        "E2E OK → {} (backup: {})",
        working.display(),
        save.backup.unwrap().display()
    );
}
