import type { WorldRect } from '../print/paginate.js';

export interface SvgDocumentInput {
  /** Riquadro della mappa in coordinate del mondo (diventa il `viewBox`). */
  bounds: WorldRect;
  /** Contenuto già serializzato (XML ben formato) in coordinate del mondo. */
  contentXml: string;
  /** Eventuali `<defs>` (o frammento) da inserire prima del contenuto. */
  defsXml?: string;
  /** Colore dello sfondo; `null` o assente per uno sfondo trasparente. */
  background?: string | null;
  /** Titolo accessibile del documento. */
  title?: string;
}

/** Lato massimo (px) e area massima (px²) di un raster: oltre, i canvas dei browser falliscono. */
export const MAX_RASTER_SIDE = 8192;
export const MAX_RASTER_PIXELS = 64_000_000;

export interface RasterSize {
  width: number;
  height: number;
  /** Scala effettivamente applicata (≤ quella richiesta se è stata ridotta). */
  scale: number;
  /** `true` se la scala richiesta è stata ridotta per rispettare i limiti. */
  clamped: boolean;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function assertBounds(bounds: WorldRect): void {
  for (const value of [bounds.x, bounds.y, bounds.w, bounds.h]) {
    if (!Number.isFinite(value)) throw new Error('Il riquadro della mappa non è valido.');
  }
  if (bounds.w <= 0 || bounds.h <= 0) throw new Error('La mappa è vuota: niente da esportare.');
}

/**
 * Dimensione in pixel di un'esportazione raster del riquadro `bounds` alla
 * `scale` richiesta, ridotta se supera il lato o l'area massimi.
 */
export function computeRasterSize(
  bounds: WorldRect,
  scale: number,
  limits: { maxSide?: number; maxPixels?: number } = {},
): RasterSize {
  assertBounds(bounds);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('La scala di esportazione non è valida.');
  const maxSide = limits.maxSide ?? MAX_RASTER_SIDE;
  const maxPixels = limits.maxPixels ?? MAX_RASTER_PIXELS;

  const bySide = maxSide / Math.max(bounds.w, bounds.h);
  const byArea = Math.sqrt(maxPixels / (bounds.w * bounds.h));
  const effective = Math.min(scale, bySide, byArea);

  return {
    width: Math.max(1, Math.floor(bounds.w * effective)),
    height: Math.max(1, Math.floor(bounds.h * effective)),
    scale: effective,
    clamped: effective < scale,
  };
}

/**
 * Compone un documento SVG autonomo dalla mappa: dimensioni naturali pari al
 * riquadro (scala 1), sfondo opzionale, contenuto già risolto (niente `var()`
 * né fogli di stile esterni).
 */
export function buildSvgDocument(input: SvgDocumentInput): string {
  const { bounds, contentXml, defsXml, background, title } = input;
  assertBounds(bounds);
  const width = Math.ceil(bounds.w);
  const height = Math.ceil(bounds.h);

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">`,
  ];
  if (title) parts.push(`<title>${escapeXml(title)}</title>`);
  if (defsXml) parts.push(defsXml);
  if (background) {
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(background)}"/>`,
    );
  }
  parts.push(`<g>${contentXml}</g>`, '</svg>');
  return parts.join('\n');
}
