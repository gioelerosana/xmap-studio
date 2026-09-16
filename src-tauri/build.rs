//! Build script: prepara il renderer MathJax e lo impacchetta in un archivio
//! compresso incorporato nel binario (`include_bytes!` di `renderer.tar.gz`).
//!
//! Non serve alcuno script esterno: se `resources/renderer/node_modules` manca,
//! viene ricostruito copiando l'installazione "oracolo" dell'utente oppure, in
//! ultima istanza, con `npm install`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const RENDERER_PKGS: [&str; 5] = [
    "mathjax-full",
    "mj-context-menu",
    "mhchemparser",
    "speech-rule-engine",
    "wicked-good-xpath",
];

fn main() {
    // Osserva l'intera cartella: il renderer incorporato deve restare allineato
    // anche quando cambiano i file sotto `node_modules`.
    println!("cargo:rerun-if-changed=resources/renderer");
    println!("cargo:rerun-if-env-changed=XMIND_LATEX_ORACLE");

    ensure_renderer();
    build_archive();
}

fn renderer_dir() -> PathBuf {
    PathBuf::from("resources/renderer")
}

fn ensure_renderer() {
    let dir = renderer_dir();
    if dir.join("node_modules/mathjax-full").is_dir() {
        return;
    }

    if let Some(oracle) = oracle_dir() {
        let modules = oracle.join("node_modules");
        if modules.join("mathjax-full").is_dir() {
            let dest = dir.join("node_modules");
            fs::create_dir_all(&dest).unwrap();
            for pkg in RENDERER_PKGS {
                let from = modules.join(pkg);
                if from.is_dir() {
                    copy_dir(&from, &dest.join(pkg));
                }
            }
            let xmldom = modules.join("@xmldom");
            if xmldom.is_dir() {
                copy_dir(&xmldom, &dest.join("@xmldom"));
            }
        }
    }

    // Ultima spiaggia: npm.
    if !dir.join("node_modules/mathjax-full").is_dir() {
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{ "private": true, "dependencies": { "mathjax-full": "^3.2.1" } }"#,
        )
        .unwrap();
        let _ = Command::new("npm")
            .args(["install", "--no-audit", "--no-fund"])
            .current_dir(&dir)
            .status();
    }

    // Meglio fallire la build che incorporare un renderer vuoto.
    assert!(
        dir.join("node_modules/mathjax-full").is_dir(),
        "renderer MathJax assente in {}. Serve Node/npm oppure un'installazione \
         oracolo in ~/.local/share/xmind-latex (o XMIND_LATEX_ORACLE).",
        dir.display()
    );
}

fn oracle_dir() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("XMIND_LATEX_ORACLE") {
        return Some(PathBuf::from(explicit));
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share/xmind-latex"))
}

fn copy_dir(from: &Path, to: &Path) {
    let _ = fs::create_dir_all(to);
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir(&src, &dst);
        } else {
            let _ = fs::copy(&src, &dst);
        }
    }
}

/// Crea `$OUT_DIR/renderer.tar.gz` con il contenuto di `resources/renderer`.
fn build_archive() {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    let archive_path = Path::new(&out_dir).join("renderer.tar.gz");

    let file = fs::File::create(&archive_path).expect("creazione archivio renderer");
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut builder = tar::Builder::new(encoder);

    let dir = renderer_dir();
    if dir.is_dir() {
        builder
            .append_dir_all(".", &dir)
            .expect("impacchettamento renderer");
    } else {
        println!("cargo:warning=resources/renderer assente: binario senza renderer incorporato");
    }

    let encoder = builder.into_inner().expect("chiusura tar");
    encoder.finish().expect("chiusura gzip");

    let size = fs::metadata(&archive_path).map(|m| m.len()).unwrap_or(0);
    println!(
        "cargo:warning=renderer incorporato: {:.1} MB compressi",
        size as f64 / 1_048_576.0
    );
}
