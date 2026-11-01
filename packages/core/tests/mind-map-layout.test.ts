import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_OPTS,
  Layout,
  LayoutNode,
  LayoutOpts,
  NodeMetrics,
  SUMMARY_BRACE_W,
  SheetDto,
  TREE_RIGHT_STRUCTURE,
  TopicView,
  layoutSheets,
} from '../src/index.js';

const UNBALANCED = 'org.xmind.ui.map.unbalanced';
const CLOCKWISE = 'org.xmind.ui.map.clockwise';
const ANTICLOCKWISE = 'org.xmind.ui.map.anticlockwise';
const LOGIC = 'org.xmind.ui.logic.right';

const metrics: NodeMetrics = { measure: () => ({ w: 180, h: 36 }) };

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

/** Radice `r` con `count` figli `c1..cN`, più eventuali topic extra. */
function rootWithChildren(count: number, structureClass?: string, extra: TopicView[] = []): SheetDto {
  const kids = Array.from({ length: count }, (_, i) => topic(`c${i + 1}`, 'r'));
  return sheet([topic('r', undefined, { structureClass }), ...kids, ...extra]);
}

function layoutOf(dto: SheetDto, opts: Partial<LayoutOpts> = {}, collapsed: string[] = []): Layout {
  return layoutSheets([dto], new Set(collapsed), metrics, { ...DEFAULT_LAYOUT_OPTS, ...opts });
}

function byId(l: Layout, id: string): LayoutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`nodo ${id} assente`);
  return n;
}

const centerY = (n: LayoutNode): number => n.y + n.h / 2;
const rightEdge = (n: LayoutNode): number => n.x + n.w;

describe('mappa mentale: lato dei rami di primo livello', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    it(`n=${n}: i primi ceil(n/2) a destra, gli altri a sinistra`, () => {
      const l = layoutOf(rootWithChildren(n, UNBALANCED));
      const root = byId(l, 'r');
      const half = Math.ceil(n / 2);
      for (let i = 1; i <= n; i++) {
        const c = byId(l, `c${i}`);
        if (i <= half) {
          expect(c.side).toBe('right');
          expect(c.x).toBeGreaterThanOrEqual(rightEdge(root));
        } else {
          expect(c.side).toBe('left');
          expect(rightEdge(c)).toBeLessThanOrEqual(root.x);
        }
      }
    });
  }

  it('la radice non ha lato', () => {
    const l = layoutOf(rootWithChildren(3, UNBALANCED));
    expect(byId(l, 'r').side).toBeUndefined();
  });

  it('unbalanced: entrambe le colonne dall’alto in basso nell’ordine dei figli', () => {
    const l = layoutOf(rootWithChildren(5, UNBALANCED));
    const right = ['c1', 'c2', 'c3'].map((id) => byId(l, id));
    const left = ['c4', 'c5'].map((id) => byId(l, id));
    expect(right.map(centerY)).toEqual([...right.map(centerY)].sort((a, b) => a - b));
    expect(left.map(centerY)).toEqual([...left.map(centerY)].sort((a, b) => a - b));
  });

  it('clockwise: la colonna sinistra va dal basso verso l’alto (giro orario)', () => {
    const l = layoutOf(rootWithChildren(5, CLOCKWISE));
    const right = ['c1', 'c2', 'c3'].map((id) => byId(l, id));
    expect(right.map(centerY)).toEqual([...right.map(centerY)].sort((a, b) => a - b));
    expect(byId(l, 'c4').side).toBe('left');
    expect(byId(l, 'c5').side).toBe('left');
    expect(centerY(byId(l, 'c4'))).toBeGreaterThan(centerY(byId(l, 'c5')));
  });

  it('anticlockwise: prima metà a sinistra, il resto a destra dal basso verso l’alto', () => {
    const l = layoutOf(rootWithChildren(5, ANTICLOCKWISE));
    expect(['c1', 'c2', 'c3'].map((id) => byId(l, id).side)).toEqual(['left', 'left', 'left']);
    expect(byId(l, 'c4').side).toBe('right');
    expect(byId(l, 'c5').side).toBe('right');
    expect(centerY(byId(l, 'c4'))).toBeGreaterThan(centerY(byId(l, 'c5')));
    const left = ['c1', 'c2', 'c3'].map((id) => byId(l, id));
    expect(left.map(centerY)).toEqual([...left.map(centerY)].sort((a, b) => a - b));
  });

  it('clockwise con un solo ramo: il ramo sta a destra', () => {
    const l = layoutOf(rootWithChildren(1, CLOCKWISE));
    expect(byId(l, 'c1').side).toBe('right');
  });
});

