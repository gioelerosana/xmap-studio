import { useEffect } from 'react';
import type { LayoutNode } from '@xmap/core';
import type { MapEditing } from './types.js';
import type { Viewport } from './useViewport.js';

/** Porta in vista il blocco in editing. */
export function useRevealNode({
  viewport,
  editing,
  editingNode,
}: {
  viewport: Viewport;
  editing: MapEditing | null;
  editingNode: LayoutNode | null;
}) {
  const { containerRef, viewRef, animateTo } = viewport;

  // Un blocco appena creato può cadere fuori schermo: lo si porta in vista.
  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!editingNode || !rect) return;
    const v = viewRef.current;
    const left = v.x + editingNode.x * v.k;
    const right = left + Math.max(editingNode.w, 120) * v.k;
    const top = v.y + editingNode.y * v.k;
    const bottom = top + editingNode.h * v.k;
    let dx = 0;
    let dy = 0;
    if (left < 16) dx = 16 - left;
    else if (right > rect.width - 16) dx = rect.width - 16 - right;
    if (top < 56) dy = 56 - top;
    else if (bottom > rect.height - 16) dy = rect.height - 16 - bottom;
    if (dx !== 0 || dy !== 0) animateTo({ k: v.k, x: v.x + dx, y: v.y + dy }, 200);
    // Solo quando si apre l'editor su un blocco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, Boolean(editingNode)]);
}
