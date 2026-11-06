import { useCallback, useRef } from 'react';

/**
 * Funzione con identità fissa che chiama sempre l'ultima versione di `fn`.
 *
 * Perché: App passa decine di callback a MapView, barra flottante e header;
 * ricrearle a ogni render (toast, busy, popover, selezione…) annullerebbe il
 * `React.memo` di quei componenti e ridisegnerebbe tutta la mappa. La ref si
 * aggiorna durante il render, non in un effetto: così anche le cleanup dei
 * figli eseguite nello stesso commit (es. un editor che conferma smontandosi)
 * vedono già la versione nuova. Da usare solo per gestori di eventi, mai per
 * funzioni chiamate durante il render.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
