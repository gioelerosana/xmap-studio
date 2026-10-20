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

  // Layout effettivo con anteprima live durante il ridimensionamento
  const effectiveLayout = useMemo(() => {
    if (!layout) return null;
    if (!resizing) return layout;
    const nodeIdx = layout.nodes.findIndex((n) => n.id === resizing.topicId);
    if (nodeIdx === -1) return layout;
    const targetNode = layout.nodes[nodeIdx];
    const deltaW = resizing.width - targetNode.w;
    const desc = subtreeOf(layout, nodeIdx);
    const newNodes = layout.nodes.map((n, i) => {
      if (i === nodeIdx) {
        return {
          ...n,
          w: resizing.width,
          h: resizing.height ?? n.h,
          imageW: resizing.imageSize ? resizing.imageSize.width : n.imageW,
          imageH: resizing.imageSize ? resizing.imageSize.height : n.imageH,
        };
      }
      if (desc.has(i)) {
        return { ...n, x: n.x + deltaW };
      }
      return n;
    });
    return { ...layout, nodes: newNodes };
  }, [layout, resizing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeResizeRef.current) {
        activeResizeRef.current = null;
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

      const startPtr = { x: e.clientX, y: e.clientY };
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
        const dx = currWorld.x - state.startWorld.x;

        if (state.type === 'width') {
          const liveW = Math.max(40, Math.round(state.startWidth + dx));
          const { h: liveH } = estimateNodeSize(node, liveW);
          setResizing({ topicId: node.id, width: liveW, height: liveH });
        } else if (state.type === 'image') {
          const ratio = state.startImageW / Math.max(1, state.startImageH);
          const liveImageW = Math.max(40, Math.round(state.startImageW + dx));
          const liveImageH = Math.max(30, Math.round(liveImageW / ratio));
          const { w: liveW, h: liveH } = estimateNodeSize({
            ...node,
            imageW: liveImageW,
            imageH: liveImageH,
          });
          setResizing({
            topicId: node.id,
            width: liveW,
            height: liveH,
            imageSize: { width: liveImageW, height: liveImageH },
          });
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        const state = activeResizeRef.current;
        activeResizeRef.current = null;
        const currentResizing = resizingRef.current;
        setResizing(null);

        if (state && state.moved && currentResizing) {
          if (state.type === 'width') {
            handlers.current.onResizeTopicWidth?.(state.topicId, currentResizing.width);
          } else if (state.type === 'image' && currentResizing.imageSize) {
            handlers.current.onResizeTopicImage?.(state.topicId, currentResizing.imageSize);
          }
        } else if (state && !state.moved && state.type === 'width') {
          // Doppio tap su touch per rimuovere customWidth
          const now = performance.now();
          if (now - lastWidthTapRef.current < 320) {
            lastWidthTapRef.current = 0;
            handlers.current.onResizeTopicWidth?.(state.topicId, null);
          } else {
            lastWidthTapRef.current = now;
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [toWorld]
  );

  return { effectiveLayout, startResize };
}
