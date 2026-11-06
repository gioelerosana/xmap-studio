import { describe, expect, it } from 'vitest';
import { MoveError, moveTopic, type Sheet, type Topic } from '../src/index.js';

/** Radice con figli a, b; `a` ha un figlio a1 e due sommari; la radice ha due blocchi liberi. */
function sheets(): Sheet[] {
  return [
    {
      id: 's',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: {
          attached: [
            {
              id: 'a',
              title: 'A',
              children: {
                attached: [{ id: 'a1', title: 'A1' }],
                summary: [
                  { id: 'sumA', title: 'S' },
                  { id: 'sumB', title: 'T' },
                ],
              },
              summaries: [
                { id: 'sa', range: '(0,0)', topicId: 'sumA' },
                { id: 'sb', range: '(0,0)', topicId: 'sumB' },
              ],
            },
            { id: 'b', title: 'B' },
          ],
          detached: [
            { id: 'f1', title: 'F1', position: { x: 10, y: 20 } },
            { id: 'f2', title: 'F2', position: { x: 30, y: 40 } },
          ],
        },
      } as Topic,
    },
  ];
}

function reasonOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof MoveError) return err.reason;
    throw err;
  }
  return undefined;
}

describe('moveTopic prima/dopo un blocco libero o un sommario', () => {
  it('rifiuta di mettere un blocco attached accanto a un blocco libero e non tocca la mappa', () => {
    const s = sheets();
    const before = JSON.stringify(s);
    expect(reasonOf(() => moveTopic(s, 'a1', 'f1', 'after'))).toBe('invalid_target');
    expect(reasonOf(() => moveTopic(s, 'b', 'f2', 'before'))).toBe('invalid_target');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('rifiuta di mettere un blocco accanto a un sommario di un altro genitore', () => {
    const s = sheets();
    const before = JSON.stringify(s);
    expect(reasonOf(() => moveTopic(s, 'b', 'sumA', 'after'))).toBe('invalid_target');
    expect(reasonOf(() => moveTopic(s, 'f1', 'sumB', 'before'))).toBe('invalid_target');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('riordina ancora i blocchi liberi fra loro, conservando la posizione', () => {
    const s = sheets();
    moveTopic(s, 'f1', 'f2', 'after');
    const detached = s[0].rootTopic?.children?.detached ?? [];
    expect(detached.map((t) => t.id)).toEqual(['f2', 'f1']);
    expect(detached[1].position).toEqual({ x: 10, y: 20 });
  });

  it('riordina ancora i sommari dello stesso genitore, con le voci in summaries intatte', () => {
    const s = sheets();
    moveTopic(s, 'sumB', 'sumA', 'before');
    const a = s[0].rootTopic?.children?.attached?.[0];
    expect(a?.children?.summary?.map((t) => t.id)).toEqual(['sumB', 'sumA']);
    expect(a?.summaries?.map((x) => x.topicId)).toEqual(['sumA', 'sumB']);
  });

  it('un blocco libero si può ancora mettere accanto a un blocco attached', () => {
    const s = sheets();
    moveTopic(s, 'f1', 'b', 'after');
    expect(s[0].rootTopic?.children?.attached?.map((t) => t.id)).toEqual(['a', 'b', 'f1']);
  });
});
