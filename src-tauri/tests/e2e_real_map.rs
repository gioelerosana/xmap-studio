//! Test end-to-end su una mappa REALE (default: Relazioni.xmind dell'utente).
//!
//! Se il file non esiste, il test viene saltato con un messaggio: così la suite
//! resta verde su altre macchine. Sovrascrivibile con `XMIND_TEST_MAP`.

use std::path::{Path, PathBuf};
use xmap_studio_lib::archive::{read_archive, sha256_hex};
use xmap_studio_lib::controller::AppController;
use xmap_studio_lib::edit;
use xmap_studio_lib::equation::{apply_equation, TitleMode};
use xmap_studio_lib::export;
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

    // Fase 1: contenuto ricco sullo stesso blocco (note, etichette, marker, link).
    {
        let topic = model::find_topic_mut(&mut wb.content, &target_id).unwrap();
        edit::set_notes(topic, "nota di prova <x> & y");
        edit::set_notes_display(topic, Some("block"));
        edit::set_labels(topic, &["prova".to_string(), "e2e".to_string()]);
        assert!(edit::toggle_marker(topic, "priority-1"));
        assert!(edit::toggle_marker(topic, "flag-red"));
        edit::set_href(topic, Some("https://example.org"));
    }
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

    // Fase 1: contenuto ricco sopravvissuto al round-trip.
    assert_eq!(topic.notes_text(), Some("nota di prova <x> & y"));
    assert_eq!(topic.notes_display.as_deref(), Some("block"));
    assert_eq!(topic.labels_list(), ["prova", "e2e"]);
    assert_eq!(
        topic.marker_ids().collect::<Vec<_>>(),
        vec!["priority-1", "flag-red"]
    );
    assert_eq!(topic.href_str(), Some("https://example.org"));
    let html = topic
        .notes
        .as_ref()
        .unwrap()
        .real_html
        .as_ref()
        .unwrap()
        .content
        .as_deref()
        .unwrap();
    assert_eq!(
        html, "<p>nota di prova &lt;x&gt; &amp; y</p>",
        "realHTML non escapato correttamente"
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

#[test]
fn e2e_export_markdown_opml_then_import_as_sheet() {
    let Some(map) = test_map() else {
        eprintln!("skip: nessuna mappa di test disponibile");
        return;
    };
    let (_dir, working) = copy_to_temp(&map);
    let mut controller = AppController::new();
    controller
        .open(&working.display().to_string())
        .expect("apertura mappa");

    let out_dir = tempfile::tempdir().unwrap();
    let md_path = out_dir.path().join("mappa.md");
    let opml_path = out_dir.path().join("mappa.opml");
    controller
        .export_outline("markdown", &md_path.display().to_string())
        .unwrap();
    controller
        .export_outline("opml", &opml_path.display().to_string())
        .unwrap();

    let md = std::fs::read_to_string(&md_path).unwrap();
    assert!(md.starts_with('#'), "markdown senza titolo: {md:.80}");
    assert!(opml_path.exists() && std::fs::metadata(&opml_path).unwrap().len() > 0);

    // Il titolo OPML è quello della mappa aperta (radice della prima sheet).
    let root_title = controller
        .workbook()
        .and_then(|w| {
            w.sheets
                .first()
                .and_then(|s| s.topics.first().map(|t| t.title.clone()))
        })
        .unwrap_or_default();
    if !root_title.trim().is_empty() {
        let opml = std::fs::read_to_string(&opml_path).unwrap();
        assert!(
            opml.contains(&format!(
                "<title>{}</title>",
                export::xml_escape(&root_title)
            )),
            "il titolo OPML non usa il titolo della mappa ({root_title})"
        );
    }

    // L'import crea una nuova sheet; le equazioni richiedono il renderer.
    match controller.import_outline("markdown", &md_path.display().to_string()) {
        Ok(dto) => {
            assert_eq!(dto.sheets.len(), 2, "l'import non ha creato una sheet");
            assert!(!dto.sheets[1].topics.is_empty());
            let saved = out_dir.path().join("importato.xmind");
            controller
                .save_as(&saved.display().to_string(), false)
                .unwrap();
            validate_archive_bytes(&std::fs::read(&saved).unwrap()).unwrap();
        }
        Err(e) => eprintln!("skip import: renderer non disponibile ({})", e.message),
    }
}
