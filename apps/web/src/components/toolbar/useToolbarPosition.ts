import { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * Durante il trascinamento: aggancio che verrebbe scelto rilasciando ora (`nearestDock` sul
   * puntatore) e misure della barra all'inizio del trascinamento, per disegnare le sagome
   * delle quattro posizioni. `null` a riposo.
   */
  dragPreview: { target: ToolbarDock; barWidth: number; barHeight: number } | null;
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

const DOCK_STORAGE_KEY = 'xmap-studio.toolbar-dock';
/** Chiave della vecchia posizione libera, rimossa al caricamento. */
const LEGACY_POSITION_KEY = 'xmap-studio.toolbar-position';
const DEFAULT_DOCK: ToolbarDock = 'top';
const DOCKS: readonly ToolbarDock[] = ['top', 'bottom', 'left', 'right'];
/** Distanza minima dal punto di pressione oltre cui un gesto diventa trascinamento (px). */
const DRAG_THRESHOLD = 6;

/**
 * Gli eventi di movimento e rilascio arrivano alla `window` e non alla barra: il puntatore può
 * uscire dalla barra in fretta, e la barra non deve perdere il trascinamento.
 */
const noopPointerHandler = (): undefined => undefined;

interface PendingPress {
  pointerId: number;
  startX: number;
  startY: number;
}

type DragPreview = NonNullable<ToolbarPosition['dragPreview']>;

const isToolbarDock = (value: string | null): value is ToolbarDock => DOCKS.some((dock) => dock === value);

/**
 * Aggancio più vicino al punto `(x, y)`, in coordinate del contenitore largo `width` e alto
 * `height`: vince il bordo a distanza minima; a parità prevale top, poi bottom, left, right.
 */
export function nearestDock(x: number, y: number, width: number, height: number): ToolbarDock {
  const candidates: readonly { dock: ToolbarDock; distance: number }[] = [
    { dock: 'top', distance: y },
    { dock: 'bottom', distance: height - y },
    { dock: 'left', distance: x },
    { dock: 'right', distance: width - x },
  ];
  const nearest = candidates.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best));
  return nearest.dock;
}

/** Aggancio sotto il puntatore, con la stessa geometria per il rilascio e per l'anteprima; `null` senza contenitore. */
function dockAtPointer(bar: HTMLDivElement | null, clientX: number, clientY: number): ToolbarDock | null {
  const parent = bar?.offsetParent instanceof HTMLElement ? bar.offsetParent : bar?.parentElement;
  if (!parent) return null;
  const rect = parent.getBoundingClientRect();
  return nearestDock(clientX - rect.left, clientY - rect.top, parent.clientWidth, parent.clientHeight);
}

/** Rimuove la vecchia chiave di posizione e legge l'aggancio salvato, con fallback alla predefinita. */
function loadDock(): ToolbarDock {
  try {
    window.localStorage.removeItem(LEGACY_POSITION_KEY);
  } catch {
    // Archiviazione non disponibile: nulla da ripulire.
  }
  try {
    const stored = window.localStorage.getItem(DOCK_STORAGE_KEY);
    return isToolbarDock(stored) ? stored : DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK;
  }
}

function saveDock(dock: ToolbarDock) {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, dock);
  } catch {
    // Archiviazione non disponibile (modalità privata, quota): l'aggancio vale per la sessione.
  }
}

/**
 * Aggancio della barra flottante a uno dei quattro bordi, salvato in `localStorage`. Il
 * trascinamento parte da qualunque punto della barra oltre una soglia di movimento, così i
 * clic sui bottoni restano normali.
 */
export function useToolbarPosition(enabled: boolean): ToolbarPosition {
  const [storedDock, setStoredDock] = useState<ToolbarDock>(loadDock);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<DragOffset | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const barElementRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<PendingPress | null>(null);
  const draggingRef = useRef(false);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const detachWindowListenersRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);

  const barRef = useCallback((el: HTMLDivElement | null) => {
    barElementRef.current = el;
  }, []);

  const detachWindowListeners = useCallback(() => {
    detachWindowListenersRef.current?.();
    detachWindowListenersRef.current = null;
  }, []);

  useEffect(() => detachWindowListeners, [detachWindowListeners]);

  /** Tiene in sincronia il ref letto dai listener di `window` con lo stato di rendering. */
  const setDraggingState = useCallback((value: boolean) => {
    draggingRef.current = value;
    setDragging(value);
  }, []);

  /** Come `setDraggingState`, per l'anteprima: il ref evita di aggiornare lo stato a ogni movimento. */
  const setDragPreviewState = useCallback((value: DragPreview | null) => {
    dragPreviewRef.current = value;
    setDragPreview(value);
  }, []);

  const finishPress = useCallback(
    (event: PointerEvent, committed: boolean) => {
      const pending = pendingRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      pendingRef.current = null;
      detachWindowListeners();
      if (!draggingRef.current) return;

      const next = committed ? dockAtPointer(barElementRef.current, event.clientX, event.clientY) : null;
      if (next) {
        setStoredDock(next);
        saveDock(next);
      }
      // Il clic che chiude il trascinamento non deve attivare il bottone sotto il puntatore.
      suppressClickRef.current = true;
      setDraggingState(false);
      setDragOffset(null);
      setDragPreviewState(null);
    },
    [detachWindowListeners, setDraggingState, setDragPreviewState],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      suppressClickRef.current = false;
      if (!enabled || e.button !== 0) return;
      // I popover dei pannelli passano per i portali ma risalgono nell'albero React: vanno ignorati.
      if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;

      pendingRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
      detachWindowListeners();

      // Non si usa la cattura del puntatore: sposterebbe il clic lontano dai bottoni della barra.
      const handleMove = (event: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending || pending.pointerId !== event.pointerId) return;
        const offset: DragOffset = { x: event.clientX - pending.startX, y: event.clientY - pending.startY };
        if (!draggingRef.current) {
          if (Math.hypot(offset.x, offset.y) <= DRAG_THRESHOLD) return;
          setDraggingState(true);
          const bar = barElementRef.current;
          const target = dockAtPointer(bar, event.clientX, event.clientY);
          if (target) {
            setDragPreviewState({ target, barWidth: bar?.offsetWidth ?? 0, barHeight: bar?.offsetHeight ?? 0 });
          }
        }
        setDragOffset(offset);
        const current = dragPreviewRef.current;
        const target = dockAtPointer(barElementRef.current, event.clientX, event.clientY);
        if (current && target && target !== current.target) {
          setDragPreviewState({ ...current, target });
        }
      };
      const handleUp = (event: PointerEvent) => finishPress(event, true);
      const handleCancel = (event: PointerEvent) => finishPress(event, false);
      const removeListeners = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
      detachWindowListenersRef.current = removeListeners;
    },
    [enabled, detachWindowListeners, finishPress, setDraggingState, setDragPreviewState],
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  return {
    barRef,
    dock: enabled ? storedDock : 'bottom',
    dragging: enabled && dragging,
    dragOffset: enabled && dragging ? dragOffset : null,
    dragPreview: enabled && dragging ? dragPreview : null,
    dragProps: {
      onPointerDown,
      onPointerMove: noopPointerHandler,
      onPointerUp: noopPointerHandler,
      onPointerCancel: noopPointerHandler,
      onClickCapture,
    },
  };
}
