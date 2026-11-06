import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { estimateNodeSize, type Layout, type LayoutNode, type Point } from '@xmap/core';
import { subtreeOf } from './dragTarget.js';
import type { MapHandlers } from './types.js';

interface ResizeState {
  topicId: string;
  width: number;
  height?: number;
  imageSize?: { width: number; height: number };
}

interface ActiveResize {
  type: 'width' | 'image';
  topicId: string;
  startPtr: { x: number; y: number };
  startWorld: Point;
  startWidth: number;
  startHeight: number;
  startImageW: number;
  startImageH: number;
  moved: boolean;
}

/** Ridimensionamento di larghezza e immagine dei blocchi, con anteprima live del layout. */
export function useTopicResize({
  layout,
  toWorld,
  handlers,
}: {
  layout: Layout | null;
  toWorld: (clientX: number, clientY: number) => Point;
  handlers: { readonly current: MapHandlers };
}) {
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const resizingRef = useRef<ResizeState | null>(null);
  resizingRef.current = resizing;
  const activeResizeRef = useRef<ActiveResize | null>(null);
  const lastWidthTapRef = useRef<number>(0);
  /** Stacca i listener su `window` del ridimensionamento in corso, se c'è. */
  const detachRef = useRef<(() => void) | null>(null);
  // Anteprima in attesa del prossimo frame: con la penna (240 Hz) i pointermove sono più dei frame,
  // e ogni `setResizing` rifà il layout effettivo e il render della mappa.
  const pendingRef = useRef<ResizeState | null>(null);
  const frameRef = useRef(0);

  // Smontaggio a metà ridimensionamento: i listener su `window` non devono sopravvivere al componente.
  useEffect(
    () => () => {
      detachRef.current?.();
      activeResizeRef.current = null;
      cancelAnimationFrame(frameRef.current);
    },
    []
  );

  // Una sola anteprima per frame; uguale alla precedente (larghezza arrotondata) non fa render.
  const queueResizing = useCallback((next: ResizeState) => {
    const cur = pendingRef.current ?? resizingRef.current;
    if (
      cur &&
      cur.topicId === next.topicId &&
      cur.width === next.width &&
      cur.height === next.height &&
      cur.imageSize?.width === next.imageSize?.width &&
      cur.imageSize?.height === next.imageSize?.height
    ) {
      return;
    }
    pendingRef.current = next;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const p = pendingRef.current;
      pendingRef.current = null;
      if (p && activeResizeRef.current) setResizing(p);
    });
  }, []);

  const cancelQueued = () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    pendingRef.current = null;
  };

  // Sotto-albero del blocco ridimensionato: si calcola una volta per gesto, non a ogni frame.
  const resizingId = resizing?.topicId;
  const resizeSubtree = useMemo(() => {
    if (!layout || !resizingId) return null;
    const i = layout.nodes.findIndex((n) => n.id === resizingId);
    return i < 0 ? null : subtreeOf(layout, i);
  }, [layout, resizingId]);

  // Layout effettivo con anteprima live durante il ridimensionamento
  const effectiveLayout = useMemo(() => {
    if (!layout) return null;
    if (!resizing) return layout;
    const nodeIdx = layout.nodes.findIndex((n) => n.id === resizing.topicId);
    if (nodeIdx === -1) return layout;
    const targetNode = layout.nodes[nodeIdx];
    const deltaW = resizing.width - targetNode.w;
    // Sul lato sinistro il blocco resta agganciato al bordo destro: cresce verso sinistra e i figli lo seguono.
    const toLeft = targetNode.side === 'left';
    const desc = resizeSubtree ?? new Set<number>();
    const newNodes = layout.nodes.map((n, i) => {
      if (i === nodeIdx) {
        return {
          ...n,
          x: toLeft ? n.x - deltaW : n.x,
          w: resizing.width,
          h: resizing.height ?? n.h,
          imageW: resizing.imageSize ? resizing.imageSize.width : n.imageW,
          imageH: resizing.imageSize ? resizing.imageSize.height : n.imageH,
        };
      }
      if (desc.has(i)) {
        return { ...n, x: n.x + (toLeft ? -deltaW : deltaW) };
      }
      return n;
    });
    return { ...layout, nodes: newNodes };
  }, [layout, resizing, resizeSubtree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeResizeRef.current) {
        activeResizeRef.current = null;
        cancelQueued();
        setResizing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startResize = useCallback(
    (e: React.PointerEvent<SVGElement>, node: LayoutNode, type: 'width' | 'image') => {
      e.stopPropagation();
      e.preventDefault();

      // Un secondo ridimensionamento (multi-touch) sostituisce il primo: i suoi listener se ne vanno.
      detachRef.current?.();

      const startPtr = { x: e.clientX, y: e.clientY };
      const isMouse = e.pointerType === 'mouse';
      const startWorld = toWorld(e.clientX, e.clientY);
      const startWidth = node.w;
      const startHeight = node.h;
      const startImageW = node.imageW ?? Math.max(node.w - 16, 20);
      const startImageH = node.imageH ?? Math.max(node.h - 8, 20);

      activeResizeRef.current = {
        type,
        topicId: node.id,
        startPtr,
        startWorld,
        startWidth,
        startHeight,
        startImageW,
        startImageH,
        moved: false,
      };

      const onMove = (pe: PointerEvent) => {
        const state = activeResizeRef.current;
        if (!state) return;
        if (!state.moved && Math.hypot(pe.clientX - state.startPtr.x, pe.clientY - state.startPtr.y) >= 3) {
          state.moved = true;
        }
        if (!state.moved) return;

        const currWorld = toWorld(pe.clientX, pe.clientY);
        // Sul lato sinistro il bordo che si trascina è quello sinistro: trascinare a sinistra allarga il blocco.
        const dx = (node.side === 'left' ? -1 : 1) * (currWorld.x - state.startWorld.x);

        if (state.type === 'width') {
          const liveW = Math.max(40, Math.round(state.startWidth + dx));
          const { h: liveH } = estimateNodeSize(node, liveW);
          queueResizing({ topicId: node.id, width: liveW, height: liveH });
        } else if (state.type === 'image') {
          const ratio = state.startImageW / Math.max(1, state.startImageH);
          const liveImageW = Math.max(40, Math.round(state.startImageW + dx));
          const liveImageH = Math.max(30, Math.round(liveImageW / ratio));
          const { w: liveW, h: liveH } = estimateNodeSize({
            ...node,
            imageW: liveImageW,
            imageH: liveImageH,
          });
          queueResizing({
            topicId: node.id,
            width: liveW,
            height: liveH,
            imageSize: { width: liveImageW, height: liveImageH },
          });
        }
      };

      const onUp = () => {
        detach();

        const state = activeResizeRef.current;
        activeResizeRef.current = null;
        // L'ultima anteprima può essere ancora in attesa del frame: conta quella.
        const currentResizing = pendingRef.current ?? resizingRef.current;
        cancelQueued();
        setResizing(null);

        if (state && state.moved && currentResizing) {
          if (state.type === 'width') {
            handlers.current.onResizeTopicWidth?.(state.topicId, currentResizing.width);
          } else if (state.type === 'image' && currentResizing.imageSize) {
            handlers.current.onResizeTopicImage?.(state.topicId, currentResizing.imageSize);
          }
        } else if (state && !state.moved && state.type === 'width' && !isMouse) {
          // Doppio tap su touch per rimuovere customWidth; col mouse lo fa già `onDoubleClick`
          // della maniglia, e contarlo due volte registrerebbe due passi di annullamento.
          const now = performance.now();
          if (now - lastWidthTapRef.current < 320) {
            lastWidthTapRef.current = 0;
            handlers.current.onResizeTopicWidth?.(state.topicId, null);
          } else {
            lastWidthTapRef.current = now;
          }
        }
      };

      const detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (detachRef.current === detach) detachRef.current = null;
      };
      detachRef.current = detach;
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [toWorld, queueResizing]
  );

  return { effectiveLayout, startResize };
}
