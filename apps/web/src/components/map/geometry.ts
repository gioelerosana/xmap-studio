import { SUMMARY_BRACE_W, trunkX, type Layout, type LayoutNode } from '@xmap/core';

export const TREE_CORNER_R = 8;

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

/** Percorso del connettore padre→figlio: gomito con raccordo per la Tree Chart, curva altrimenti. */
export function edgePathD(edge: Layout['edges'][number], p: LayoutNode, c: LayoutNode): string {
  const endY = c.y + c.h / 2;
  if (edge.kind === 'tree') {
    // Solo gomito + tratto orizzontale: il tronco è disegnato a parte.
    const tx = trunkX(p);
    const r = Math.max(Math.min(TREE_CORNER_R, c.x - tx, endY - (p.y + p.h)), 0);
    return `M ${tx} ${endY - r} Q ${tx} ${endY} ${tx + r} ${endY} L ${c.x} ${endY}`;
  }
  const startX = p.x + p.w;
  const startY = p.y + p.h / 2;
  const deltaX = Math.abs(c.x - startX) * 0.55;
  return `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${c.x - deltaX} ${endY}, ${c.x} ${endY}`;
}

/** Percorso della graffa di sommario `}` e del raccordo verso il blocco riassunto. */
export function summaryPathD(s: Layout['summaries'][number], t: LayoutNode): string {
  const ym = (s.y1 + s.y2) / 2;
  const hw = SUMMARY_BRACE_W / 2;
  const r = Math.max(Math.min(hw, (s.y2 - s.y1) / 4), 0);
  return (
    `M ${s.x} ${s.y1} Q ${s.x + hw} ${s.y1} ${s.x + hw} ${s.y1 + r} ` +
    `L ${s.x + hw} ${ym - r} Q ${s.x + hw} ${ym} ${s.x + SUMMARY_BRACE_W} ${ym} ` +
    `Q ${s.x + hw} ${ym} ${s.x + hw} ${ym + r} ` +
    `L ${s.x + hw} ${s.y2 - r} Q ${s.x + hw} ${s.y2} ${s.x} ${s.y2} ` +
    `M ${s.x + SUMMARY_BRACE_W} ${ym} L ${t.x} ${t.y + t.h / 2}`
  );
}
