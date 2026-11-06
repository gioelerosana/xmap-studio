import { describe, expect, it, vi } from 'vitest';
import type { Layout, LayoutNode } from '../src/index.js';
// `dragTarget.ts` importa `@xmap/core`: nei test punta ai sorgenti, senza richiedere la build.
vi.mock('@xmap/core', () => import('../src/index.js'));

import { buildDragIndex, computeDropTarget } from '../../../apps/web/src/components/map/dragTarget.js';

function node(id: string, x: number, y: number, extra: Partial<LayoutNode> = {}): LayoutNode {
  return {
    id,
    title: id,
    x,
    y,
    w: 80,
    h: 30,
    kind: 'text',
    labels: [],
    markers: [],
    hasNotes: false,
    childCount: 0,
    collapsed: false,
    group: 'attached',
    depth: 1,
    sheetIndex: 0,
    childrenBelow: false,
    ...extra,
  } as LayoutNode;
}

/** Mappa mentale: radice al centro, `L` e `S` a sinistra, `R` a destra (figli L, S, R). */
function mindMap(): Layout {
  const nodes = [
    node('root', 0, 0, { w: 100, h: 40, depth: 0, group: 'root' }),
    node('L', -200, 0, { side: 'left' }),
    node('R', 150, 0, { side: 'right' }),
    node('S', -200, 200, { side: 'left' }),
  ];
  return {
    nodes,
    edges: [
      { parent: 0, child: 1, group: 'attached', kind: 'branch' },
      { parent: 0, child: 3, group: 'attached', kind: 'branch' },
      { parent: 0, child: 2, group: 'attached', kind: 'branch' },
    ],
    summaries: [],
    relationships: [],
    width: 600,
    height: 300,
  } as unknown as Layout;
}

describe('computeDropTarget nello spazio vuoto', () => {
  it('sui rami sinistri trova il blocco a destra del puntatore (lato dei suoi figli)', () => {
    const layout = mindMap();
    const idx = buildDragIndex(layout);
    // Puntatore a sinistra di `L`, dove andrebbero i suoi figli.
    const drop = computeDropTarget(layout, idx, 3, { x: -260, y: 15 }, new Set([3]));
    expect(drop?.targetId).toBe('L');
    expect(drop?.placement).toBe('into');
  });

  it('sui rami destri resta il blocco a sinistra del puntatore', () => {
    const layout = mindMap();
    const idx = buildDragIndex(layout);
    const drop = computeDropTarget(layout, idx, 3, { x: 300, y: 15 }, new Set([3]));
    expect(drop?.targetId).toBe('R');
  });

  it('accanto alla radice, a sinistra, il bersaglio è la radice', () => {
    const layout = mindMap();
    const idx = buildDragIndex(layout);
    const drop = computeDropTarget(layout, idx, 3, { x: -40, y: 60 }, new Set([3]));
    expect(drop?.targetId).toBe('root');
  });
});
