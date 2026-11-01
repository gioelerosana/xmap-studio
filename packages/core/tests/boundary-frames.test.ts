import { describe, expect, it } from 'vitest';
import {
  AppController,
  BOUNDARY_PADDING,
  BOUNDARY_TITLE_BAND,
  layoutBoundaries,
  layoutSheets,
  Layout,
  LayoutNode,
  NodeMetrics,
  SheetDto,
  TopicView,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

const NODE_W = 180;
const NODE_H = 36;
const TOTAL_PADDING = BOUNDARY_PADDING + BOUNDARY_PADDING;
const metrics: NodeMetrics = { measure: () => ({ w: NODE_W, h: NODE_H }) };

function topic(id: string, parentId: string | undefined, over: Partial<TopicView> = {}): TopicView {
  return {
    id,
    sheetIndex: 0,
    parentId,
    depth: parentId ? 1 : 0,
    group: parentId ? 'attached' : '',
    title: id,
    displayTitle: id,
    kind: 'text',
    notes: '',
    labels: [],
    markers: [],
    path: [],
    childCount: 0,
    boundaries: [],
    summaries: [],
    ...over,
  };
}

function sheet(topics: TopicView[]): SheetDto {
  return { index: 0, title: 's', topics, relationships: [] };
}

/**
 * Radice `r` con figli `a` (che ha il nipote `a1`), `b` e `c`.
 * Il range `(0,1)` copre `a` e `b`; `c` resta fuori.
 */
function fixture(rootBoundaries: TopicView['boundaries'] = [], aOver: Partial<TopicView> = {}): TopicView[] {
  return [
    topic('r', undefined, { boundaries: rootBoundaries }),
    topic('a', 'r', aOver),
    topic('a1', 'a'),
    topic('b', 'r'),
    topic('c', 'r'),
  ];
}

function layoutOf(topics: TopicView[], collapsed: string[] = []): Layout {
  return layoutSheets([sheet(topics)], new Set(collapsed), metrics);
}

function byId(layout: Layout, id: string): LayoutNode {
  const node = layout.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`nodo ${id} assente`);
  return node;
}

function frameOf(layout: Layout, topics: TopicView[], id: string) {
  const frame = layoutBoundaries(layout, [sheet(topics)]).find((f) => f.id === id);
  if (!frame) throw new Error(`cornice ${id} assente`);
  return frame;
}

function bottom(frame: { y: number; h: number }): number {
  return frame.y + frame.h;
}

function right(frame: { x: number; w: number }): number {
  return frame.x + frame.w;
}

describe('layoutBoundaries: range di figli', () => {
  it('racchiude i sottoalberi dei figli nel range con il margine, e lascia fuori gli altri', () => {
    const topics = fixture([{ id: 'bA', range: '(0,1)' }]);
    const layout = layoutOf(topics);
    const frame = frameOf(layout, topics, 'bA');
    const a = byId(layout, 'a');
    const a1 = byId(layout, 'a1');
    const b = byId(layout, 'b');
    const c = byId(layout, 'c');

    expect(frame.topicId).toBe('r');
    expect(frame.x).toBeCloseTo(a.x - BOUNDARY_PADDING);
    expect(frame.y).toBeCloseTo(a.y - BOUNDARY_PADDING);
    expect(right(frame)).toBeCloseTo(Math.max(a.x + a.w, a1.x + a1.w, b.x + b.w) + BOUNDARY_PADDING);
    expect(bottom(frame)).toBeCloseTo(b.y + b.h + BOUNDARY_PADDING);
    expect(c.y).toBeGreaterThan(bottom(frame));
  });

  it('un range di un solo figlio racchiude solo quel sottoalbero', () => {
    const topics = fixture([{ id: 'bA', range: '(1,1)' }]);
    const layout = layoutOf(topics);
    const frame = frameOf(layout, topics, 'bA');
    const b = byId(layout, 'b');

    expect(frame.y).toBeCloseTo(b.y - BOUNDARY_PADDING);
    expect(bottom(frame)).toBeCloseTo(b.y + b.h + BOUNDARY_PADDING);
  });

  it.each(['0,1', '(2,1)', '(a,b)', '(0,3)'])('ignora il range %s', (range) => {
    const topics = fixture([{ id: 'bX', range }]);
    expect(layoutBoundaries(layoutOf(topics), [sheet(topics)])).toHaveLength(0);
  });

  it('non conta i topic liberi (detached) come figli', () => {
    const topics = [...fixture([{ id: 'bA', range: '(0,2)' }]), topic('d', 'r', { group: 'detached' })];
    const layout = layoutOf(topics);
    const frame = frameOf(layout, topics, 'bA');
    const d = byId(layout, 'd');

    expect(right(frame)).toBeLessThan(d.x);
  });

  it('porta titolo e colori dal file, e lo spazio del titolo in alto', () => {
    const topics = fixture([
      { id: 'bA', range: '(0,0)', title: 'Gruppo', fillColor: '#ffeecc', lineColor: '#aa5500' },
    ]);
    const layout = layoutOf(topics);
    const frame = frameOf(layout, topics, 'bA');
    const a = byId(layout, 'a');

    expect(frame.title).toBe('Gruppo');
    expect(frame.fillColor).toBe('#ffeecc');
    expect(frame.lineColor).toBe('#aa5500');
    expect(frame.y).toBeCloseTo(a.y - BOUNDARY_PADDING - BOUNDARY_TITLE_BAND);
    expect(frame.h).toBeCloseTo(a.h + TOTAL_PADDING + BOUNDARY_TITLE_BAND);
  });
});

