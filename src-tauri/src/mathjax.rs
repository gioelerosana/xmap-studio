//! Rendering LaTeX → SVG con `mathjax-full`, esattamente il motore che XMind
//! usa internamente. Gira come processo Node separato (come l'oracolo validato
//! `~/.local/share/xmind-latex/gen_equation.mjs`), perché in Rust non esiste un
//! motore MathJax equivalente e la fedeltà di rendering è un requisito.

use crate::error::{ErrorPayload, CODE_RENDERER};
use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct Renderer {
    pub root: PathBuf,
    pub script: PathBuf,
    pub node: String,
}

#[derive(Debug, Clone)]
pub struct SvgRender {
    pub svg: String,
    pub width: f64,
    pub height: f64,
    pub error: Option<String>,
}

impl Renderer {
    /// Cerca una directory che contenga `gen_equation.mjs` + `node_modules/mathjax-full`.
    ///
    /// Ordine: variabile d'ambiente → installazione oracle dell'utente →
    /// directory di build (dev) → directory risorse del bundle.
    pub fn discover(resource_dir: Option<&Path>) -> Result<Self> {
        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Ok(explicit) = std::env::var("XMIND_LATEX_RENDERER") {
            candidates.push(PathBuf::from(explicit));
        }
        // Renderer incorporato nel binario, estratto una volta in cache.
        if let Ok(embedded) = crate::renderer_assets::ensure_extracted() {
            candidates.push(embedded);
        }
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(PathBuf::from(home).join(".local/share/xmind-latex"));
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("src-tauri/resources/renderer"));
            candidates.push(cwd.join("resources/renderer"));
            if let Some(parent) = cwd.parent() {
                candidates.push(parent.join("src-tauri/resources/renderer"));
            }
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/renderer"),
        );
        // Bundle installato: accanto all'eseguibile o in share/xmind-equation-studio.
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("renderer"));
                candidates.push(dir.join("resources/renderer"));
                candidates.push(dir.join("../share/xmind-equation-studio/renderer"));
            }
        }
        if let Some(rd) = resource_dir {
            candidates.push(rd.join("renderer"));
            candidates.push(rd.join("resources/renderer"));
            candidates.push(rd.join("_up_/resources/renderer"));
        }

        for root in &candidates {
            let script = root.join("gen_equation.mjs");
            let mathjax = root.join("node_modules/mathjax-full");
            if script.is_file() && mathjax.is_dir() {
                return Ok(Renderer {
                    root: root.clone(),
                    script,
                    node: node_binary(),
                });
            }
        }

        Err(anyhow!(
            "renderer MathJax non trovato. Cercato in: {}. \
             Esegui `npm run setup:renderer` oppure imposta XMIND_LATEX_RENDERER.",
            candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }

    pub fn render(&self, latex: &str, em_px: f64) -> Result<SvgRender> {
        let workdir = tempfile::tempdir().context("creazione cartella temporanea render")?;
        let out = workdir.path().join("equation.svg");
        let output = Command::new(&self.node)
            .arg(&self.script)
            .arg(latex)
            .arg(&out)
            .arg(format!("{em_px}"))
            .current_dir(&self.root)
            .output()
            .with_context(|| {
                format!(
                    "impossibile eseguire `{}` (Node.js è installato e nel PATH?)",
                    self.node
                )
            })?;

        if !output.status.success() {
            bail!(
                "renderer MathJax fallito (exit {}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let json_line = stdout
            .lines()
            .rev()
            .find(|l| l.trim_start().starts_with('{'))
            .ok_or_else(|| anyhow!("output renderer inatteso: {stdout:?}"))?;
        let parsed: serde_json::Value =
            serde_json::from_str(json_line.trim()).context("JSON renderer non valido")?;

        let width = parsed
            .get("width")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| anyhow!("width mancante nell'output renderer"))?;
        let height = parsed
            .get("height")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| anyhow!("height mancante nell'output renderer"))?;
        let error = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let svg = std::fs::read_to_string(&out)
            .with_context(|| format!("lettura SVG {}", out.display()))?;

        Ok(SvgRender {
            svg,
            width,
            height,
            error,
        })
    }
}

fn node_binary() -> String {
    std::env::var("XMIND_LATEX_NODE").unwrap_or_else(|_| "node".to_string())
}

/// Converte un errore di rendering in payload per il frontend.
pub fn render_error(message: impl std::fmt::Display) -> ErrorPayload {
    ErrorPayload::new(CODE_RENDERER, format!("{message:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oracle_dir() -> Option<PathBuf> {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/renderer");
        if p.join("node_modules/mathjax-full").is_dir() {
            Some(p)
        } else {
            None
        }
    }

    #[test]
    fn renders_valid_latex() {
        let Some(root) = oracle_dir() else {
            eprintln!("skip: renderer mathjax non installato (npm run setup:renderer)");
            return;
        };
        let r = Renderer {
            root: root.clone(),
            script: root.join("gen_equation.mjs"),
            node: node_binary(),
        };
        let out = r.render("R \\subseteq A \\times B", 23.33).unwrap();
        assert!(out.error.is_none());
        assert!((out.width - 112.54).abs() < 0.5, "width={}", out.width);
        assert!(out.svg.contains("<svg"));
        assert!(out.svg.contains("viewBox"));
    }

    #[test]
    fn reports_invalid_latex_without_failing() {
        let Some(root) = oracle_dir() else {
            return;
        };
        let r = Renderer {
            root: root.clone(),
            script: root.join("gen_equation.mjs"),
            node: node_binary(),
        };
        let out = r.render("\\frac{1}{", 23.33).unwrap();
        assert_eq!(out.error.as_deref(), Some("Missing close brace"));
    }
}
