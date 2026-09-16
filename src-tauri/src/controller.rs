//! Controller dell'applicazione: unica porta d'accesso alla logica del backend.
//!
//! Qui vive ciò che prima era esposto come comandi Tauri, ma come API Rust
//! sincrona richiamabile dalla UI GTK (su un thread di lavoro). Nessuna
//! dipendenza da Tauri: solo stato, rendering e I/O.

use crate::equation::{self, TitleMode};
use crate::error::{ErrorPayload, CODE_NO_WORKBOOK, CODE_TOPIC_NOT_FOUND};
use crate::mathjax::{self, Renderer};
use crate::model;
use crate::raster;
use crate::state::{OpenWorkbook, WorkbookDto};
use crate::validate::ValidationReport;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// em di default: 1.25 × 14pt = 23.33px (rate standard dei sotto-topic XMind).
pub const DEFAULT_EM_PX: f64 = 23.33;
/// Super-sampling del PNG fallback.
pub const RASTER_SCALE: f32 = 3.0;
/// Colore del fallback raster (nero, come il tema chiaro di XMind).
pub const DEFAULT_COLOR: &str = "#000000";

/// Stato globale dell'app: il workbook aperto e il renderer MathJax (lazily).
#[derive(Default)]
pub struct AppController {
    wb: Option<OpenWorkbook>,
    renderer: Option<Renderer>,
    renderer_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSpec {
    pub topic_id: String,
    pub latex: String,
    #[serde(default)]
    pub title_mode: Option<TitleMode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResultDto {
    pub path: String,
    pub backup: Option<String>,
    pub bytes: usize,
    pub validation: ValidationReport,
    pub workbook: WorkbookDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResultDto {
    pub outcomes: Vec<equation::ApplyOutcome>,
    pub workbook: WorkbookDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDto {
    pub svg: String,
    pub width: f64,
    pub height: f64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    pub has_workbook: bool,
    pub path: Option<String>,
    pub file_name: Option<String>,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub xmind_running: Vec<String>,
    pub conflict: bool,
    pub renderer_checked: bool,
    pub renderer_ready: bool,
    pub renderer_error: Option<String>,
}

fn em_for(topic: &model::Topic) -> f64 {
    match model::font_size_px(topic) {
        Some(px) if px.is_finite() && px > 0.0 => 1.25 * px,
        _ => DEFAULT_EM_PX,
    }
}

impl AppController {
    pub fn new() -> Self {
        Self::default()
    }

    /// Assicura che il renderer MathJax sia stato scoperto (lazy, una volta).
    fn ensure_renderer(&mut self) -> Result<(), ErrorPayload> {
        if self.renderer.is_none() {
            match Renderer::discover(None) {
                Ok(renderer) => {
                    self.renderer = Some(renderer);
                    self.renderer_error = None;
                }
                Err(e) => {
                    let message = format!("{e:#}");
                    self.renderer_error = Some(message);
                    return Err(mathjax::render_error(e));
                }
            }
        }
        Ok(())
    }

    /// Prepara il renderer fuori dal main loop (chiamata all'avvio).
    pub fn prepare_renderer(&mut self) -> Result<(), ErrorPayload> {
        self.ensure_renderer()
    }

    /// Renderer MathJax, scoperto al primo uso e poi riusato.
    fn renderer(&mut self) -> Result<&Renderer, ErrorPayload> {
        self.ensure_renderer()?;
        Ok(self.renderer.as_ref().unwrap())
    }

    pub fn workbook(&self) -> Option<WorkbookDto> {
        self.wb.as_ref().map(OpenWorkbook::to_dto)
    }

    pub fn status(&self) -> StatusDto {
        let renderer_ready = self.renderer.is_some();
        let renderer_checked = renderer_ready || self.renderer_error.is_some();
        let renderer_error = self.renderer_error.clone();
        match self.wb.as_ref() {
            None => StatusDto {
                has_workbook: false,
                path: None,
                file_name: None,
                dirty: false,
                can_undo: false,
                can_redo: false,
                xmind_running: crate::safety::xmind_processes(),
                conflict: false,
                renderer_checked,
                renderer_ready,
                renderer_error,
            },
            Some(wb) => StatusDto {
                has_workbook: true,
                path: Some(wb.path.display().to_string()),
                file_name: wb
                    .path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string()),
                dirty: wb.is_dirty(),
                can_undo: wb.pos > 0,
                can_redo: wb.pos + 1 < wb.history.len(),
                xmind_running: crate::safety::xmind_processes(),
                conflict: crate::safety::has_conflict(&wb.path, &wb.opened_hash),
                renderer_checked,
                renderer_ready,
                renderer_error,
            },
        }
    }

    pub fn open(&mut self, path: &str) -> Result<WorkbookDto, ErrorPayload> {
        // Normalizza percorsi `file://` eventualmente passati dal drag&drop.
        let path = path.strip_prefix("file://").unwrap_or(path);
        let wb = OpenWorkbook::open(&PathBuf::from(path))?;
        let dto = wb.to_dto();
        self.wb = Some(wb);
        Ok(dto)
    }

    fn with_wb<R>(
        &mut self,
        f: impl FnOnce(&mut OpenWorkbook) -> Result<R, ErrorPayload>,
    ) -> Result<R, ErrorPayload> {
        let wb = self
            .wb
            .as_mut()
            .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))?;
        f(wb)
    }

    fn apply_batch_inner(
        &mut self,
        specs: &[BatchSpec],
    ) -> Result<Vec<equation::ApplyOutcome>, ErrorPayload> {
        if specs.is_empty() {
            return Err(ErrorPayload::new(
                crate::error::CODE_FORMAT,
                "Nessuna equazione da applicare.",
            ));
        }
        // Borrow disgiunti dei due campi: `&self.renderer` e `&mut self.wb`.
        self.ensure_renderer()?;
        let renderer = self.renderer.as_ref().unwrap();
        let wb = self
            .wb
            .as_mut()
            .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))?;

