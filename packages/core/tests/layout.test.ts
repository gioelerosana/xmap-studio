import { describe, expect, it } from 'vitest';
import {
  layoutSheets,
  NodeMetrics,
  SheetDto,
  TopicView,
  trunkX,
  TREE_RIGHT_STRUCTURE,
  SUMMARY_BRACE_W,
  Layout,
  LayoutNode,
} from '../src/index.js';

const metrics: NodeMetrics = { measure: () => ({ w: 180, h: 36 }) };
const tallMetrics: NodeMetrics = {
  measure: (n) => ({ w: 180, h: n.id === 'sum' ? 300 : 36 }),
};

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

function run(topics: TopicView[], collapsed: string[] = [], m: NodeMetrics = metrics): Layout {
  return layoutSheets([sheet(topics)], new Set(collapsed), m);
}

function byId(l: Layout, id: string): LayoutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`nodo ${id} assente`);
  return n;
}

const mid = (n: LayoutNode): number => n.y + n.h / 2;

describe('layout Logic Chart', () => {
  const topics = [
    topic('r', undefined),
    topic('a', 'r'),
    topic('b', 'r'),
    topic('c', 'r'),
    topic('a1', 'a', { depth: 2 }),
    topic('a2', 'a', { depth: 2 }),
  ];

  it('contiene tutti i nodi e gli archi e centra la radice sui figli', () => {
    const l = run(topics);
    expect(l.nodes).toHaveLength(6);
    expect(l.edges).toHaveLength(5);
    expect(l.edges.every((e) => e.kind === 'logic')).toBe(true);
    expect(l.nodes[0].childrenBelow).toBe(false);
    const top = byId(l, 'a1').y;
    const last = byId(l, 'c');
    expect(mid(byId(l, 'r'))).toBeCloseTo((top + last.y + last.h) / 2, 5);
  });

  it('centra il genitore sui figli e mantiene l ordine', () => {
    const l = run(topics);
    const a1 = byId(l, 'a1');
    const a2 = byId(l, 'a2');
    expect(a1.y).toBeLessThan(a2.y);
    expect(mid(byId(l, 'a'))).toBeCloseTo((a1.y + a2.y + a2.h) / 2, 5);
    const ys = ['a', 'b', 'c'].map((id) => byId(l, id).y);
    expect([...ys].sort((x, y) => x - y)).toEqual(ys);
    expect(byId(l, 'b').y).toBeGreaterThan(byId(l, 'a2').y);
  });

  it('il collasso nasconde il sotto-albero', () => {
    const l = run(topics, ['a']);
    expect(l.nodes.map((n) => n.id)).not.toContain('a1');
    expect(byId(l, 'a').collapsed).toBe(true);
    expect(byId(l, 'b').collapsed).toBe(false);
  });

  it('il fill esplicito resta locale, l accento di ramo si eredita', () => {
    const t = [
      topic('r', undefined),
      topic('a', 'r'),
      topic('a1', 'a', { depth: 2, fillColor: '#123456' }),
      topic('a2', 'a', { depth: 2 }),
    ];
    const l = run(t);
    expect(byId(l, 'a').fill).toBeUndefined();
    expect(byId(l, 'a').accent).toBeDefined();
    expect(byId(l, 'a1').fill).toBe('#123456');
    expect(byId(l, 'a1').accent).toBe('#123456');
    expect(byId(l, 'a2').fill).toBeUndefined();
    expect(byId(l, 'a2').accent).toBe(byId(l, 'a').accent);
  });
});

describe('layout Tree Chart', () => {
  const topics = [
    topic('r', undefined, { structureClass: TREE_RIGHT_STRUCTURE }),
    topic('a', 'r'),
    topic('b', 'r'),
    topic('a1', 'a', { depth: 2 }),
    topic('a2', 'a', { depth: 2 }),
  ];

  it('mette la radice in alto e i rami sotto, a destra del tronco', () => {
    const l = run(topics);
    const r = byId(l, 'r');
    expect(r.childrenBelow).toBe(true);
    for (const id of ['a', 'b']) {
      const n = byId(l, id);
      expect(n.y).toBeGreaterThanOrEqual(r.y + r.h);
      expect(n.x).toBeGreaterThan(trunkX(r));
    }
    expect(byId(l, 'b').y).toBeGreaterThan(byId(l, 'a').y);
    expect(byId(l, 'a').childrenBelow).toBe(false);
  });

  it('usa archi tree dalla radice e logic più in profondità, con livelli centrati', () => {
    const l = run(topics);
    const kindOf = (id: string) => {
      const idx = l.nodes.findIndex((n) => n.id === id);
      return l.edges.find((e) => e.child === idx)?.kind;
    };
    expect(kindOf('a')).toBe('tree');
    expect(kindOf('b')).toBe('tree');
    expect(kindOf('a1')).toBe('logic');
    const a1 = byId(l, 'a1');
    const a2 = byId(l, 'a2');
    expect(mid(byId(l, 'a'))).toBeCloseTo((a1.y + a2.y + a2.h) / 2, 5);
    expect(a1.x).toBeGreaterThan(byId(l, 'a').x);
  });

  it('radice collassata: nessun figlio, flag childrenBelow mantenuto', () => {
    const l = run(topics, ['r']);
    expect(l.nodes).toHaveLength(1);
    expect(l.nodes[0].collapsed).toBe(true);
    expect(l.nodes[0].childrenBelow).toBe(true);
  });
});