describe('layoutBoundaries: master', () => {
  it('racchiude il ramo intero, blocco compreso', () => {
    const topics = fixture([], {}).map((t) =>
      t.id === 'a' ? { ...t, boundaries: [{ id: 'bM', range: 'master' }] } : t
    ) as TopicView[];
    const layout = layoutOf(topics);
    const frame = frameOf(layout, topics, 'bM');
    const a = byId(layout, 'a');
    const a1 = byId(layout, 'a1');
    const b = byId(layout, 'b');

    expect(frame.topicId).toBe('a');
    expect(frame.x).toBeLessThanOrEqual(a.x);
    expect(frame.y).toBeLessThanOrEqual(a.y);
    expect(bottom(frame)).toBeGreaterThanOrEqual(a1.y + a1.h);
    expect(right(frame)).toBeGreaterThanOrEqual(a1.x + a1.w);
    expect(bottom(frame)).toBeLessThan(b.y);
  });
});

describe('layoutBoundaries: rami chiusi', () => {
  it('con il figlio chiuso la cornice racchiude solo il figlio visibile', () => {
    const topics = fixture([{ id: 'bA', range: '(0,0)' }]);
    const layout = layoutOf(topics, ['a']);
    const frame = frameOf(layout, topics, 'bA');
    const a = byId(layout, 'a');

    expect(layout.nodes.find((n) => n.id === 'a1')).toBeUndefined();
    expect(frame.y).toBeCloseTo(a.y - BOUNDARY_PADDING);
    expect(bottom(frame)).toBeCloseTo(a.y + a.h + BOUNDARY_PADDING);
  });

  it('un master su un ramo chiuso racchiude solo il suo blocco', () => {
    const topics = fixture([]).map((t) =>
      t.id === 'a' ? { ...t, boundaries: [{ id: 'bM', range: 'master' }] } : t
    ) as TopicView[];
    const layout = layoutOf(topics, ['a']);
    const frame = frameOf(layout, topics, 'bM');
    const a = byId(layout, 'a');

    expect(frame.h).toBeCloseTo(a.h + TOTAL_PADDING);
  });

  it('un range sul solo figlio chiuso, senza altri nodi visibili, non produce cornice', () => {
    const topics = fixture([{ id: 'bA', range: '(0,0)' }]);
    const layout = layoutOf(topics, ['r']);
    expect(layoutBoundaries(layout, [sheet(topics)])).toHaveLength(0);
  });
});

describe('layoutBoundaries: dal controller', () => {
  it('legge le cornici del file con titolo e colori', async () => {
    const c = new AppController();
    const dto = await c.open(
      await minimalXmind([
        {
          id: 's',
          rootTopic: {
            id: 'r',
            title: 'Radice',
            children: {
              attached: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
            },
            boundaries: [
              {
                id: 'bA',
                class: 'boundary',
                range: '(0,1)',
                title: 'Gruppo',
                style: { id: 'st', properties: { 'svg:fill': '#eeeeee', 'line-color': '#333333' } },
              },
            ],
          },
        },
      ])
    );
    const root = dto.sheets[0].topics.find((t) => t.id === 'r');
    expect(root?.boundaries).toEqual([
      { id: 'bA', range: '(0,1)', title: 'Gruppo', fillColor: '#eeeeee', lineColor: '#333333' },
    ]);
  });
});
