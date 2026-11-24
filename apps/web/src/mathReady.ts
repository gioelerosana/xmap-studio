import { useSyncExternalStore } from 'react';
import { getMathJaxVersion, isMathJaxReady, loadMathJax, onMathJaxReady, type WorkbookDto } from '@xmap/core';

/**
 * true quando il motore MathJax è caricato. Resta true anche quando arrivano
 * glifi nuovi: per quelli serve `useMathJaxVersion`. Il motore si carica su richiesta
 * (`preloadMathJax` o alla prima formula disegnata): finché manca, mappa e titoli
 * mostrano le formule come sorgente, poi si ridisegnano da soli.
 */
export function useMathJaxReady(): boolean {
  return useSyncExternalStore(onMathJaxReady, isMathJaxReady, isMathJaxReady);
}

/**
 * Versione di MathJax: cambia quando il motore si carica e a ogni file di glifi
 * arrivato. Ogni memo che contiene un output di `renderLatexToSvg` deve dipendere da
 * questo valore, altrimenti non ricalcola le formule rimaste in caricamento.
 */
export function useMathJaxVersion(): number {
  return useSyncExternalStore(onMathJaxReady, getMathJaxVersion, getMathJaxVersion);
}

const IDLE_TIMEOUT_MS = 1500;
const FALLBACK_DELAY_MS = 200;

/** Vero dopo la prima pianificazione: le chiamate successive non fanno nulla. */
let preloadScheduled = false;

/** Il foglio contiene formule (LaTeX, `$...$` nei titoli o nelle relazioni): serve MathJax. */
export function workbookUsesMath(workbook: WorkbookDto): boolean {
  for (const sheet of workbook.sheets) {
    for (const topic of sheet.topics) {
      if (topic.kind === 'equation' || topic.latex !== undefined || topic.title.includes('$')) return true;
    }
    for (const rel of sheet.relationships) {
      if (rel.title.includes('$')) return true;
    }
  }
  return false;
}

/**
 * Avvia il caricamento di MathJax quando il browser è libero. Il motore non si carica
 * all'avvio: lo chiede `App` solo quando il foglio usa formule (vedi `workbookUsesMath`).
 * Idempotente: pianifica il caricamento una sola volta, e non fa nulla se il motore è già pronto.
 */
export function preloadMathJax(): void {
  if (preloadScheduled || isMathJaxReady()) return;
  preloadScheduled = true;
  const start = async (): Promise<void> => {
    try {
      await loadMathJax();
    } catch (err: unknown) {
      console.warn('MathJax non caricato:', err);
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => void start(), { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => void start(), FALLBACK_DELAY_MS);
}
