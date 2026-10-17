import { useCallback, useEffect, useState, type CSSProperties } from 'react';

/** Larghezza che la mappa deve conservare al centro quando i pannelli sono aperti. */
const MAP_MIN_WIDTH = 360;

/** Configurazione dei pannelli ridimensionabili (larghezze in px, default = larghezze precedenti). */
export const SIDEBAR_PANEL = {
  storageKey: 'xmap-studio.sidebar-width',
  defaultWidth: 280,
  min: 200,
  max: 480,
} as const;

export const INSPECTOR_PANEL = {
  storageKey: 'xmap-studio.inspector-width',
  defaultWidth: 352,
  min: 280,
  max: 560,
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function readStoredWidth(storageKey: string, fallback: number): number {
  const raw = window.localStorage?.getItem(storageKey);
  if (raw === null || raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Larghezza persistita di un pannello laterale. Il valore salvato è quello scelto dall'utente
 * (clamp tra min e max); in lettura si applica anche il limite della viewport, così una finestra
 * stretta non cancella la preferenza. `reservedWidth` è lo spazio già occupato dall'altro pannello.
 */
export function usePanelWidth(
  storageKey: string,
  defaultWidth: number,
  min: number,
  max: number,
  reservedWidth = 0,
): [number, (width: number) => void] {
  const [stored, setStored] = useState(() => clamp(readStoredWidth(storageKey, defaultWidth), min, max));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setWidth = useCallback(
    (next: number) => {
      const value = clamp(Math.round(next), min, max);
      setStored(value);
      window.localStorage?.setItem(storageKey, String(value));
    },
    [storageKey, min, max],
  );

  // Il minimo ha la precedenza: un pannello non scende mai sotto la sua larghezza minima.
  const viewportMax = Math.max(min, Math.min(max, viewportWidth - MAP_MIN_WIDTH - reservedWidth));
  return [clamp(stored, min, viewportMax), setWidth];
}

/** Stile che espone la larghezza alla classe `lg:w-[var(--panel-w)]`: vale solo da `lg` in su. */
export function panelStyle(width: number): CSSProperties {
  return { '--panel-w': `${width}px` } as CSSProperties;
}
