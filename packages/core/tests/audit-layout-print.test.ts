import { describe, expect, it } from 'vitest';
import { MM_TO_PX } from '../src/print/paginate.js';
import { BRANCH_HEADER_MM, paginateByBranches } from '../src/print/branches.js';
import type { Layout, LayoutNode } from '../src/layout/types.js';

function node(id: string, y: number, h: number): LayoutNode {
  return {
    id,
    title: id,
    displayTitle: id,
    x: 0,
    y,
    w: 100,
    h,
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
  };
}

describe('impaginazione per rami: taglio duro', () => {
  it('risalendo sopra un blocco non taglia a metà un blocco già controllato', () => {
    // Area utile di una pagina A4 verticale con margini 10 mm e intestazione, a scala 1.
    const pageH = (297 - 2 * 10 - BRANCH_HEADER_MM) * MM_TO_PX;
    // Nessuno spazio libero tra i blocchi: niente candidati, si taglia "duro".
    // `a` sta tutto nella pagina, `b` attraversa il fondo: il taglio sale all'inizio di `b`,
    // che cade dentro `a`, e quindi deve salire ancora all'inizio di `a`.
    const a = node('a', pageH - 100, 80);
    const b = node('b', pageH - 50, 250);
    const filler = node('c', 0, pageH - 100);
    const tail = node('d', pageH + 200, 1500);
    const layout: Layout = {
      nodes: [filler, a, b, tail],
      edges: [],
      summaries: [],
      relationships: [],
      width: 100,
      height: pageH + 1700,
    };
    const plan = paginateByBranches(
      layout,
      { x: 0, y: 0, w: 100, h: pageH + 1700 },
      { paper: 'A4', orientation: 'portrait', marginMm: 10, maxScale: 1 }
    );
    expect(plan.scale).toBe(1);
    for (const page of plan.pages.slice(1)) {
      for (const n of layout.nodes) {
        const inside = n.y + 1e-6 < page.world.y && page.world.y < n.y + n.h - 1e-6;
        // Un blocco più alto della pagina non si può evitare di tagliarlo.
        if (n.h <= pageH) expect(inside, `pagina a ${page.world.y} taglia ${n.id}`).toBe(false);
      }
    }
    expect(plan.pages[1]?.world.y).toBeCloseTo(a.y, 6);
  });
});
