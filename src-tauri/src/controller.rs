//! Controller dell'applicazione: unica porta d'accesso alla logica del backend.
//!
//! Qui vive ciò che prima era esposto come comandi Tauri, ma come API Rust
//! sincrona richiamabile dalla UI GTK (su un thread di lavoro). Nessuna
//! dipendenza da Tauri: solo stato, rendering e I/O.

use crate::edit;
use crate::equation::{self, TitleMode};
use crate::error::{ErrorPayload, CODE_MOVE, CODE_NO_WORKBOOK, CODE_TOPIC_NOT_FOUND};
use crate::export;
use crate::import;
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

/// Risultato dell'aggiunta di un blocco: id generato (per selezionarlo) più lo
/// stato aggiornato del workbook.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTopicResultDto {
    pub topic_id: String,
    pub workbook: WorkbookDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResultDto {
    pub added_sheets: usize,
    pub added_topics: usize,
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

    /// Byte di una risorsa dell'archivio aperto dato il riferimento salvato nel
    /// content (`xap:resources/<nome>`). Read-only e senza GTK: la conversione a
    /// texture/immagine resta nel layer UI.
    pub fn resource_bytes(&self, src: &str) -> Option<Vec<u8>> {
        let key = src.strip_prefix("xap:").unwrap_or(src);
        let wb = self.wb.as_ref()?;
        wb.archive.resources.get(key).cloned()
    }

    /// Titolo della mappa aperta, per precompilare i nomi dei file esportati:
    /// titolo del topic radice, poi titolo della sheet, poi nome del file.
    pub fn map_title(&self) -> Option<String> {
        let wb = self.wb.as_ref()?;
        let sheet = wb.content.first()?;
        let non_empty = |s: &str| {
            let t = s.trim();
            (!t.is_empty()).then(|| t.to_string())
        };
        let root = sheet
            .root_topic
            .as_ref()
            .and_then(|r| r.title.as_deref())
            .and_then(non_empty);
        let sheet_title = sheet.title.as_deref().and_then(non_empty);
        let stem = wb
            .path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .and_then(|s| non_empty(&s));
        root.or(sheet_title).or(stem)
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
                file_name: wb.path.file_name().map(|s| s.to_string_lossy().to_string()),
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
        Ok(BatchResultDto { outcomes, workbook })
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
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            equation::remove_equation(topic, title);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Imposta il testo del blocco. Su un blocco con equazione cambia solo il
    /// titolo mostrato accanto alla formula.
    pub fn set_topic_title(
        &mut self,
        topic_id: &str,
        title: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            edit::set_title(topic, title);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Imposta le note del blocco (testo semplice) e, se presenti, il modo di
    /// visualizzazione (`"icon"`/`"block"`). Testo vuoto rimuove le note.
    pub fn set_topic_notes(
        &mut self,
        topic_id: &str,
        text: &str,
        display: Option<&str>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            edit::set_notes(topic, text);
            if topic.notes.is_some() {
                edit::set_notes_display(topic, display);
            }
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Sostituisce le etichette del blocco.
    pub fn set_topic_labels(
        &mut self,
        topic_id: &str,
        labels: Vec<String>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            edit::set_labels(topic, &labels);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Aggiunge o rimuove un marker dal blocco. Rifiuta id malformati o non
    /// presenti nel catalogo (tranne che per rimuovere un marker già presente,
    /// così un file importato si può ripulire).
    pub fn toggle_topic_marker(
        &mut self,
        topic_id: &str,
        marker_id: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        let id = marker_id.trim();
        if id.is_empty()
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(ErrorPayload::new(
                crate::error::CODE_FORMAT,
                "Id marker non valido.",
            ));
        }
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            let already = topic.marker_ids().any(|m| m == id);
            if !already && !crate::markers::is_known(id) {
                return Err(ErrorPayload::new(
                    crate::error::CODE_FORMAT,
                    format!("Marker sconosciuto: {id}"),
                ));
            }
            edit::toggle_marker(topic, id);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Imposta (o rimuove) il link del blocco. `#<id>` diventa `xmind:#<id>`.
    pub fn set_topic_href(
        &mut self,
        topic_id: &str,
        href: Option<&str>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            edit::set_href(topic, href);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Aggiunge un sotto-blocco testuale al blocco `parent_id`.
    pub fn add_topic(
        &mut self,
        parent_id: &str,
        title: &str,
    ) -> Result<AddTopicResultDto, ErrorPayload> {
        self.with_wb(|wb| {
            let parent = model::find_topic_mut(&mut wb.content, parent_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            let topic_id = edit::add_child(parent, title);
            wb.commit();
            Ok(AddTopicResultDto {
                topic_id,
                workbook: wb.to_dto(),
            })
        })
    }

    /// Sposta il blocco (con il suo sotto-albero) rispetto a un altro blocco,
    /// per riordino tra fratelli o per riannidamento.
    pub fn move_topic(
        &mut self,
        topic_id: &str,
        target_id: &str,
        placement: edit::MovePlacement,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            edit::move_topic(&mut wb.content, topic_id, target_id, placement)
                .map_err(|e| ErrorPayload::new(CODE_MOVE, e.message()))?;
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    /// Elimina il blocco (e i suoi figli). La radice di una sheet non è
    /// eliminabile.
    pub fn remove_topic(&mut self, topic_id: &str) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            if edit::remove_topic(&mut wb.content, topic_id).is_none() {
                return Err(ErrorPayload::new(
                    CODE_TOPIC_NOT_FOUND,
                    "Blocco non trovato o non eliminabile (la radice della mappa non si rimuove).",
                ));
            }
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
                    ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Il blocco non contiene un'equazione.")
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

    /// Esporta l'intera mappa in Markdown o OPML. Non tocca lo schema: legge il
    /// modello in memoria e scrive solo il file di destinazione scelto.
    pub fn export_outline(&self, format: &str, out_path: &str) -> Result<String, ErrorPayload> {
        let out_path = out_path
            .strip_prefix("file://")
            .unwrap_or(out_path)
            .to_string();
        let map_title = self.map_title().unwrap_or_else(|| "Mappa".to_string());
        let wb = self
            .wb
            .as_ref()
            .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))?;
        let text = match format {
            "markdown" => export::to_markdown(&wb.content),
            "opml" => export::to_opml(&wb.content, &map_title),
            other => {
                return Err(ErrorPayload::new(
                    crate::error::CODE_FORMAT,
                    format!("formato non supportato: {other}"),
                ))
            }
        };
        let target = PathBuf::from(&out_path);
        std::fs::write(&target, text.as_bytes())
            .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
        Ok(target.display().to_string())
    }

    /// Importa un file Markdown/OPML come **nuova sheet** nella mappa aperta.
    /// Le equazioni `$…$` vengono renderizzate come equazioni native.
    pub fn import_outline(
        &mut self,
        format: &str,
        path: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        let path = path.strip_prefix("file://").unwrap_or(path);
        let text = std::fs::read_to_string(path)
            .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
        let outline = import::parse(format, &text)?;
        let title = std::path::Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Importato".to_string());

        // Renderer solo se servono equazioni; borrow disgiunti dei due campi.
        if outline_has_latex(&outline) {
            self.ensure_renderer()?;
        }
        let renderer = self.renderer.as_ref();
        let wb = self
            .wb
            .as_mut()
            .ok_or_else(|| ErrorPayload::new(CODE_NO_WORKBOOK, "Nessun file aperto."))?;

        let mut pending: Vec<(String, Vec<u8>)> = Vec::new();
        let mut root = {
            let mut render = |topic: &mut model::Topic, latex: &str| -> Result<(), ErrorPayload> {
                let renderer = renderer.ok_or_else(|| {
                    ErrorPayload::new(
                        crate::error::CODE_RENDERER,
                        "Renderer MathJax non disponibile.",
                    )
                })?;
                let (outcome, png) = equation::apply_equation(
                    renderer,
                    topic,
                    latex,
                    DEFAULT_EM_PX,
                    RASTER_SCALE,
                    TitleMode::KeepTitle,
                    DEFAULT_COLOR,
                )?;
                pending.push((outcome.resource.clone(), png));
                Ok(())
            };
            import::node_to_topic(&outline, &mut render)?
        };

        for (name, png) in pending {
            wb.archive.resources.insert(name, png);
        }
        if root.title.as_deref().map(str::is_empty).unwrap_or(true) {
            root.title = Some(title.clone());
        }
        let sheet = model::Sheet {
            id: Some(edit::new_topic_id()),
            class: Some("sheet".to_string()),
            title: Some(title),
            revision_id: Some(edit::new_topic_id()),
            root_topic: Some(root),
            ..Default::default()
        };
        wb.content.push(sheet);
        wb.commit();
        Ok(wb.to_dto())
    }

    pub fn add_topic_relationship(
        &mut self,
        end1_id: &str,
        end2_id: &str,
        title: Option<String>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let s1 = model::sheet_index_of(&wb.content, end1_id);
            let s2 = model::sheet_index_of(&wb.content, end2_id);
            match (s1, s2) {
                (Some(i1), Some(i2)) if i1 == i2 => {
                    edit::add_relationship(&mut wb.content[i1], end1_id, end2_id, title.as_deref());
                    wb.commit();
                    Ok(wb.to_dto())
                }
                _ => Err(ErrorPayload::new(
                    CODE_TOPIC_NOT_FOUND,
                    "I blocchi non appartengono alla stessa sheet.",
                )),
            }
        })
    }

    pub fn remove_topic_relationship(
        &mut self,
        _topic_id: &str,
        rel_id: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            for sheet in &mut wb.content {
                if edit::remove_relationship(sheet, rel_id) {
                    wb.commit();
                    return Ok(wb.to_dto());
                }
            }
            Err(ErrorPayload::new(
                CODE_TOPIC_NOT_FOUND,
                "Relazione non trovata.",
            ))
        })
    }

    pub fn add_topic_boundary(&mut self, topic_id: &str) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            let count = topic.group("attached").map(|v| v.len()).unwrap_or(0);
            let end = count.saturating_sub(1);
            edit::add_boundary(topic, 0, end, None);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn remove_topic_boundary(
        &mut self,
        topic_id: &str,
        boundary_id: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            if !edit::remove_boundary(topic, boundary_id) {
                return Err(ErrorPayload::new(
                    CODE_TOPIC_NOT_FOUND,
                    "Cornice non trovata.",
                ));
            }
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn add_topic_summary(&mut self, topic_id: &str) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            let count = topic.group("attached").map(|v| v.len()).unwrap_or(0);
            let end = count.saturating_sub(1);
            edit::add_summary(topic, 0, end, "Sommario");
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn remove_topic_summary(
        &mut self,
        topic_id: &str,
        summary_id: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            if !edit::remove_summary(topic, summary_id) {
                return Err(ErrorPayload::new(
                    CODE_TOPIC_NOT_FOUND,
                    "Sommario non trovato.",
                ));
            }
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn set_topic_task(
        &mut self,
        topic_id: &str,
        priority: Option<i64>,
        progress: Option<i64>,
        start: Option<String>,
        due: Option<String>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            let data = crate::task::TaskData {
                priority,
                progress,
                start_date: start,
                due_date: due,
            };
            crate::task::write(topic, &data);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn clear_topic_task(&mut self, topic_id: &str) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            crate::task::clear(topic);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn set_topic_color(
        &mut self,
        topic_id: &str,
        color: Option<&str>,
    ) -> Result<WorkbookDto, ErrorPayload> {
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            model::set_fill_color(topic, color);
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn merge_workbook(&mut self, path: &str) -> Result<MergeResultDto, ErrorPayload> {
        let path = path.strip_prefix("file://").unwrap_or(path);
        let other = OpenWorkbook::open(&PathBuf::from(path))?;
        self.with_wb(|wb| {
            let mut imported_sheets = other.content.clone();
            let attachments = crate::merge::attachments_to_copy(
                &mut imported_sheets,
                &other.archive.entries,
                &wb.archive.entries,
            )?;
            let resources = crate::merge::resources_to_copy(
                &imported_sheets,
                &other.archive.resources,
                &wb.archive.resources,
            );
            let (added_sheets, added_topics) =
                crate::merge::merge_sheets(&mut wb.content, imported_sheets)?;
            for (key, bytes) in resources {
                wb.archive.resources.insert(key, bytes);
            }
            for (key, bytes) in attachments {
                wb.archive.entries.insert(key, bytes);
            }
            wb.commit();
            Ok(MergeResultDto {
                added_sheets,
                added_topics,
                workbook: wb.to_dto(),
            })
        })
    }

    pub fn split_topic(&mut self, topic_id: &str, out_path: &str) -> Result<String, ErrorPayload> {
        let out_path = out_path.strip_prefix("file://").unwrap_or(out_path);
        let target = PathBuf::from(out_path);
        self.with_wb(|wb| {
            let topic = model::find_topic(&wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            let title = topic.title_str();
            let standalone_sheet = crate::merge::standalone_sheet(
                topic,
                if title.is_empty() { "Mappa" } else { title },
            );
            let bytes = crate::merge::build_standalone_bytes(
                standalone_sheet,
                wb.archive.resources.clone(),
                wb.archive
                    .entries
                    .iter()
                    .filter(|(k, _)| k.starts_with("attachments/"))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
                None,
            )?;
            crate::archive::atomic_write(&target, &bytes, true)
                .map_err(|e| ErrorPayload::new(crate::error::CODE_IO, format!("{e:#}")))?;
            Ok(target.display().to_string())
        })
    }

    pub fn attach_file_to_topic(
        &mut self,
        topic_id: &str,
        path: &str,
    ) -> Result<WorkbookDto, ErrorPayload> {
        let path = path.strip_prefix("file://").unwrap_or(path);
        let source = PathBuf::from(path);
        self.with_wb(|wb| {
            let topic = model::find_topic_mut(&mut wb.content, topic_id)
                .ok_or_else(|| ErrorPayload::new(CODE_TOPIC_NOT_FOUND, "Blocco non trovato."))?;
            crate::media::attach_file(topic, &source, &mut wb.archive.entries)?;
            wb.commit();
            Ok(wb.to_dto())
        })
    }

    pub fn outline_text(&self) -> Option<String> {
        self.wb
            .as_ref()
            .map(|wb| crate::export::to_outline(&wb.content))
    }

    pub fn map_layout(&self) -> Option<crate::layout::Layout> {
        self.wb.as_ref().map(|wb| {
            let dto = wb.to_dto();
            crate::layout::layout(
                &dto.sheets,
                &std::collections::HashSet::new(),
                &crate::layout::EstimatedMetrics,
                crate::layout::LayoutOpts::default(),
            )
        })
    }
}

/// Vero se l'albero importato contiene almeno un'equazione (serve il renderer).
fn outline_has_latex(node: &import::OutlineNode) -> bool {
    node.latex.is_some() || node.children.iter().any(outline_has_latex)
}
