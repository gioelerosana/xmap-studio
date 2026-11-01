import { useSyncExternalStore } from 'react';
import { isMathJaxReady, loadMathJax, onMathJaxReady } from '@xmap/core';

/**
 * true quando MathJax è caricato. Il motore arriva con un import dinamico
 * (`preloadMathJax`): finché manca, mappa e titoli mostrano le formule come
 * sorgente, poi si ridisegnano da soli.
 */
export function useMathJaxReady(): boolean {
  return useSyncExternalStore(onMathJaxReady, isMathJaxReady, isMathJaxReady);
}

/**
 * Avvia il caricamento di MathJax quando il browser è libero, dopo il primo disegno:
 * l'avvio non aspetta il motore, che di solito è pronto prima che serva una formula.
 */
export function preloadMathJax(): void {
  const start = () => {
    loadMathJax().catch((err: unknown) => console.warn('MathJax non caricato:', err));
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 200);
}
