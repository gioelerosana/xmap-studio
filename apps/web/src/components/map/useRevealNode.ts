import { useEffect } from 'react';
import type { LayoutNode } from '@xmap/core';
import type { MapEditing } from './types.js';
import type { Viewport } from './useViewport.js';
import { COMPACT_WIDTH } from './viewport.js';

const SHEET_VISIBLE_FRACTION = 0.4; // parte del canvas lasciata libera dal bottom sheet

/** Porta in vista il blocco in editing e, sullo smartphone, il blocco con il pannello dettagli aperto. */
export function useRevealNode({
  viewport,
  editing,
  editingNode,
  selectedNode,
  detailsOpen,
}: {
  viewport: Viewport;
  editing: MapEditing | null;
  editingNode: LayoutNode | null;
  selectedNode: LayoutNode | null;
  detailsOpen: boolean;
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

  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!detailsOpen || !selectedNode || !rect || rect.width >= COMPACT_WIDTH) return;
    const v = viewRef.current;
    const cy = v.y + (selectedNode.y + selectedNode.h / 2) * v.k;
    const cx = v.x + (selectedNode.x + selectedNode.w / 2) * v.k;
    const visibleH = rect.height * SHEET_VISIBLE_FRACTION;
    const insideY = cy > 56 && cy < visibleH - 16;
    const insideX = cx > 16 && cx < rect.width - 16;
    if (insideY && insideX) return;
    animateTo(
      {
        k: v.k,
        x: insideX ? v.x : rect.width / 2 - (selectedNode.x + selectedNode.w / 2) * v.k,
        y: visibleH * 0.6 - (selectedNode.y + selectedNode.h / 2) * v.k,
      },
      240
    );
  }, [detailsOpen, selectedNode, animateTo]);

}