describe('sommari', () => {
  const base = (summaries: { id: string; range: string }[]) => [
    topic('r', undefined, { summaries }),
    topic('a', 'r'),
    topic('b', 'r'),
    topic('c', 'r'),
    topic('sum', 'r', { group: 'summary' }),
  ];

  it('affianca la graffa all intervallo senza arco', () => {
    const l = run(base([{ id: 'sum', range: '(0,1)' }]));
    expect(l.nodes).toHaveLength(5);
    expect(l.edges).toHaveLength(3);
    expect(l.summaries).toHaveLength(1);
    const s = l.summaries[0];
    const a = byId(l, 'a');
    const b = byId(l, 'b');
    const c = byId(l, 'c');
    const sum = byId(l, 'sum');
    expect(s.y1).toBeCloseTo(a.y, 5);
    expect(s.y2).toBeCloseTo(b.y + b.h, 5);
    expect(l.nodes[s.topic].id).toBe('sum');
    expect(mid(sum)).toBeCloseTo((s.y1 + s.y2) / 2, 5);
    expect(sum.x).toBeGreaterThanOrEqual(s.x + SUMMARY_BRACE_W);
    expect(s.x).toBeGreaterThan(a.x + a.w);
    expect(c.y).toBeGreaterThan(s.y2);
    expect(s.accent).toBe(byId(l, 'sum').accent ?? byId(l, 'r').accent);
  });

  it('eredita l accento del genitore se il sommario non ne ha', () => {
    const t = [
      topic('r', undefined, { fillColor: '#abcdef', summaries: [{ id: 'sum', range: '(0,0)' }] }),
      topic('a', 'r', { fillColor: '#111111' }),
      topic('sum', 'r', { group: 'summary', fillColor: '#222222' }),
      topic('b', 'r'),
    ];
    const l = run(t);
    expect(l.summaries[0].accent).toBe('#222222');
    const t2 = [
      topic('r', undefined, { summaries: [{ id: 'sum', range: '(0,0)' }] }),
      topic('a', 'r'),
      topic('sum', 'r', { group: 'summary' }),
    ];
    const l2 = run(t2);
    expect(l2.summaries[0].accent).toBe(byId(l2, 'sum').accent);
  });

  it('un sommario alto allarga la colonna senza sovrapporre i vicini', () => {
    const l = run(base([{ id: 'sum', range: '(1,1)' }]), [], tallMetrics);
    const sum = byId(l, 'sum');
    const a = byId(l, 'a');
    const b = byId(l, 'b');
    const c = byId(l, 'c');
    expect(sum.h).toBe(300);
    expect(sum.y).toBeGreaterThanOrEqual(a.y + a.h);
    expect(sum.y + sum.h).toBeLessThanOrEqual(c.y);
    expect(mid(sum)).toBeCloseTo(mid(b), 5);
  });

  it('senza descrittore abbraccia tutti i figli', () => {
    const l = run(base([]));
    const s = l.summaries[0];
    expect(s.y1).toBeCloseTo(byId(l, 'a').y, 5);
    expect(s.y2).toBeCloseTo(byId(l, 'c').y + 36, 5);
  });

  it('un range oltre i figli viene limitato', () => {
    const l = run(base([{ id: 'sum', range: '(1,9)' }]));
    expect(l.summaries[0].y2).toBeCloseTo(byId(l, 'c').y + 36, 5);
  });

  it('il genitore collassato nasconde anche i sommari', () => {
    const l = run(base([{ id: 'sum', range: '(0,1)' }]), ['r']);
    expect(l.nodes).toHaveLength(1);
    expect(l.summaries).toHaveLength(0);
  });

  it('childCount include i sommari', () => {
    const l = run(base([]));
    expect(byId(l, 'r').childCount).toBe(4);
  });
});
