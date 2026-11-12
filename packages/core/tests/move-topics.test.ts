import { describe, expect, it } from 'vitest';
import { MoveError, moveTopics, type Sheet, type Topic } from '../src/index.js';

/** root → a (a1, a2), b, c, t; ogni blocco ha un campo sconosciuto da preservare. */
function sheets(): Sheet[] {
  const leaf = (id: string): Topic => ({ id, title: id.toUpperCase(), extra: { keep: id } } as Topic);
  return [
    {
      id: 's',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: {
          attached: [
            { ...leaf('a'), children: { attached: [leaf('a1'), leaf('a2')] } },
            leaf('b'),
            leaf('c'),
            leaf('t'),
          ],
        },
      } as Topic,
    },
  ];
}

const kids = (t: Topic | undefined) => (t?.children?.attached ?? []).map((c) => c.id);
const root = (s: Sheet[]) => s[0].rootTopic as Topic;
const find = (s: Sheet[], id: string): Topic | undefined => {
  let out: Topic | undefined;
  const walk = (t: Topic) => {
    if (t.id === id) out = t;
    for (const c of t.children?.attached ?? []) walk(c);
  };
  walk(root(s));
  return out;
};

describe('moveTopics', () => {
  it('rende figli del bersaglio tutti i blocchi, nell\'ordine del documento', () => {
    const s = sheets();
    moveTopics(s, ['c', 'a1', 'b'], 't', 'into');
    expect(kids(find(s, 't'))).toEqual(['a1', 'b', 'c']);
    expect(kids(root(s))).toEqual(['a', 't']);
    expect(kids(find(s, 'a'))).toEqual(['a2']);
    expect((find(s, 'b') as Topic & { extra: unknown }).extra).toEqual({ keep: 'b' });
  });

  it('un blocco con un antenato selezionato viaggia con lui', () => {
    const s = sheets();
    moveTopics(s, ['a', 'a1'], 't', 'into');
    expect(kids(find(s, 't'))).toEqual(['a']);
    expect(kids(find(s, 'a'))).toEqual(['a1', 'a2']);
  });

  it('before/after inseriscono la fila accanto al bersaglio', () => {
    const s1 = sheets();
    moveTopics(s1, ['a1', 'a2'], 'b', 'before');
    expect(kids(root(s1))).toEqual(['a', 'a1', 'a2', 'b', 'c', 't']);
    const s2 = sheets();
    moveTopics(s2, ['t', 'a2'], 'b', 'after');
    expect(kids(root(s2))).toEqual(['a', 'b', 'a2', 't', 'c']);
  });

  it('tutto o niente: un bersaglio dentro un blocco spostato lascia la mappa intatta', () => {
    const s = sheets();
    const before = JSON.stringify(s);
    expect(() => moveTopics(s, ['b', 'a'], 'a1', 'into')).toThrow(MoveError);
    expect(JSON.stringify(s)).toBe(before);
  });
});
