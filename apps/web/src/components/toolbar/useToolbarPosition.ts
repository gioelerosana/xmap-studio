import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

const STORAGE_KEY = 'xmap-studio.toolbar-position';
/** Distanza dal bordo superiore del contenitore nella posizione predefinita. */
export const TOOLBAR_TOP_GAP = 12;
/** Margine minimo dal bordo inferiore quando la barra è trascinata in basso. */
const TOOLBAR_BOTTOM_GAP = 12;
const HALF = 0.5;

interface Offset {
  x: number;
  y: number;
}
interface Sizes {
  parentW: number;
  parentH: number;
  barW: number;
  barH: number;
}

const ZERO: Offset = { x: 0, y: 0 };
const EMPTY_SIZES: Sizes = { parentW: 0, parentH: 0, barW: 0, barH: 0 };

const isOffset = (value: unknown): value is Offset =>
  typeof value === 'object' &&
  value !== null &&
  'x' in value &&
  'y' in value &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);

function loadOffset(): Offset {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return ZERO;
    const parsed: unknown = JSON.parse(raw);
    return isOffset(parsed) ? { x: parsed.x, y: parsed.y } : ZERO;
  } catch {
    return ZERO;
  }
}

function saveOffset(offset: Offset | null) {
  try {
    if (offset) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(offset));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Archiviazione non disponibile (modalità privata, quota): la posizione vale per la sessione.
  }
}

/** Limita lo scostamento in modo che l'intera barra resti dentro il contenitore. */
export function clampOffset(offset: Offset, s: Sizes): Offset {
  const slackX = Math.max(0, (s.parentW - s.barW) * HALF);
  const minY = -TOOLBAR_TOP_GAP;
  const maxY = Math.max(minY, s.parentH - s.barH - TOOLBAR_TOP_GAP - TOOLBAR_BOTTOM_GAP);
  return {
    x: Math.min(slackX, Math.max(-slackX, offset.x)),
    y: Math.min(maxY, Math.max(minY, offset.y)),
  };
}

export interface ToolbarPosition {
  /** Da passare a `ref` della radice della barra (che deve essere `absolute`, centrata in alto). */
  barRef: (el: HTMLDivElement | null) => void;
  /** Spostamento in px da applicare con `transform` alla posizione predefinita. */
  offset: Offset;
  /** `bottom` quando la barra sta nella metà inferiore del contenitore. */
  dock: 'top' | 'bottom';
  dragging: boolean;
  /** Eventi da spargere sull'impugnatura. */
  gripProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
  };
}

/**
 * Posizione trascinabile della barra flottante. Lo scostamento (non la posizione assoluta)
 * dal punto predefinito, in alto al centro del contenitore, è salvato in `localStorage` e
 * limitato a ogni misura, così la barra non esce mai dall'area visibile.
 */
export function useToolbarPosition(enabled: boolean): ToolbarPosition {
  const [stored, setStored] = useState<Offset>(loadOffset);
  const [sizes, setSizes] = useState<Sizes>(EMPTY_SIZES);
  const [dragging, setDragging] = useState(false);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Offset } | null>(null);

  const barRef = useCallback((el: HTMLDivElement | null) => setBar(el), []);

  // Misure della barra e del suo contenitore: aggiornate a ogni cambio di dimensione.
  useEffect(() => {
    if (!bar) return;
    const parent = bar.offsetParent instanceof HTMLElement ? bar.offsetParent : bar.parentElement;
    if (!parent) return;
    const measure = () => {
      const next: Sizes = {
        parentW: parent.clientWidth,
        parentH: parent.clientHeight,
        barW: bar.offsetWidth,
        barH: bar.offsetHeight,
      };
      setSizes((prev) => (prev.parentW === next.parentW && prev.parentH === next.parentH && prev.barW === next.barW && prev.barH === next.barH ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [bar]);

  const offset = useMemo(() => (enabled ? clampOffset(stored, sizes) : ZERO), [enabled, stored, sizes]);

  const dock = useMemo(() => {
    if (!enabled) return 'bottom';
    const centerY = TOOLBAR_TOP_GAP + offset.y + sizes.barH * HALF;
    return sizes.parentH > 0 && centerY > sizes.parentH * HALF ? 'bottom' : 'top';
  }, [enabled, offset.y, sizes]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      // Evita di sottrarre il focus all'editor in place e la selezione di testo durante il trascinamento.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: offset };
      setDragging(true);
    },
    [enabled, offset],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setStored(
        clampOffset({ x: drag.origin.x + e.clientX - drag.startX, y: drag.origin.y + e.clientY - drag.startY }, sizes),
      );
    },
    [sizes],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      saveOffset(clampOffset(stored, sizes));
    },
    [stored, sizes],
  );

  const reset = useCallback(() => {
    setStored(ZERO);
    saveOffset(null);
  }, []);

  return {
    barRef,
    offset,
    dock,
    dragging,
    gripProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onDoubleClick: reset },
  };
}
