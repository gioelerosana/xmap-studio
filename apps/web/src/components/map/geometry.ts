import { SUMMARY_BRACE_W, trunkX, type Layout, type LayoutNode } from '@xmap/core';

export const TREE_CORNER_R = 8;
/** Raggio dei raccordi della linea a gomito arrotondato del tema. */
const ELBOW_CORNER_R = 8;

export interface Trunk {
  parent: number;
  x: number;
  y1: number;
  y2: number;
}

/** Un tronco per genitore Tree Chart, fino al centro del figlio più basso. */
export function computeTrunks(l: Layout): Trunk[] {
  const trunkMap = new Map<number, Trunk>();
  for (const edge of l.edges) {
    if (edge.kind !== 'tree') continue;
    const p = l.nodes[edge.parent];
    const c = l.nodes[edge.child];
    if (!p || !c) continue;
    const cy = c.y + c.h / 2;
    const prev = trunkMap.get(edge.parent);
    if (!prev) {
      trunkMap.set(edge.parent, { parent: edge.parent, x: trunkX(p), y1: p.y + p.h, y2: cy });
    } else if (cy > prev.y2) {
      prev.y2 = cy;
    }
  }
  return [...trunkMap.values()].map((t) => ({
    ...t,
    y2: Math.max(t.y2 - TREE_CORNER_R, t.y1),
  }));
}

/**
 * Percorso del connettore padre→figlio: gomito con raccordo per la Tree Chart,
 * altrimenti la linea del tema del genitore (curva se il tema non la dice).
 */
export function edgePathD(edge: Layout['edges'][number], p: LayoutNode, c: LayoutNode): string {
  const endY = c.y + c.h / 2;
  if (edge.kind === 'tree') {
    // Solo gomito + tratto orizzontale: il tronco è disegnato a parte.
    const tx = trunkX(p);
    const r = Math.max(Math.min(TREE_CORNER_R, c.x - tx, endY - (p.y + p.h)), 0);
    return `M ${tx} ${endY - r} Q ${tx} ${endY} ${tx + r} ${endY} L ${c.x} ${endY}`;
  }
  // Ramo sinistro della mappa mentale: esce dal bordo sinistro del genitore ed entra nel destro del figlio.
  const toLeft = c.side === 'left';
  const startX = toLeft ? p.x : p.x + p.w;
  const startY = p.y + p.h / 2;
  const endX = toLeft ? c.x + c.w : c.x;
  const span = endX - startX;
  switch (p.branchLine) {
    case 'straight':
      return `M ${startX} ${startY} L ${endX} ${endY}`;
    case 'elbow':
    case 'roundedElbow': {
      // Gomito a metà strada fra i due blocchi; quello arrotondato raccorda i due angoli.
      const midX = startX + span / 2;
      const dy = endY - startY;
      const r =
        p.branchLine === 'roundedElbow'
          ? Math.max(Math.min(ELBOW_CORNER_R, Math.abs(dy) / 2, Math.abs(span) / 2), 0)
          : 0;
      if (r === 0) return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
      const sy = Math.sign(dy);
      const sx = Math.sign(span);
      return (
        `M ${startX} ${startY} H ${midX - sx * r} Q ${midX} ${startY} ${midX} ${startY + sy * r} ` +
        `V ${endY - sy * r} Q ${midX} ${endY} ${midX + sx * r} ${endY} H ${endX}`
      );
    }
    default: {
      const bend = (toLeft ? -1 : 1) * Math.abs(span) * 0.55;
      return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
    }
  }
}

/**
 * Percorso della graffa di sommario `}` e del raccordo verso il blocco riassunto. Sul
 * lato sinistro (`t.side`) la graffa è lo specchio di quella destra: la punta guarda
 * a sinistra e il raccordo entra nel bordo destro del blocco di sommario.
 */
export function summaryPathD(s: Layout['summaries'][number], t: LayoutNode): string {
  const ym = (s.y1 + s.y2) / 2;
  const hw = SUMMARY_BRACE_W / 2;
  const r = Math.max(Math.min(hw, (s.y2 - s.y1) / 4), 0);
  const toLeft = t.side === 'left';
  const mirror = (x: number): number => (toLeft ? 2 * s.x + SUMMARY_BRACE_W - x : x);
  const backX = mirror(s.x);
  const midX = mirror(s.x + hw);
  const tipX = mirror(s.x + SUMMARY_BRACE_W);
  const linkX = toLeft ? t.x + t.w : t.x;
  return (
    `M ${backX} ${s.y1} Q ${midX} ${s.y1} ${midX} ${s.y1 + r} ` +
    `L ${midX} ${ym - r} Q ${midX} ${ym} ${tipX} ${ym} ` +
    `Q ${midX} ${ym} ${midX} ${ym + r} ` +
    `L ${midX} ${s.y2 - r} Q ${midX} ${s.y2} ${backX} ${s.y2} ` +
    `M ${tipX} ${ym} L ${linkX} ${t.y + t.h / 2}`
  );
}
