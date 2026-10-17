import { describe, expect, it } from 'vitest';
import {
  AppController,
  CODE_MOVE,
  DEFAULT_LAYOUT_OPTS,
  Layout,
  LayoutNode,
  NodeMetrics,
  SheetDto,
  TopicView,
  errorCode,
  layoutSheets,
  readArchive,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

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

function run(topics: TopicView[], relationships: SheetDto['relationships'] = []): Layout {
  return layoutSheets(
    [{ index: 0, title: 's', topics, relationships }],
    new Set(),
    metrics,
    DEFAULT_LAYOUT_OPTS
  );
}

function byId(l: Layout, id: string): LayoutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`nodo ${id} assente`);
  return n;
}

const center = (n: LayoutNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

describe('layout dei topic liberi', () => {
  it('rispetta position relativa al centro della radice, senza clamp', () => {
    const l = run([
      topic('r', undefined),
      topic('a', 'r'),
      topic('f', 'r', { group: 'detached', position: { x: -400, y: 250 } }),
    ]);
    const f = byId(l, 'f');
    const r = center(byId(l, 'r'));
    expect(center(f).x - r.x).toBeCloseTo(-400);
    expect(center(f).y - r.y).toBeCloseTo(250);
    expect(f.floating).toBe(true);
    expect(f.floatOrigin).toEqual(r);
    expect(Math.min(...l.nodes.map((n) => n.x))).toBeGreaterThanOrEqual(20);
  });

  it('rispetta position anche con una relazione', () => {
    const l = run(
      [
        topic('r', undefined),
        topic('a', 'r'),
        topic('f', 'r', { group: 'detached', position: { x: 10, y: -300 } }),
      ],
      [{ id: 'rel', end1Id: 'a', end2Id: 'f', title: '' }]
    );
    const r = center(byId(l, 'r'));
    const f = center(byId(l, 'f'));
    expect(f.x - r.x).toBeCloseTo(10);
    expect(f.y - r.y).toBeCloseTo(-300);
    expect(l.relationships).toHaveLength(1);
  });

  it('senza position mantiene la collocazione automatica a destra', () => {
    const l = run([topic('r', undefined), topic('a', 'r'), topic('f', 'r', { group: 'detached' })]);
    const f = byId(l, 'f');
    expect(f.x).toBeGreaterThan(byId(l, 'a').x + byId(l, 'a').w);
    expect(f.floating).toBe(true);
  });
});

async function controller(): Promise<AppController> {
  const c = new AppController();
  await c.open(
    await minimalXmind([
      {
        id: 's1',
        class: 'sheet',
        title: 'Foglio',
        rootTopic: {
          id: 'r',
          title: 'Radice',
          children: {
            attached: [{ id: 'a', title: 'A' }],
            detached: [{ id: 'f', title: 'F', position: { x: 1, y: 2 }, customField: { keep: true } }],
          },
        },
      },
    ])
  );
  return c;
}

describe('setTopicPosition', () => {
  it('scrive solo position (interi), preserva i campi e supporta undo', async () => {
    const c = await controller();
    const dto = c.setTopicPosition('f', { x: 10.6, y: -3.2 });
    expect(dto.sheets[0].topics.find((t) => t.id === 'f')?.position).toEqual({ x: 11, y: -3 });

    const { bytes } = await c.prepareArchiveBytes();
    const arch = await readArchive(bytes);
    const raw = arch.entries.get('content.json');
    const content = JSON.parse(new TextDecoder().decode(raw));
    const saved = content[0].rootTopic.children.detached[0];
    expect(saved.position).toEqual({ x: 11, y: -3 });
    expect(saved.customField).toEqual({ keep: true });
    expect(saved.title).toBe('F');

    const undone = c.undo();
    expect(undone.sheets[0].topics.find((t) => t.id === 'f')?.position).toEqual({ x: 1, y: 2 });
  });

  it('rifiuta i topic non liberi e le posizioni non valide', async () => {
    const c = await controller();
    let code: string | undefined;
    try {
      c.setTopicPosition('a', { x: 0, y: 0 });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe(CODE_MOVE);
    expect(() => c.setTopicPosition('f', { x: NaN, y: 0 })).toThrow();
  });
});
