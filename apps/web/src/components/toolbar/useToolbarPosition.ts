import { useCallback, useState } from 'react';
import type React from 'react';

/**
 * Posizioni di aggancio della barra flottante: in alto al centro (predefinita), in basso al
 * centro, e in verticale sul lato sinistro o destro del contenitore.
 */
export type ToolbarDock = 'top' | 'bottom' | 'left' | 'right';

/** Distanza della barra dal bordo del contenitore a cui è agganciata (px). */
export const TOOLBAR_EDGE_GAP = 12;

/** Spostamento in px dal punto di aggancio mentre la barra segue il puntatore. */
export interface DragOffset {
  x: number;
  y: number;
}

export interface ToolbarPosition {
  /** Da passare a `ref` della radice della barra (`absolute` dentro il contenitore della mappa). */
  barRef: (el: HTMLDivElement | null) => void;
  /** Aggancio corrente; sempre `bottom` quando l'hook è disattivato (schermi stretti). */
  dock: ToolbarDock;
  /** Trascinamento in corso (oltre la soglia): la barra segue il puntatore con `dragOffset`. */
  dragging: boolean;
  /** Scostamento da applicare con `transform` durante il trascinamento; `null` a riposo. */
  dragOffset: DragOffset | null;
  /** Eventi da spargere sulla radice della barra (il trascinamento parte da qualunque punto). */
  dragProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
    /** Annulla il clic che chiude un trascinamento, così il bottone sotto il puntatore non scatta. */
    onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => void;
  };
}

/**
 * Aggancio più vicino al punto `(x, y)`, in coordinate del contenitore largo `width` e alto
 * `height`: vince il bordo a distanza minima.
 */
export function nearestDock(x: number, y: number, width: number, height: number): ToolbarDock {
  void x;
  void y;
  void width;
  void height;
  return 'top';
}

// Segnaposto del contratto: implementazione in arrivo.
export function useToolbarPosition(enabled: boolean): ToolbarPosition {
  const [, setBar] = useState<HTMLDivElement | null>(null);
  const barRef = useCallback((el: HTMLDivElement | null) => setBar(el), []);
  const noop = () => undefined;
  return {
    barRef,
    dock: enabled ? 'top' : 'bottom',
    dragging: false,
    dragOffset: null,
    dragProps: { onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop, onClickCapture: noop },
  };
}
