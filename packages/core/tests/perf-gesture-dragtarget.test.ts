import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT_OPTS, layoutSheets } from '../src/index.js';
import type { Layout, MapStructure, SheetDto, TopicView } from '../src/index.js';
// `dragTarget.ts` importa `@xmap/core`: nei test punta ai sorgenti, senza richiedere la build.
vi.mock('@xmap/core', () => import('../src/index.js'));

import {
  buildDragIndex,
  computeDropTarget,
  computeDropTargetIn,
  prepareDrop,
  subtreeOf,
} from '../../../apps/web/src/components/map/dragTarget.js';
import { computeDropTarget as referenceDropTarget } from './perf-gesture-dragtarget.reference.js';

/** Foglio sintetico: albero di `n` blocchi (6 figli per livello), con sommari e un blocco libero. */
function sheet(index: number, n: number): SheetDto {
  const topics: TopicView[] = [];
  let c = 0;
  const mk = (depth: number, parentId?: string, group = parentId ? 'attached' : '') => {
    const id = `s${index}t${c++}`;
    const t: TopicView = {
      id,
      sheetIndex: index,
      parentId,
      depth,
      group,
      title: `Blocco ${id}`,
      displayTitle: `Blocco ${id}`,
      kind: 'text',
      notes: '',
      labels: [],
      markers: [],
      childCount: 0,
      boundaries: [],
      summaries: [],
    };
    topics.push(t);
    if (depth < 4 && group === 'attached' || depth === 0) {
      for (let i = 0; i < 6 && c < n; i++) {
        mk(depth + 1, id);
        t.childCount++;
      }
      if (depth === 1 && t.childCount >= 3) {
        const s = mk(depth + 1, id, 'summary');
        t.summaries.push({ id: s, range: '(0,1)' });
      }
    }
    return id;
  };
  const root = mk(0);
  mk(1, root, 'detached');
  return { index, title: `Foglio ${index}`, topics, relationships: [] };
}

function layoutOf(n: number, structure: MapStructure): Layout {
  return layoutSheets([sheet(0, n), sheet(1, Math.floor(n / 4))], new Set(), undefined, {
    ...DEFAULT_LAYOUT_OPTS,
    structure,
  });
}

/** Punti su una griglia che copre la mappa (bordi compresi), più i centri e i bordi dei blocchi. */
function probePoints(l: Layout, count: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      pts.push({ x: -120 + ((l.width + 240) * i) / side, y: -120 + ((l.height + 240) * j) / side });
    }
  }
  for (const n of l.nodes.slice(0, 300)) {
    pts.push({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, { x: n.x + 2, y: n.y + 1 }, { x: n.x + n.w - 2, y: n.y + n.h + 8 });
  }
  return pts;
}

describe('computeDropTarget con contesto precalcolato', () => {
  for (const structure of ['map', 'logic', 'tree'] as MapStructure[]) {
    it(`${structure}: stessi bersagli della versione precedente`, () => {
      const l = layoutOf(400, structure);
      const idx = buildDragIndex(l);
      const pts = probePoints(l, 900);
      // Sorgenti: foglie, rami interni e un blocco del secondo foglio.
      const sources = [3, 8, 40, 77, l.nodes.findIndex((n) => n.sheetIndex === 1 && n.depth === 2)];
      let targets = 0;
      for (const src of sources) {
        expect(src).toBeGreaterThan(0);
        const ex = subtreeOf(l, src);
        const ctx = prepareDrop(l, idx, src, ex);
        for (const p of pts) {
          const expected = referenceDropTarget(l, idx, src, p, ex);
          expect(computeDropTargetIn(ctx, p)).toEqual(expected);
          expect(computeDropTarget(l, idx, src, p, ex)).toEqual(expected);
          if (expected) targets++;
        }
      }
      // Il confronto ha senso solo se molti punti cadono su un bersaglio.
      expect(targets).toBeGreaterThan(200);
    });
  }

  it('sorgente inesistente: nessun bersaglio', () => {
    const l = layoutOf(50, 'map');
    const idx = buildDragIndex(l);
    expect(computeDropTargetIn(prepareDrop(l, idx, 9999, new Set([9999])), { x: 0, y: 0 })).toBeNull();
  });
});

// Misura a richiesta: `XMAP_BENCH=1 pnpm --filter @xmap/core exec vitest run perf-gesture`.
describe.skipIf(!process.env.XMAP_BENCH)('benchmark computeDropTarget', () => {
  it('per frame, mappe da 500 a 2000 blocchi', () => {
    for (const n of [500, 1000, 2000]) {
      const l = layoutOf(n, 'map');
      const idx = buildDragIndex(l);
      const src = 5;
      const ex = subtreeOf(l, src);
      const pts = probePoints(l, 2000);
      const time = (fn: () => void) => {
        fn();
        const t0 = performance.now();
        for (let r = 0; r < 5; r++) fn();
        return ((performance.now() - t0) / (5 * pts.length)) * 1000;
      };
      const before = time(() => pts.forEach((p) => referenceDropTarget(l, idx, src, p, ex)));
      const ctx = prepareDrop(l, idx, src, ex);
      const after = time(() => pts.forEach((p) => computeDropTargetIn(ctx, p)));
      console.log(`${l.nodes.length} blocchi: prima ${before.toFixed(1)} µs/frame, dopo ${after.toFixed(1)} µs/frame`);
    }
  }, 60_000);
});
