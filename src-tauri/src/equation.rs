//! Applica/rimuove un'equazione MathJax su un topic, seguendo alla lettera lo
//! schema verificato di XMind (vedi README):
//!
//! ```json
//! topic.image = { "src": "xap:resources/<sha256>.png", "width": W, "height": H,
//!                 "isMathJaxImage": true }
//! topic.extensions += [{ "provider": "org.xmind.ui.mathJax",
//!                        "content": { "content": "<latex>" } }]
//! ```
//!
//! Il PNG è registrato in `manifest.json` dallo strato di salvataggio; il nome
//! è lo SHA-256 dei byte del PNG, come fa XMind stesso.

use crate::archive::sha256_hex;
use crate::error::{ErrorPayload, CODE_LATEX};
use crate::mathjax::Renderer;
use crate::model::{Extension, Image, Topic, MATHJAX_PROVIDER};
use crate::raster;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TitleMode {
    /// Titolo vuoto: XMind nasconde la vista testo e mostra solo l'equazione.
    #[default]
    FormulaOnly,
    KeepTitle,
    Custom {
        title: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub topic_id: String,
    pub latex: String,
    pub resource: String,
    pub width: i64,
    pub height: i64,
    pub png_bytes: usize,
    pub previous_title: Option<String>,
    pub new_title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveOutcome {
    pub topic_id: String,
    pub removed_latex: Option<String>,
    pub removed_resource: Option<String>,
    pub new_title: Option<String>,
}

/// Applica un'equazione a `topic`. Non tocca l'archivio: chi chiama inserisce
/// `outcome.resource`/`png` nelle risorse e registra il manifest al salvataggio.
pub fn apply_equation(
    renderer: &Renderer,
    topic: &mut Topic,
    latex: &str,
    em_px: f64,
    raster_scale: f32,
    title_mode: TitleMode,
    color: &str,
) -> Result<(ApplyOutcome, Vec<u8>), ErrorPayload> {
    let latex = latex.trim();
    if latex.is_empty() {
        return Err(ErrorPayload::new(CODE_LATEX, "La formula è vuota."));
    }

    let render = renderer
        .render(latex, em_px)
        .map_err(crate::mathjax::render_error)?;

    if let Some(err) = render.error.as_deref() {
        return Err(ErrorPayload::new(
            CODE_LATEX,
            format!("LaTeX non valido: {err}"),
        ));
    }

    let png = raster::svg_to_png(
        &render.svg,
        render.width,
        render.height,
        raster_scale,
        color,
    )
    .map_err(|e| ErrorPayload::new(CODE_LATEX, format!("rasterizzazione fallita: {e:#}")))?;

    let width = render.width.round().max(1.0) as i64;
    let height = render.height.round().max(1.0) as i64;
    let resource = format!("resources/{}.png", sha256_hex(&png));
    let previous_title = topic.title.clone();

    // extensions: rimuovi eventuale equazione precedente, poi accoda la nuova
    let exts = topic.extensions.get_or_insert_with(Vec::new);
    exts.retain(|e| !e.is_mathjax());
    exts.push(Extension {
        provider: Some(MATHJAX_PROVIDER.to_string()),
        content: Some(json!({ "content": latex })),
        resource_refs: None,
        extra: Default::default(),
    });

    topic.image = Some(Image {
        src: Some(format!("xap:{resource}")),
        width: Some(serde_json::Number::from(width)),
        height: Some(serde_json::Number::from(height)),
        is_mathjax_image: Some(true),
        extra: Default::default(),
    });

    match title_mode {
        TitleMode::FormulaOnly => topic.title = Some(String::new()),
        TitleMode::KeepTitle => { /* lascia il titolo com'è */ }
        TitleMode::Custom { title } => topic.title = Some(title),
    }
    topic.title_unedited = None;

    let outcome = ApplyOutcome {
        topic_id: topic.id.clone().unwrap_or_default(),
        latex: latex.to_string(),
        resource,
        width,
        height,
        png_bytes: png.len(),
        previous_title,
        new_title: topic.title.clone(),
    };
    Ok((outcome, png))
}

/// Rimuove l'equazione dal topic. Non elimina la risorsa dallo ZIP (potrebbe
/// essere ancora referenziata altrove e serve all'undo): resta in archivio come
/// orfana innocua, che XMind ignora.
pub fn remove_equation(topic: &mut Topic, title: Option<String>) -> RemoveOutcome {
    let removed_latex = topic.latex().map(str::to_string);
    let mut removed_resource = None;

    if let Some(exts) = topic.extensions.as_mut() {
        exts.retain(|e| !e.is_mathjax());
        if exts.is_empty() {
            topic.extensions = None;
        }
    }

    if topic
        .image
        .as_ref()
        .map(|i| i.is_mathjax_image == Some(true))
        .unwrap_or(false)
    {
        removed_resource = topic
            .image
            .as_ref()
            .and_then(|i| i.src.as_deref())
            .map(|s| s.trim_start_matches("xap:").to_string());
        topic.image = None;
    }

    if let Some(t) = title {
        topic.title = Some(t);
        topic.title_unedited = None;
    }

    RemoveOutcome {
        topic_id: topic.id.clone().unwrap_or_default(),
        removed_latex,
        removed_resource,
        new_title: topic.title.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Topic;

    #[test]
    fn remove_strips_mathjax_extension_and_image() {
        let mut t: Topic = serde_json::from_value(json!({
            "id": "t1",
            "title": "",
            "extensions": [
                {"provider": "org.xmind.ui.mathJax", "content": {"content": "a=b"}},
                {"provider": "org.xmind.ui.other", "content": {}}
            ],
            "image": {"src": "xap:resources/x.png", "width": 10, "height": 5, "isMathJaxImage": true}
        }))
        .unwrap();

        let out = remove_equation(&mut t, Some("nuovo titolo".into()));
        assert_eq!(out.removed_latex.as_deref(), Some("a=b"));
        assert_eq!(out.removed_resource.as_deref(), Some("resources/x.png"));
        assert!(t.image.is_none());
        assert_eq!(t.extensions.as_ref().unwrap().len(), 1);
        assert!(!t.extensions.as_ref().unwrap()[0].is_mathjax());
        assert_eq!(t.title.as_deref(), Some("nuovo titolo"));
    }

    #[test]
    fn remove_keeps_plain_images() {
        let mut t: Topic = serde_json::from_value(json!({
            "id": "t1",
            "image": {"src": "xap:resources/photo.png", "width": 10, "height": 5}
        }))
        .unwrap();
        let out = remove_equation(&mut t, None);
        assert!(out.removed_resource.is_none());
        assert!(t.image.is_some());
    }

    #[test]
    fn empty_latex_is_rejected_before_rendering() {
        // Non serve un renderer valido: il controllo avviene prima.
        let renderer = Renderer {
            root: std::env::temp_dir(),
            script: std::path::PathBuf::from("nope.mjs"),
            node: "false".into(),
        };
        let mut t = Topic {
            id: Some("t".into()),
            ..Default::default()
        };
        let err = apply_equation(
            &renderer,
            &mut t,
            "   ",
            23.33,
            3.0,
            TitleMode::FormulaOnly,
            "#000000",
        )
        .unwrap_err();
        assert_eq!(err.code, CODE_LATEX);
    }
}
