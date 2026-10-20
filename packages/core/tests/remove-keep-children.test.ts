import { describe, expect, it } from 'vitest';
import { AppController, removeTopicKeepChildren, Sheet, Topic } from '../src/index.js';
import { minimalXmind } from './helpers.js';

/** Radice con figli a, X (che ha x1, x2) e b; bordi e sommari su radice e su X. */
function sheets(): Sheet[] {
  return [
    {
      id: 's',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: {
          attached: [
            { id: 'a', title: 'A' },
            {
              id: 'x',
              title: 'X',
              foo: 'blocco',
              children: {
                attached: [
                  { id: 'x1', title: 'X1', foo: 'figlio' },
                  { id: 'x2', title: 'X2' },
                ],
                summary: [{ id: 'sumx', title: 'S' }],
              },
              boundaries: [{ id: 'bx', range: '(0,1)' }],
              summaries: [{ id: 'sx', range: '(1,1)', topicId: 'sumx' }],
            },
            { id: 'b', title: 'B' },
          ],
        },
        boundaries: [
          { id: 'bp', range: '(1,1)' },
          { id: 'pb', range: '(2,2)' },
        ],
      } as Topic,
      relationships: [
        { id: 'r1', end1Id: 'x', end2Id: 'a' },
        { id: 'r2', end1Id: 'x1', end2Id: 'a' },
      ],
    } as Sheet,
  ];
}

const attachedIds = (s: Sheet[]) => s[0].rootTopic!.children!.attached!.map((t) => t.id);

describe('removeTopicKeepChildren', () => {
  it('ricollega i figli nella posizione del blocco, nello stesso ordine', () => {
    const s = sheets();
    expect(removeTopicKeepChildren(s, 'x')).toEqual(['x1', 'x2']);
    expect(attachedIds(s)).toEqual(['a', 'x1', 'x2', 'b']);
  });

  it('su un blocco senza figli equivale a eliminarlo', () => {
    const s = sheets();
    expect(removeTopicKeepChildren(s, 'b')).toEqual([]);
    expect(attachedIds(s)).toEqual(['a', 'x']);
  });

  it('rifiuta la radice e gli id sconosciuti senza modificare la mappa', () => {
    const s = sheets();
    const before = JSON.stringify(s);
    expect(removeTopicKeepChildren(s, 'root')).toBeUndefined();
    expect(removeTopicKeepChildren(s, 'zzz')).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before);
  });

  it('non distrugge i campi sconosciuti di blocco e figli', () => {
    const s = sheets();
    removeTopicKeepChildren(s, 'x');
    expect((s[0].rootTopic!.children!.attached![1] as Topic & { foo: string }).foo).toBe('figlio');
  });

  it('estende i range del genitore che coprivano il blocco e trasla quelli dopo', () => {
    const s = sheets();
    removeTopicKeepChildren(s, 'x');
    expect(s[0].rootTopic!.boundaries).toEqual([
      { id: 'bp', range: '(1,2)' },
      { id: 'pb', range: '(3,3)' },
      { id: 'bx', range: '(1,2)' },
    ]);
  });

  it('sposta sommari e loro topic di sommario con i figli, con i range ricalcolati', () => {
    const s = sheets();
    removeTopicKeepChildren(s, 'x');
    const root = s[0].rootTopic!;
    expect(root.children?.summary?.map((t) => t.id)).toEqual(['sumx']);
    expect(root.summaries).toEqual([{ id: 'sx', range: '(2,2)', topicId: 'sumx' }]);
  });

  it('i figli liberi restano liberi nel genitore', () => {
    const s = sheets();
    s[0].rootTopic!.children!.attached![1].children!.detached = [
      { id: 'd1', title: 'D', position: { x: 10, y: 20 } } as Topic,
    ];
    removeTopicKeepChildren(s, 'x');
    expect(s[0].rootTopic!.children!.detached?.map((t) => t.id)).toEqual(['d1']);
  });

  it('elimina le relazioni del blocco e conserva quelle dei figli', () => {
    const s = sheets();
    removeTopicKeepChildren(s, 'x');
    expect(s[0].relationships?.map((r) => r.id)).toEqual(['r2']);
  });

  it('rifiuta un blocco libero con figli: va eliminato per intero', () => {
    const s = sheets();
    s[0].rootTopic!.children!.detached = [
      { id: 'f', title: 'F', children: { attached: [{ id: 'fc', title: 'FC' }] } } as Topic,
    ];
    expect(() => removeTopicKeepChildren(s, 'f')).toThrow(/Elimina/);
  });
});

describe('controller: rimozione del solo blocco', () => {
  it('ricollega i figli e annulla con un solo undo', async () => {
    const c = new AppController();
    await c.open(
      await minimalXmind([
        {
          id: 's1',
          class: 'sheet',
          title: 'Foglio',
          rootTopic: {
            id: 'r',
            class: 'topic',
            title: 'Radice',
            children: {
              attached: [
                { id: 'a', title: 'A', children: { attached: [{ id: 'a1', title: 'A1' }, { id: 'a2', title: 'A2' }] } },
                { id: 'b', title: 'B' },
              ],
            },
          },
        },
      ]),
    );
    const { childIds } = c.removeTopicKeepChildren('a');
    expect(childIds).toEqual(['a1', 'a2']);
    expect(c.workbook()!.sheets[0].topics.map((t) => t.id)).toEqual(['r', 'a1', 'a2', 'b']);
    c.undo();
    expect(c.workbook()!.sheets[0].topics.map((t) => t.id)).toEqual(['r', 'a', 'a1', 'a2', 'b']);
  });
});

describe('removeTopicKeepChildren: bordo master', () => {
  it('il bordo che racchiudeva il blocco rimosso non passa al genitore', () => {
    const sh: Sheet[] = [
      {
        id: 's',
        rootTopic: {
          id: 'root',
          children: {
            attached: [
              {
                id: 'x',
                boundaries: [{ id: 'bm', range: 'master' }, { id: 'bn', range: '(0,0)' }],
                children: { attached: [{ id: 'x1' }] },
              },
            ],
          },
        } as Topic,
      },
    ];
    expect(removeTopicKeepChildren(sh, 'x')).toEqual(['x1']);
    expect(sh[0].rootTopic!.boundaries).toEqual([{ id: 'bn', range: '(0,0)' }]);
  });
});
