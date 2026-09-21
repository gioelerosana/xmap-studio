//! Renderer MathJax incorporato nel binario.
//!
//! L'archivio `renderer.tar.gz` (gen_equation.mjs + `node_modules/mathjax-full`)
//! viene prodotto dal `build.rs` e incluso con `include_bytes!`. Al primo uso
//! viene estratto in una cache utente; da quel momento il path è stabile e il
//! `node` di sistema può eseguirlo senza che l'app dipenda da file esterni.

use anyhow::{Context, Result};
use std::path::PathBuf;

static ARCHIVE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/renderer.tar.gz"));

/// Estrae il renderer incorporato (una sola volta per versione) e ne ritorna la
/// directory, pronta per essere passata a `Renderer::discover`.
pub fn ensure_extracted() -> Result<PathBuf> {
    let base = cache_root()
        .join("xmap-studio")
        .join("renderer")
        // la lunghezza dell'archivio invalida la cache quando il renderer cambia
        .join(format!("{}-{}", env!("CARGO_PKG_VERSION"), ARCHIVE.len()));

    if base.join("gen_equation.mjs").is_file() && base.join("node_modules/mathjax-full").is_dir() {
        return Ok(base);
    }

    let tmp = cache_root()
        .join("xmap-studio")
        .join(format!("renderer.tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).context("creazione cache renderer")?;

    let decoder = flate2::read::GzDecoder::new(ARCHIVE);
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(&tmp)
        .context("estrazione del renderer incorporato")?;

    let _ = std::fs::remove_dir_all(&base);
    if let Some(parent) = base.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&tmp, &base).context("spostamento renderer nella cache")?;
    Ok(base)
}

fn cache_root() -> PathBuf {
    match std::env::var_os("XDG_CACHE_HOME") {
        Some(xdg) if !xdg.is_empty() => PathBuf::from(xdg),
        _ => match std::env::var_os("HOME") {
            Some(home) => PathBuf::from(home).join(".cache"),
            None => std::env::temp_dir(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_embedded_renderer() {
        let dir = ensure_extracted().expect("estrazione del renderer incorporato");
        eprintln!("renderer estratto in: {}", dir.display());
        assert!(dir.join("gen_equation.mjs").is_file());
        assert!(dir.join("node_modules/mathjax-full").is_dir());
    }
}
