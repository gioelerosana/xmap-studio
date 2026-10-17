import { describe, expect, it } from 'vitest';
import { AppController, insertSibling, Sheet, Topic } from '../src/index.js';
import { minimalXmind } from './helpers.js';

function sheets(): Sheet[] {
  const kids = ['c0', 'c1', 'c2'].map((id) => ({ id, title: id, foo: 'x' }));
  return [
    {
      id: 's',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: { attached: kids, detached: [{ id: 'd', title: 'D' }] },
        boundaries: [{ id: 'b', range: '(1,2)' }],
      } as Topic,
    },
  ];
}

const ids = (s: Sheet[]) => s[0].rootTopic!.children!.attached!.map((t) => t.id);

describe('insertSibling', () => {
  it('inserisce dopo e prima nello stesso gruppo', () => {
    const s = sheets();
    const a = insertSibling(s, 'c1', 'N1', 'after');
    const b = insertSibling(s, 'c0', 'N2', 'before');
    expect(ids(s)).toEqual([b, 'c0', 'c1', a, 'c2']);
  });

  it('non distrugge i campi sconosciuti e trasla i range', () => {
    const s = sheets();
    insertSibling(s, 'c0', 'N', 'after');
    expect((s[0].rootTopic!.children!.attached![0] as Topic & { foo: string }).foo).toBe('x');
    expect(s[0].rootTopic!.boundaries![0].range).toBe('(2,3)');
  });

  it('errori su radice, detached e id sconosciuto', () => {
    const s = sheets();
    expect(() => insertSibling(s, 'root', 'N')).toThrow();
    expect(() => insertSibling(s, 'd', 'N')).toThrow();
    expect(() => insertSibling(s, 'zzz', 'N')).toThrow();
  });
});

describe('controller: fratelli e cronologia', () => {
  it('addSiblingTopic è un solo passo di undo; sulla radice ripiega su figlio', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const { newId } = c.addSiblingTopic('a', 'B');
    expect(c.workbook()!.sheets[0].topics.find((t) => t.id === newId)?.parentId).toBe('r');
    const child = c.addSiblingTopic('r', 'C');
    expect(c.workbook()!.sheets[0].topics.find((t) => t.id === child.newId)?.parentId).toBe('r');
    c.undo();
    c.undo();
    expect(c.workbook()!.sheets[0].topics.map((t) => t.id)).toEqual(['r', 'a']);
  });

  it('setTopicTitle senza cambiamenti non registra storia', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    c.setTopicTitle('a', 'A');
    expect(c.isDirty()).toBe(false);
  });

  it('mergeWithPrevious fonde creazione e rinomina in un solo undo', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const { newId } = c.addTopic('a', 'Nuovo blocco');
    c.setTopicTitle(newId, 'Ciao', { mergeWithPrevious: true });
    c.undo();
    expect(c.workbook()!.sheets[0].topics.map((t) => t.id)).toEqual(['r', 'a']);
  });

  it('dopo un altro passo la rinomina non si fonde', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const { newId } = c.addTopic('a', 'Nuovo blocco');
    c.setTopicTitle('a', 'A2');
    c.setTopicTitle(newId, 'Ciao', { mergeWithPrevious: true });
    c.undo();
    const t = c.workbook()!.sheets[0].topics.find((x) => x.id === newId);
    expect(t?.title).toBe('Nuovo blocco');
  });
});
