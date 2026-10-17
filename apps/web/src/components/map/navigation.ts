import type { Layout, LayoutNode } from '@xmap/core';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

interface Index {
  parent: Map<number, number>;
  children: Map<number, number[]>;
}

function buildIndex(layout: Layout): Index {
  const parent = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const e of layout.edges) {
    parent.set(e.child, e.parent);
    const list = children.get(e.parent) ?? [];
    list.push(e.child);
    children.set(e.parent, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => layout.nodes[a].y - layout.nodes[b].y);
  }
  return { parent, children };
}

const cy = (n: LayoutNode) => n.y + n.h / 2;

/**
 * Blocco raggiunto con una freccia, in base alle coordinate del layout:
 * sinistra = genitore, destra = primo figlio (nella Tree Chart, giù dalla radice
 * = primo figlio); su/giù = blocco più vicino in verticale allo stesso livello,
 * a partire dal genitore più prossimo. `undefined` se non c'è nulla in quella direzione.
 */
export function neighborId(layout: Layout, id: string, dir: NavDirection): string | undefined {
  const i = layout.nodes.findIndex((n) => n.id === id);
  if (i < 0) return undefined;
  const { parent, children } = buildIndex(layout);
  const node = layout.nodes[i];
  const kids = children.get(i) ?? [];
  const p = parent.get(i);

  if (dir === 'left') return p === undefined ? undefined : layout.nodes[p].id;
  if (dir === 'right') return kids.length > 0 ? layout.nodes[kids[0]].id : undefined;
  if (dir === 'down' && node.childrenBelow && kids.length > 0) return layout.nodes[kids[0]].id;

  const sign = dir === 'down' ? 1 : -1;
  let best: LayoutNode | undefined;
  let bestScore = Infinity;
  layout.nodes.forEach((n, j) => {
    if (j === i || n.depth !== node.depth || n.sheetIndex !== node.sheetIndex) return;
    const dy = (cy(n) - cy(node)) * sign;
    if (dy <= 1) return;
    const score = dy + Math.abs(n.x - node.x) * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  });
  if (best) return best.id;
  // Primo figlio di un genitore con figli sotto di sé: su = genitore.
  if (dir === 'up' && p !== undefined && layout.nodes[p].childrenBelow) return layout.nodes[p].id;
  return undefined;
}

/** Selezione dopo l'eliminazione di `id`: fratello successivo, precedente, altrimenti genitore. */
export function selectionAfterDelete(layout: Layout, id: string): string | undefined {
  const i = layout.nodes.findIndex((n) => n.id === id);
  if (i < 0) return undefined;
  const { parent, children } = buildIndex(layout);
  const p = parent.get(i);
  if (p === undefined) return undefined;
  const sibs = children.get(p) ?? [];
  const pos = sibs.indexOf(i);
  const pick = sibs[pos + 1] ?? sibs[pos - 1] ?? p;
  return layout.nodes[pick].id;
}
