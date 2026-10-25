import { inlineMathFontSize, renderLatexToSvg, titleBaseFontPx, type Layout } from '@xmap/core';
import { FORMULA_COLOR, nodeLook, TEXT_ON_DARK, TEXT_ON_LIGHT } from './nodeLook.js';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
    map.set(node.imageSrc, `data:image/png;base64,${bytesToBase64(bytes)}`);
  }
  return map;
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
          const coloredSvg = res.svg.replaceAll('currentColor', color);
          cache.set(node.id, coloredSvg);
        }
      } catch {}
    }
  }
  return cache;
}
