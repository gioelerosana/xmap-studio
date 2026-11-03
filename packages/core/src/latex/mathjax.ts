import { CODE_RENDERER, XmapError } from '../errors.js';
import type { MathJaxConvert, MathJaxOutcome } from './mathjax-engine.js';

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  error: string | null;
}

let convert: MathJaxConvert | null = null;
let loading: Promise<void> | null = null;
const readyListeners = new Set<() => void>();
/** Cresce quando il motore diventa pronto e a ogni file di glifi caricato (`getMathJaxVersion`). */
let version = 0;
/** true se una notifica per glifi arrivati è già in coda (più file → un solo ridisegno). */
let notifyScheduled = false;

/** Tentativi massimi di `renderLatexToSvgAsync` (uno per file di glifi mancante). */
const MAX_GLYPH_RETRIES = 10;

const renderCache = new Map<string, RenderResult>();
const MAX_CACHE_SIZE = 1000;

/**
 * Carica il motore MathJax (import dinamico, una volta sola). Va atteso prima
 * di `renderLatexToSvg` nei percorsi che producono dati (equazioni salvate,
 * export); la UI lo avvia appena dopo il primo disegno.
 */
export function loadMathJax(): Promise<void> {
  loading ??= import('./mathjax-engine.js').then(
    async (engine) => {
      convert = await engine.createMathJaxConverter();
      notifyReady();
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
 * Numero che cambia ogni volta che `renderLatexToSvg` può rendere più formule di
 * prima (motore pronto, glifi caricati). Snapshot per `useSyncExternalStore`.
 */
export function getMathJaxVersion(): number {
  return version;
}

function notifyReady(): void {
  version++;
  for (const listener of [...readyListeners]) listener();
}

/**
 * Registra `listener`, chiamato quando MathJax diventa disponibile e ogni volta che
 * arrivano glifi caricati su richiesta (chi ha misurato o disegnato le formule come
 * sorgente deve rifarlo). Restituisce la funzione di rimozione.
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

  const outcome = convert(latex, display);
  if ('pending' in outcome) {
    void watchGlyphs(outcome.pending);
    throw new XmapError(CODE_RENDERER, 'I simboli della formula sono ancora in caricamento.');
  }
  return remember(cacheKey, buildResult(outcome.svg, emPx, display));
}

function remember(cacheKey: string, result: RenderResult): RenderResult {
  if (renderCache.size >= MAX_CACHE_SIZE) {
    renderCache.clear();
  }
  renderCache.set(cacheKey, result);
  return result;
}

/**
 * Come `renderLatexToSvg`, ma aspetta il motore e gli eventuali glifi da caricare.
 * È la via per i percorsi che producono dati (equazioni salvate, export): non
 * fallisce solo perché un alfabeto non è ancora in memoria.
 */
export async function renderLatexToSvgAsync(
  latex: string,
  emPx: number = 23.33,
  display: boolean = true
): Promise<RenderResult> {
  await loadMathJax();
  return renderWhenGlyphsReady(latex, emPx, display, MAX_GLYPH_RETRIES);
}

async function renderWhenGlyphsReady(
  latex: string,
  emPx: number,
  display: boolean,
  attemptsLeft: number
): Promise<RenderResult> {
  const cacheKey = `${latex}::${emPx.toFixed(2)}::${display}`;
  const cached = renderCache.get(cacheKey);
  if (cached) return cached;
  if (!convert) throw new XmapError(CODE_RENDERER, 'Il motore delle formule non è ancora caricato.');
  const outcome: MathJaxOutcome = convert(latex, display);
  if (!('pending' in outcome)) return remember(cacheKey, buildResult(outcome.svg, emPx, display));
  if (attemptsLeft <= 0) throw new XmapError(CODE_RENDERER, 'Impossibile caricare i simboli della formula.');
  try {
    await outcome.pending;
  } catch {
    throw new XmapError(CODE_RENDERER, 'Impossibile caricare i simboli della formula.');
  }
  return renderWhenGlyphsReady(latex, emPx, display, attemptsLeft - 1);
}

/** Notifica gli ascoltatori quando arrivano i glifi attesi; un fallimento resta silenzioso. */
async function watchGlyphs(pending: Promise<void>): Promise<void> {
  try {
    await pending;
  } catch {
    // File di glifi non caricabile (es. offline senza cache): la formula resta come sorgente.
    return;
  }
  if (notifyScheduled) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    notifyReady();
  }, 0);
}

/** Normalizza l'SVG grezzo di MathJax: xmlns, dimensioni in px, colore ereditato. */
function buildResult(raw: string, emPx: number, display: boolean): RenderResult {
  let svgStr = raw;

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

  return {
    svg: svgStr,
    width: widthPx,
    height: heightPx,
    error,
  };
}
