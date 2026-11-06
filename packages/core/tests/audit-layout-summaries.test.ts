import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_OPTS,
  Layout,
  LayoutNode,
  MapStructure,
  SUMMARY_BRACE_W,
  SheetDto,
  TopicView,
  estimateNodeSize,
  layoutSheets,
} from '../src/index.js';

function topic(id: string, parentId: string | undefined, depth: number, over: Partial<TopicView> = {}): TopicView {
  return {
    id,
    sheetIndex: 0,
    parentId,
    depth,
    group: parentId ? 'attached' : '',
    title: id,
    displayTitle: id,
    kind: 'text',
    notes: '',
    labels: [],
    markers: [],
    childCount: 0,
    boundaries: [],
    summaries: [],
    ...over,
  };
}

function byId(l: Layout, id: string): LayoutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`nodo ${id} assente`);
  return n;
}

function overlap(a: LayoutNode, b: LayoutNode): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Radice con tre figli e due sommari sugli intervalli dati. */
function nestedSummaries(inner: string, outer: string): SheetDto {
  const root = topic('r', undefined, 0, {
    summaries: [
      { id: 'sIn', range: inner },
      { id: 'sOut', range: outer },
    ],
  });
  return {
    index: 0,
    title: 's',
    topics: [
      root,
      topic('c1', 'r', 1),
      topic('c2', 'r', 1),
      topic('c3', 'r', 1),
      topic('sIn', 'r', 1, { group: 'summary', title: 'Sommario interno', displayTitle: 'Sommario interno' }),
      topic('sOut', 'r', 1, { group: 'summary', title: 'Sommario esterno', displayTitle: 'Sommario esterno' }),
    ],
    relationships: [],
  };
}

describe('sommari con intervalli sovrapposti', () => {
  const cases: [string, string, string][] = [
    ['annidati', '(0,1)', '(0,2)'],
    ['uguali', '(0,2)', '(0,2)'],
    ['incrociati', '(0,1)', '(1,2)'],
  ];
  for (const structure of ['logic', 'tree', 'map'] as MapStructure[]) {
    for (const [label, inner, outer] of cases) {
      it(`${structure}, ${label}: i topic di sommario non si sovrappongono`, () => {
        const l = layoutSheets([nestedSummaries(inner, outer)], new Set(), undefined, {
          ...DEFAULT_LAYOUT_OPTS,
          structure,
        });
        for (let i = 0; i < l.nodes.length; i++) {
          for (let j = i + 1; j < l.nodes.length; j++) {
            const a = l.nodes[i];
            const b = l.nodes[j];
            expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
          }
        }
      });
    }
  }

  it('la graffa del sommario più ampio sta oltre il sommario più stretto', () => {
    const l = layoutSheets([nestedSummaries('(0,1)', '(0,2)')], new Set(), undefined, {
      ...DEFAULT_LAYOUT_OPTS,
      structure: 'logic',
    });
    const inner = byId(l, 'sIn');
    const outerBrace = l.summaries.find((s) => l.nodes[s.topic]?.id === 'sOut');
    expect(outerBrace).toBeDefined();
    expect(outerBrace?.x ?? 0).toBeGreaterThan(inner.x + inner.w);
    const outer = byId(l, 'sOut');
    expect(outer.x).toBeGreaterThanOrEqual((outerBrace?.x ?? 0) + SUMMARY_BRACE_W);
    // L'ordine delle graffe resta quello del file.
    expect(l.summaries.map((s) => l.nodes[s.topic]?.id)).toEqual(['sIn', 'sOut']);
  });
});

describe('dimensioni immagine non numeriche', () => {
  it('non producono NaN nel blocco né nel resto della mappa', () => {
    const bad = 'auto' as unknown as number;
    const size = estimateNodeSize({ depth: 1, kind: 'image', imageW: bad, imageH: 120 });
    expect(Number.isFinite(size.w)).toBe(true);
    expect(Number.isFinite(size.h)).toBe(true);

    const sheet: SheetDto = {
      index: 0,
      title: 's',
      topics: [
        topic('r', undefined, 0),
        topic('img', 'r', 1, { kind: 'image', imageW: bad, imageH: 120 }),
        topic('c2', 'r', 1),
      ],
      relationships: [],
    };
    const l = layoutSheets([sheet]);
    for (const n of l.nodes) expect([n.x, n.y, n.w, n.h].every(Number.isFinite), n.id).toBe(true);
    expect(Number.isFinite(l.width) && Number.isFinite(l.height)).toBe(true);
  });
});
