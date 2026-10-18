import type { Layout, WorldRect } from '@xmap/core';

/**
 * Calcola il riquadro complessivo della mappa in coordinate del mondo,
 * includendo nodi, sommari, relazioni ed etichette, più un margine di sicurezza.
 */
export function computeLayoutBounds(layout: Layout | null, padding: number = 32): WorldRect {
  if (!layout || layout.nodes.length === 0) {
    const content = document.querySelector('svg[data-map-canvas] [data-map-content]');
    if (content instanceof SVGGraphicsElement) {
      try {
        const bbox = content.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          return {
            x: bbox.x - padding,
            y: bbox.y - padding,
            w: bbox.width + 2 * padding,
            h: bbox.height + 2 * padding,
          };
        }
      } catch {
        // Nessun bounding box disponibile dal DOM
      }
    }
    return { x: 0, y: 0, w: 800, h: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of layout.nodes) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x + node.w > maxX) maxX = node.x + node.w;
    if (node.y + node.h > maxY) maxY = node.y + node.h;
  }

  for (const s of layout.summaries) {
    if (s.x < minX) minX = s.x;
    if (s.x + 24 > maxX) maxX = s.x + 24;
    const syMin = Math.min(s.y1, s.y2);
    const syMax = Math.max(s.y1, s.y2);
    if (syMin < minY) minY = syMin;
    if (syMax > maxY) maxY = syMax;
  }

  for (const rel of layout.relationships) {
    if (rel.geometry) {
      const pts = [
        rel.geometry.start,
        rel.geometry.end,
        rel.geometry.handles[0],
        rel.geometry.handles[1],
        rel.geometry.label,
      ];
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (rel.title) {
        const labelW = rel.title.length * 6 + 14;
        const lx1 = rel.geometry.label.x - labelW / 2;
        const lx2 = rel.geometry.label.x + labelW / 2;
        if (lx1 < minX) minX = lx1;
        if (lx2 > maxX) maxX = lx2;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: 0, y: 0, w: 800, h: 600 };
  }

  return {
    x: minX - padding,
    y: minY - padding,
    w: Math.max(1, maxX - minX + 2 * padding),
    h: Math.max(1, maxY - minY + 2 * padding),
  };
}

export interface PrintableClone {
  clone: SVGGElement;
  defs: SVGDefsElement | null;
  innerHtml: string;
}

/**
 * Ottiene un clone pulito del contenuto della mappa in coordinate del mondo,
 * privo di selezioni attive, maniglie di ridimensionamento o elementi UI.
 */
export function getPrintableMapClone(): PrintableClone | null {
  const canvas = document.querySelector('svg[data-map-canvas]');
  if (!canvas) return null;
  const content = canvas.querySelector('[data-map-content]');
  if (!content) return null;

  const clone = content.cloneNode(true) as SVGGElement;

  // 1. Rimuovi elementi marcati da nascondere nella stampa (griglia, maniglie, aloni)
  clone.querySelectorAll('[data-print-hide]').forEach((el) => el.remove());

  // 2. Ripristina il bordo normale per i nodi che erano selezionati
  clone.querySelectorAll('[data-node-rect]').forEach((rect) => {
    const defaultStroke = rect.getAttribute('data-default-stroke');
    if (defaultStroke) {
      rect.setAttribute('stroke', defaultStroke);
      rect.setAttribute('stroke-width', '1');
    }
  });

  // 3. Aree di aggancio invisibili delle relazioni: inutili su carta
  clone.querySelectorAll('path[stroke="transparent"]').forEach((el) => el.remove());

  // 4. Ripristina cursore normale
  clone.querySelectorAll<SVGElement | HTMLElement>('[style*="cursor"]').forEach((el) => {
    el.style.cursor = 'default';
  });

  const defs = (canvas.querySelector('defs')?.cloneNode(true) as SVGDefsElement | null) ?? null;

  return {
    clone,
    defs,
    innerHtml: clone.innerHTML,
  };
}
