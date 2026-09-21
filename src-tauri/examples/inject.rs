//! CLI di supporto: inietta equazione e contenuto ricco in un topic e salva.
//!
//!     cargo run --example inject -- <sorgente.xmind> <uscita.xmind> <titolo topic> '<latex>'
//!         [note=<testo>] [label=<x>]... [marker=<id>]... [href=<url>]
//!
//! Utile per generare un file di prova da aprire in XMind.

use xmap_studio_lib::edit;
use xmap_studio_lib::equation::{apply_equation, TitleMode};
use xmap_studio_lib::mathjax::Renderer;
use xmap_studio_lib::model;
use xmap_studio_lib::state::OpenWorkbook;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!(
            "uso: inject <src.xmind> <out.xmind> <titolo topic> '<latex>' \
             [note=<testo>] [label=<x>]... [marker=<id>]... [href=<url>]"
        );
        std::process::exit(2);
    }
    let (src, out, title, latex) = (&args[1], &args[2], &args[3], &args[4]);
    let extras = &args[5..];

    let renderer = Renderer::discover(None).expect("renderer MathJax");
    let mut wb = OpenWorkbook::open(std::path::Path::new(src)).expect("apertura mappa");

    let target_id = {
        let mut found = None;
        'outer: for sheet in &wb.content {
            if let Some(root) = sheet.root_topic.as_ref() {
                let mut all = Vec::new();
                model::walk_topic(root, &mut all);
                for t in all {
                    if t.title_str() == title {
                        found = Some(t.id.clone().unwrap());
                        break 'outer;
                    }
                }
            }
        }
        found.unwrap_or_else(|| panic!("topic con titolo {title:?} non trovato"))
    };

    let (outcome, png) = {
        let topic = model::find_topic_mut(&mut wb.content, &target_id).unwrap();
        apply_equation(
            &renderer,
            topic,
            latex,
            23.33,
            3.0,
            TitleMode::FormulaOnly,
            "#000000",
        )
        .expect("applicazione equazione")
    };
    wb.archive.resources.insert(outcome.resource.clone(), png);

    // Contenuto ricco opzionale (Fase 1).
    {
        let topic = model::find_topic_mut(&mut wb.content, &target_id).unwrap();
        let mut labels: Vec<String> = Vec::new();
        for arg in extras {
            if let Some(v) = arg.strip_prefix("note=") {
                edit::set_notes(topic, v);
            } else if let Some(v) = arg.strip_prefix("label=") {
                labels.push(v.to_string());
            } else if let Some(v) = arg.strip_prefix("marker=") {
                edit::toggle_marker(topic, v);
            } else if let Some(v) = arg.strip_prefix("href=") {
                edit::set_href(topic, Some(v));
            } else {
                eprintln!("argomento ignorato: {arg}");
            }
        }
        if !labels.is_empty() {
            edit::set_labels(topic, &labels);
        }
    }
    wb.commit();

    let save = wb
        .save_to(std::path::Path::new(out), false, true, false)
        .expect("salvataggio");
    println!(
        "OK {} → {} (risorsa {}, {}×{} px, {} bytes, backup {:?})",
        src, out, outcome.resource, outcome.width, outcome.height, save.bytes, save.backup
    );
}
