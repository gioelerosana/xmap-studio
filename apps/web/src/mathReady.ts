import { useSyncExternalStore } from 'react';
import { getMathJaxVersion, isMathJaxReady, loadMathJax, onMathJaxReady } from '@xmap/core';

/**
 * true quando il motore MathJax è caricato. Resta true anche quando arrivano
 * glifi nuovi: per quelli serve `useMathJaxVersion`. Il motore arriva con un import
 * dinamico (`preloadMathJax`): finché manca, mappa e titoli mostrano le formule come
 * sorgente, poi si ridisegnano da soli.
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

/**
 * Avvia il caricamento di MathJax quando il browser è libero, dopo il primo disegno:
 * l'avvio non aspetta il motore, che di solito è pronto prima che serva una formula.
 */
export function preloadMathJax(): void {
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
