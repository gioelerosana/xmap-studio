import { CODE_RENDERER, XmapError } from '../errors.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  error: string | null;
}

let mathjaxInitialized = false;
let adaptorInstance: any;
let docInstance: any;

const renderCache = new Map<string, RenderResult>();
const MAX_CACHE_SIZE = 1000;

function initMathJax() {
  if (!mathjaxInitialized) {
    adaptorInstance = liteAdaptor();
    RegisterHTMLHandler(adaptorInstance);
    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'local' });
    docInstance = mathjax.document('', { InputJax: tex, OutputJax: svg });
    mathjaxInitialized = true;
  }
  return { adaptor: adaptorInstance, doc: docInstance };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Converte codice LaTeX in SVG MathJax identico a quello prodotto da XMind.
 *
 * @param latex Codice sorgente della formula.
 * @param emPx Dimensione di base del font (default 23.33px per le equazioni di blocco).
 * @param display true per formule a blocco, false per formule in linea con allineamento baseline.
 */
export function renderLatexToSvg(
  latex: string,
  emPx: number = 23.33,
  display: boolean = true
): RenderResult {
  const cacheKey = `${latex}::${emPx.toFixed(2)}::${display}`;
  const cached = renderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { adaptor, doc } = initMathJax();

  const node = doc.convert(latex, {
    display,
    em: 16,
    ex: 8,
    containerWidth: 80 * 16,
  });

  let svgStr: string = adaptor.innerHTML(node);

  const errMatch = svgStr.match(/data-mjx-error="([^"]*)"/);
  const error = errMatch ? decodeHtml(errMatch[1]) : null;

  const vbMatch = svgStr.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (!vbMatch) {
    throw new XmapError(CODE_RENDERER, "viewBox non trovato nell'output MathJax");
  }

  const widthPx = (parseFloat(vbMatch[3]) / 1000) * emPx;
  const heightPx = (parseFloat(vbMatch[4]) / 1000) * emPx;

  // Assicura xmlns per compatibilità SVG standard
  if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgStr = svgStr.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  }

  // Dimensioni esplicite in px per rasterizzatori e visualizzazione
  svgStr = svgStr
    .replace(/\swidth="[^"]*"/, ` width="${widthPx.toFixed(2)}px"`)
    .replace(/\sheight="[^"]*"/, ` height="${heightPx.toFixed(2)}px"`);

  if (display) {
    svgStr = svgStr.replace(/\sstyle="vertical-align:[^"]*"/, '');
  }

  if (!svgStr.includes('fill="currentColor"')) {
    svgStr = svgStr.replace('<svg ', '<svg fill="currentColor" ');
  }

  const result: RenderResult = {
    svg: svgStr,
    width: widthPx,
    height: heightPx,
    error,
  };

  if (renderCache.size >= MAX_CACHE_SIZE) {
    renderCache.clear();
  }
  renderCache.set(cacheKey, result);

  return result;
}