describe('mappa mentale: specularità dei sottoalberi', () => {
  it('ogni figlio sta dal lato del genitore: a sinistra del bordo sinistro, a destra del destro', () => {
    const dto = sheet([
      topic('r', undefined, { structureClass: UNBALANCED }),
      topic('c1', 'r'),
      topic('c2', 'r'),
      topic('c3', 'r'),
      topic('g1', 'c1', { depth: 2 }),
      topic('g2', 'c2', { depth: 2 }),
      topic('g2b', 'c2', { depth: 2 }),
      topic('g3', 'c3', { depth: 2 }),
    ]);
    const l = layoutOf(dto);
    for (const e of l.edges) {
      const parent = l.nodes[e.parent];
      const child = l.nodes[e.child];
      expect(child.side).toBeDefined();
      if (child.side === 'left') {
        expect(rightEdge(child)).toBeLessThanOrEqual(parent.x);
      } else {
        expect(child.x).toBeGreaterThanOrEqual(rightEdge(parent));
      }
    }
  });

  it('i discendenti di un ramo sinistro ereditano il lato sinistro', () => {
    const dto = sheet([
      topic('r', undefined, { structureClass: UNBALANCED }),
      topic('c1', 'r'),
      topic('c2', 'r'),
      topic('g2', 'c2', { depth: 2 }),
    ]);
    const l = layoutOf(dto);
    expect(byId(l, 'c2').side).toBe('left');
    expect(byId(l, 'g2').side).toBe('left');
    expect(rightEdge(byId(l, 'g2'))).toBeLessThanOrEqual(byId(l, 'c2').x);
  });

  it('il lato sinistro usa i connettori dal bordo sinistro del genitore', () => {
    const l = layoutOf(rootWithChildren(2, UNBALANCED));
    const edge = l.edges.find((e) => l.nodes[e.child].id === 'c2');
    expect(edge).toBeDefined();
    expect(l.nodes[edge?.child ?? -1].side).toBe('left');
  });
});

describe('mappa mentale: colonne e coordinate', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`n=${n}: le colonne sono centrate verticalmente sulla radice`, () => {
      const l = layoutOf(rootWithChildren(n, UNBALANCED));
      const root = byId(l, 'r');
      const half = Math.ceil(n / 2);
      for (const side of ['right', 'left'] as const) {
        const ids = Array.from({ length: n }, (_, i) => `c${i + 1}`).filter((_, i) =>
          side === 'right' ? i < half : i >= half
        );
        const nodes = ids.map((id) => byId(l, id));
        const top = Math.min(...nodes.map((c) => c.y));
        const bottom = Math.max(...nodes.map((c) => c.y + c.h));
        expect((top + bottom) / 2).toBeCloseTo(centerY(root), 0);
      }
    });
  }

  it('tutte le coordinate restano ≥ 0 anche con rami a sinistra e molti livelli', () => {
    const dto = sheet([
      topic('r', undefined, { structureClass: UNBALANCED }),
      topic('c1', 'r'),
      topic('c2', 'r'),
      topic('c3', 'r'),
      topic('g3', 'c3', { depth: 2 }),
      topic('h3', 'g3', { depth: 3 }),
    ]);
    const l = layoutOf(dto);
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(rightEdge(n)).toBeLessThanOrEqual(l.width);
    }
  });

  it('un solo ramo a sinistra (anticlockwise, n=1) resta nei limiti', () => {
    const l = layoutOf(rootWithChildren(1, ANTICLOCKWISE));
    expect(byId(l, 'c1').side).toBe('left');
    for (const n of l.nodes) expect(n.x).toBeGreaterThanOrEqual(0);
  });
});

describe('mappa mentale: sommari', () => {
  it('un sommario sul lato sinistro sta a sinistra dei figli raccolti', () => {
    const dto = rootWithChildren(4, UNBALANCED, [topic('sum', 'r', { group: 'summary' })]);
    dto.topics[0] = { ...dto.topics[0], summaries: [{ id: 'sum', range: '(2,3)' }] };
    const l = layoutOf(dto);
    expect(l.summaries).toHaveLength(1);
    const [s] = l.summaries;
    const topicNode = l.nodes[s.topic];
    expect(topicNode.side).toBe('left');
    expect(rightEdge(topicNode)).toBeLessThanOrEqual(s.x);
    expect(s.x + SUMMARY_BRACE_W).toBeLessThanOrEqual(Math.min(byId(l, 'c3').x, byId(l, 'c4').x));
  });
});

describe('struttura forzata e strutture invariate', () => {
  it('forzare map su un file senza struttura dispone a mappa mentale', () => {
    const l = layoutOf(rootWithChildren(2), { structure: 'map' });
    expect(byId(l, 'c1').side).toBe('right');
    expect(byId(l, 'c2').side).toBe('left');
  });

  it('forzare logic su un file mappa mentale lascia tutto a destra', () => {
    const l = layoutOf(rootWithChildren(4, UNBALANCED), { structure: 'logic' });
    const root = byId(l, 'r');
    for (let i = 1; i <= 4; i++) {
      const c = byId(l, `c${i}`);
      expect(c.side).toBeUndefined();
      expect(c.x).toBeGreaterThanOrEqual(rightEdge(root));
    }
  });

  it('forzare tree su un file mappa mentale resta Tree Chart', () => {
    const l = layoutOf(rootWithChildren(3, UNBALANCED), { structure: 'tree' });
    expect(byId(l, 'r').childrenBelow).toBe(true);
    expect(l.nodes.every((n) => n.side === undefined)).toBe(true);
  });

  it('logic (file senza struttura) resta Logic Chart senza lati', () => {
    const l = layoutOf(rootWithChildren(3, LOGIC));
    expect(l.nodes.every((n) => n.side === undefined)).toBe(true);
    expect(byId(l, 'c3').x).toBeGreaterThanOrEqual(rightEdge(byId(l, 'r')));
  });

  it('tree (file) resta Tree Chart senza lati', () => {
    const l = layoutOf(rootWithChildren(3, TREE_RIGHT_STRUCTURE));
    expect(byId(l, 'r').childrenBelow).toBe(true);
    expect(l.nodes.every((n) => n.side === undefined)).toBe(true);
  });

  it('radice collassata: nessun figlio e nessun lato', () => {
    const l = layoutOf(rootWithChildren(4, UNBALANCED), { structure: 'map' }, ['r']);
    expect(l.nodes).toHaveLength(1);
    expect(byId(l, 'r').side).toBeUndefined();
  });
});
