import type { Layout } from '@xmap/core';

/** Vista della mappa: traslazione in pixel dello schermo e fattore di zoom. */
export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 3.5;
export const clampZoom = (k: number) => Math.min(Math.max(k, MIN_ZOOM), MAX_ZOOM);

// Smartphone: sotto questa larghezza l'adattamento non scende sotto uno zoom
// leggibile e il pannello dettagli è un bottom sheet che copre la parte bassa.
export const COMPACT_WIDTH = 640;
export const MIN_READABLE_ZOOM = 0.65;

/**
 * Vista che inquadra tutto il layout in un'area `width` × `height`; `null` se non c'è nulla
 * da inquadrare o l'area è troppo piccola.
 */
export function computeFitView(layout: Layout, width: number, height: number): View | null {
  if (layout.nodes.length === 0 || width <= 10 || height <= 10) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of layout.nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x + node.w);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y + node.h);
  }

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const margin = 64;
  const scaleX = (width - margin * 2) / Math.max(contentW, 100);
  const scaleY = (height - margin * 2) / Math.max(contentH, 100);
  const k = Math.max(Math.min(scaleX, scaleY, 1.15), MIN_ZOOM);
  if (width < COMPACT_WIDTH && k < MIN_READABLE_ZOOM) {
    // Mappa intera illeggibile sul telefono: si parte dalla radice a zoom leggibile,
    // allineando il contenuto a sinistra e la radice al centro (o in alto, se è lì).
    const kr = MIN_READABLE_ZOOM;
    const root = layout.nodes.find((n) => n.depth === 0) ?? layout.nodes[0];
    const pad = 16;
    return {
      k: kr,
      x: pad - minX * kr,
      y: Math.min(height / 2 - (root.y + root.h / 2) * kr, pad - minY * kr),
    };
  }
  return {
    k,
    x: (width - contentW * k) / 2 - minX * k,
    y: (height - contentH * k) / 2 - minY * k,
  };
}
