//! Rasterizzazione SVG → PNG puro-Rust (resvg + tiny-skia), senza binari esterni.
//!
//! Il PNG è solo il *fallback* che XMind mostra se MathJax non è disponibile:
//! viene generato a 3× e ridimensionato logicamente, così resta nitido su HiDPI.

use anyhow::{Context, Result};

/// Rasterizza `svg` a `scale`× rispetto alle dimensioni logiche date.
/// Ritorna i byte PNG.
pub fn svg_to_png(
    svg: &str,
    logical_width: f64,
    logical_height: f64,
    scale: f32,
    color: &str,
) -> Result<Vec<u8>> {
    // MathJax emette `currentColor`. resvg lo risolve in nero, ma rendiamo il
    // comportamento esplicito e deterministico (e pilotabile dal tema).
    let svg = if color.eq_ignore_ascii_case("currentColor") {
        svg.to_string()
    } else {
        svg.replace("currentColor", color)
    };

    let opt = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_str(&svg, &opt)
        .map_err(|e| anyhow::anyhow!("SVG non valido per resvg: {e}"))?;

    let pix_w = ((logical_width.max(1.0)) * scale as f64).round().max(1.0) as u32;
    let pix_h = ((logical_height.max(1.0)) * scale as f64).round().max(1.0) as u32;

    let mut pixmap = resvg::tiny_skia::Pixmap::new(pix_w, pix_h)
        .with_context(|| format!("allocazione pixmap {pix_w}x{pix_h} fallita"))?;

    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    pixmap
        .encode_png()
        .context("codifica PNG fallita")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="112.54px" height="19.92px" viewBox="0 0 1125 199"><path d="M0 0h1125v199H0z" fill="currentColor"/></svg>"#;

    #[test]
    fn rasterizes_at_scale_and_resolves_current_color() {
        let png = svg_to_png(SVG, 112.54, 19.92, 3.0, "#000000").unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        // dimensioni pixel = logiche * 3
        let w = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
        let h = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
        assert_eq!((w, h), ((112.54f64 * 3.0).round() as u32, (19.92f64 * 3.0).round() as u32));
    }

    #[test]
    fn invalid_svg_is_an_error_not_a_panic() {
        assert!(svg_to_png("not svg at all", 10.0, 10.0, 3.0, "#000").is_err());
    }
}
