import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

/** Livelli di compattazione dell'header: da questo livello in poi l'elemento va nel menu. */
const HEADER_LEVEL = { iconsOnly: 1, redoTheme: 2, title: 3, undo: 4, open: 5, max: 5 } as const;

export interface HeaderLayout {
  showLabels: boolean;
  inlineDetails: boolean;
  inlineRedo: boolean;
  inlineUndo: boolean;
  inlineOpen: boolean;
  showTitle: boolean;
}

/**
 * Header adattivo: se i pulsanti non ci stanno si sale di livello e le azioni
 * meno usate passano nel menu ⋮ (vedi HEADER_LEVEL). Si misura lo spazio reale,
 * non la viewport: conta anche la dimensione del testo impostata nel sistema.
 */
export function useAdaptiveHeader(hasWorkbook: boolean) {
  const headerRef = useRef<HTMLElement>(null);
  const [headerLevel, setHeaderLevel] = useState(0);
  const [, forceHeaderMeasure] = useReducer((n: number) => n + 1, 0);
  // Cambiano i pulsanti presenti: si riparte dal livello pieno. Va prima della misura,
  // così i due aggiornamenti si compongono invece di annullarsi.
  useLayoutEffect(() => setHeaderLevel(0), [hasWorkbook]);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (el && el.scrollWidth > el.clientWidth + 1 && headerLevel < HEADER_LEVEL.max) {
      setHeaderLevel((l) => l + 1);
    }
  });
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let width = el.clientWidth;
    // Si osservano anche i gruppi interni: font caricati tardi o pulsanti che
    // cambiano possono creare overflow senza che l'header cambi larghezza.
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        setHeaderLevel(0);
      }
      forceHeaderMeasure();
    });
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, []);

  const layout: HeaderLayout = {
    showLabels: headerLevel < HEADER_LEVEL.iconsOnly,
    inlineDetails: headerLevel < HEADER_LEVEL.redoTheme,
    inlineRedo: headerLevel < HEADER_LEVEL.redoTheme,
    inlineUndo: headerLevel < HEADER_LEVEL.undo,
    inlineOpen: headerLevel < HEADER_LEVEL.open,
    showTitle: headerLevel < HEADER_LEVEL.title,
  };
  return { headerRef, layout };
}