        // Lavora su una copia: se una formula è invalida, NIENTE viene modificato.
        let mut working = wb.content.clone();
        let mut pending: Vec<(String, Vec<u8>)> = Vec::new();
        let mut outcomes = Vec::new();

        for spec in specs {
            let topic = model::find_topic_mut(&mut working, &spec.topic_id).ok_or_else(|| {
                ErrorPayload::new(
                    CODE_TOPIC_NOT_FOUND,
                    format!("Blocco non trovato: {}", spec.topic_id),
                )
            })?;
            let em = em_for(topic);
            let (outcome, png) = equation::apply_equation(
                renderer,
                topic,
                &spec.latex,
                em,
                RASTER_SCALE,
                spec.title_mode.clone().unwrap_or_default(),
                DEFAULT_COLOR,
            )?;
            pending.push((outcome.resource.clone(), png));
            outcomes.push(outcome);
        }

        wb.content = working;
        for (name, png) in pending {
            wb.archive.resources.insert(name, png);
        }
        wb.commit();
        Ok(outcomes)
    }

    pub fn apply_batch(&mut self, specs: Vec<BatchSpec>) -> Result<BatchResultDto, ErrorPayload> {
        let outcomes = self.apply_batch_inner(&specs)?;
        let workbook = self
            .wb
            .as_ref()
            .map(OpenWorkbook::to_dto)
            .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))?;
        Ok(BatchResultDto {
            outcomes,
            workbook,
        })
    }

    pub fn apply(
        &mut self,
        topic_id: &str,
        latex: &str,
        title_mode: TitleMode,
    ) -> Result<BatchResultDto, ErrorPayload> {
        self.apply_batch(vec![BatchSpec {
            topic_id: topic_id.to_string(),
            latex: latex.to_string(),
            title_mode: Some(title_mode),
        }])
    }

    pub fn remove_equation(
        &mut self,
        topic_id: &str,
        title: Option<String>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id).ok_or_else(|| {
                ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato.")
            })?;
            equation::remove_equation(topic, title);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn undo(&mut self) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            wb.undo();
            Ok(wb.to_dto())
        })
    }

    pub fn redo(&mut self) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            wb.redo();
            Ok(wb.to_dto())
        })
    }

    pub fn save(&mut self, force: bool) -> Result<SaveResultDto, ErrorPayload> {
        self.with_wb(|wb| {
            let target = wb.path.clone();
            let outcome = wb.save_to(&target, force, true, true)?;
            Ok(SaveResultDto {
                path: outcome.path.display().to_string(),
                backup: outcome.backup.map(|p| p.display().to_string()),
                bytes: outcome.bytes,
                validation: outcome.validation,
                workbook: wb.to_dto(),
            })
        })
    }

    pub fn save_as(&mut self, path: &str, force: bool) -> Result<SaveResultDto, ErrorPayload> {
        let path = path.strip_prefix("file://").unwrap_or(path).to_string();
        self.with_wb(|wb| {
            let target = PathBuf::from(&path);
            let outcome = wb.save_to(&target, force, true, true)?;
            Ok(SaveResultDto {
                path: outcome.path.display().to_string(),
                backup: outcome.backup.map(|p| p.display().to_string()),
                bytes: outcome.bytes,
                validation: outcome.validation,
                workbook: wb.to_dto(),
            })
        })
    }

    pub fn preview(&mut self, latex: &str, em_px: Option<f64>) -> Result<PreviewDto, ErrorPayload> {
        let em = em_px.unwrap_or(DEFAULT_EM_PX);
        let renderer = self.renderer()?;
        let render = renderer.render(latex, em).map_err(mathjax::render_error)?;
        Ok(PreviewDto {
            svg: render.svg,
            width: render.width,
            height: render.height,
            error: render.error,
        })
    }

    pub fn export(
        &mut self,
        topic_id: &str,
        format: &str,
        out_path: &str,
    ) -> Result<String, ErrorPayload> {
        let out_path = out_path
            .strip_prefix("file://")
            .unwrap_or(out_path)
            .to_string();
        let latex = {
            let wb = self
                .wb
                .as_ref()
                .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))?;
            model::find_topic(&wb.content, topic_id)
                .and_then(|t| t.latex().map(str::to_string))
                .ok_or_else(|| {
                    ErrorPayload::new(
                        CODE_TOPIC_NOT_FOUND,
                        "Il blocco non contiene un'equazione.",
                    )
                })?
        };
        let renderer = self.renderer()?;
        let render = renderer
            .render(&latex, DEFAULT_EM_PX)
            .map_err(mathjax::render_error)?;
        let target = PathBuf::from(&out_path);
        match format {
            "svg" => std::fs::write(&target, render.svg.as_bytes())
                .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?,
            "png" => {
                let png = raster::svg_to_png(
                    &render.svg,
                    render.width,
                    render.height,
                    RASTER_SCALE,
                    DEFAULT_COLOR,
                )
                .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
                std::fs::write(&target, &png)
                    .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
            }
            other => {
                return Err(ErrorPayload::new(
                    crate::error::CODE_FORMAT,
                    format!("formato non supportato: {other}"),
                ))
            }
        }
        Ok(target.display().to_string())
    }
}
