import { CODE_RENDERER, XmapError } from '../errors.js';
import type { MathJaxConvert } from './mathjax-engine.js';

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  error: string | null;
}

let convert: MathJaxConvert | null = null;
let loading: Promise<void> | null = null;
const readyListeners = new Set<() => void>();

const renderCache = new Map<string, RenderResult>();
const MAX_CACHE_SIZE = 1000;

/**
 * Carica il motore MathJax (import dinamico, una volta sola). Va atteso prima
 * di `renderLatexToSvg` nei percorsi che producono dati (equazioni salvate,
 * export); la UI lo avvia appena dopo il primo disegno.
 */
export function loadMathJax(): Promise<void> {
  loading ??= import('./mathjax-engine.js').then(
    (engine) => {
      convert = engine.createMathJaxConverter();
      for (const listener of [...readyListeners]) listener();
    },
    (err: unknown) => {
      // Un fallimento (es. chunk non raggiungibile offline) non resta in cache: si potrà riprovare.
      loading = null;
      throw err;
    }
  );
  return loading;
}

/** true se `renderLatexToSvg` può rendere subito. */
export function isMathJaxReady(): boolean {
  return convert !== null;
}

/**
 * Registra `listener`, chiamato quando MathJax diventa disponibile (chi ha misurato
 * o disegnato le formule come sorgente deve rifarlo). Restituisce la funzione di rimozione.
 */
export function onMathJaxReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
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
 * Sincrona: richiede MathJax già caricato (`loadMathJax`), altrimenti lancia
 * `XmapError(CODE_RENDERER)` e avvia il caricamento.
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

  if (!convert) {
    // Il caricamento parte comunque: chi ascolta `onMathJaxReady` rifarà il lavoro.
    void loadMathJax().catch(() => undefined);
    throw new XmapError(CODE_RENDERER, 'Il motore delle formule non è ancora caricato.');
  }

  let svgStr = convert(latex, display);

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
