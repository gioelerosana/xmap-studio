import { inlineMathFontSize, renderLatexToSvg, titleBaseFontPx, type Layout, type RenderResult } from '@xmap/core';
import { FORMULA_COLOR, nodeLook, TEXT_ON_DARK, TEXT_ON_LIGHT } from './nodeLook.js';

const MIME_BY_EXTENSION = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Le risorse dell'archivio sono immutabili: la stessa istanza di byte dà lo stesso base64,
// così ogni modifica al layout non ricodifica le immagini già viste.
const base64Cache = new WeakMap<Uint8Array, string>();

function base64Of(bytes: Uint8Array): string {
  const cached = base64Cache.get(bytes);
  if (cached !== undefined) return cached;
  const encoded = bytesToBase64(bytes);
  base64Cache.set(bytes, encoded);
  return encoded;
}

function mimeTypeOf(src: string): string {
  const dot = src.lastIndexOf('.');
  const extension = dot === -1 ? '' : src.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION.get(extension) ?? 'image/png';
}

/** Data URL delle risorse immagine / PNG referenziate dai blocchi, una volta per `imageSrc`. */
export function buildResourceUrls(
  layout: Layout | null,
  resourceResolver: (src: string) => Uint8Array | null,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!layout) return map;
  for (const node of layout.nodes) {
    if (!node.imageSrc || map.has(node.imageSrc)) continue;
    const bytes = resourceResolver(node.imageSrc);
    if (!bytes) continue;
    map.set(node.imageSrc, `data:${mimeTypeOf(node.imageSrc)};base64,${base64Of(bytes)}`);
  }
  return map;
}

// Il risultato di `renderLatexToSvg` è memoizzato nel core (stessa istanza per la stessa formula):
// la versione colorata si ricava una volta per colore. Senza, ogni modifica alla mappa ricolorava
// tutte le formule (`replaceAll` su SVG di qualche KB ciascuno) e produceva stringhe nuove, che il
// confronto delle props di NodeCard doveva poi scorrere carattere per carattere.
const coloredSvgCache = new WeakMap<RenderResult, Map<string, string>>();

function coloredSvg(res: RenderResult, color: string): string {
  let byColor = coloredSvgCache.get(res);
  if (!byColor) {
    byColor = new Map();
    coloredSvgCache.set(res, byColor);
  }
  let svg = byColor.get(color);
  if (svg === undefined) {
    svg = res.svg.replaceAll('currentColor', color);
    byColor.set(color, svg);
  }
  return svg;
}

/** SVG vettoriali delle formule LaTeX, per blocco, colorati in base al tema e al riempimento. */
export function buildFormulaSvgCache(layout: Layout | null, darkMode: boolean): Map<string, string> {
  const cache = new Map<string, string>();
  if (!layout) return cache;

  const theme = darkMode ? 'dark' : 'light';
  for (const node of layout.nodes) {
    const latex = node.latex;
    if (latex) {
      try {
        const res = renderLatexToSvg(latex, inlineMathFontSize(titleBaseFontPx(node.depth, node.textStyle)));
        if (!res.error && res.svg) {
          const look = nodeLook(node, darkMode);
          const color = !look.solid ? FORMULA_COLOR[theme] : look.textLight ? TEXT_ON_DARK : TEXT_ON_LIGHT;
          cache.set(node.id, coloredSvg(res, color));
        }
      } catch {
        // Glifi ancora in caricamento: la formula resta sorgente finché il chiamante non ricalcola con la nuova versione di MathJax.
      }
    }
  }
  return cache;
}
