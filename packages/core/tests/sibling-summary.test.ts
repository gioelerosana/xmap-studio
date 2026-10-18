import { describe, expect, it } from 'vitest';
import { AppController, Sheet, Topic, siblingRange } from '../src/index.js';
import { minimalXmind } from './helpers.js';

function makeSheets(): Sheet[] {
  const kids = ['c0', 'c1', 'c2'].map((id) => ({ id, title: `Child ${id}` }));
  const subKids = ['sub0', 'sub1'].map((id) => ({ id, title: `Sub ${id}` }));
  return [
    {
      id: 'sheet-1',
      rootTopic: {
        id: 'root-1',
        title: 'Radice',
        children: {
          attached: [
            { id: kids[0].id, title: kids[0].title, children: { attached: subKids } },
            kids[1],
            kids[2],
          ],
          detached: [{ id: 'detached-1', title: 'Libero' }],
          summary: [{ id: 'sum-existing', title: 'Sommario Esistente' }],
        },
        summaries: [{ id: 'sum-desc-1', range: '(0,1)', topicId: 'sum-existing' }],
      } as Topic,
    },
    {
      id: 'sheet-2',
      rootTopic: {
        id: 'root-2',
        title: 'Foglio 2',
        children: {
          attached: [{ id: 'other-sheet-c0', title: 'Altro' }],
        },
      } as Topic,
    },
  ];
}

describe('siblingRange', () => {
  it('calcola il range corretto per un singolo blocco figlio', () => {
    const s = makeSheets();
    const res = siblingRange(s, ['c1']);
    expect(res).toEqual({ parentId: 'root-1', start: 1, end: 1 });
  });

  it('calcola il range da min a max per fratelli contigui e non contigui', () => {
    const s = makeSheets();
    // Contigui
    expect(siblingRange(s, ['c0', 'c1'])).toEqual({ parentId: 'root-1', start: 0, end: 1 });
    // Non contigui (da min a max indice)
    expect(siblingRange(s, ['c0', 'c2'])).toEqual({ parentId: 'root-1', start: 0, end: 2 });
    // Ordine invertito
    expect(siblingRange(s, ['c2', 'c0'])).toEqual({ parentId: 'root-1', start: 0, end: 2 });
    // Con duplicati
    expect(siblingRange(s, ['c1', 'c1', 'c2'])).toEqual({ parentId: 'root-1', start: 1, end: 2 });
  });

  it('funziona su sotto-rami (non solo sui rami principali della radice)', () => {
    const s = makeSheets();
    const res = siblingRange(s, ['sub0', 'sub1']);
    expect(res).toEqual({ parentId: 'c0', start: 0, end: 1 });
  });

  it('restituisce null per elenco vuoto o id inesistenti', () => {
    const s = makeSheets();
    expect(siblingRange(s, [])).toBeNull();
    expect(siblingRange(s, ['non-existent'])).toBeNull();
    expect(siblingRange(s, ['c0', 'non-existent'])).toBeNull();
  });

  it('restituisce null se contiene la radice', () => {
    const s = makeSheets();
    expect(siblingRange(s, ['root-1'])).toBeNull();
    expect(siblingRange(s, ['root-1', 'c0'])).toBeNull();
  });

  it('restituisce null per blocchi liberi (detached) o topic di sommario', () => {
    const s = makeSheets();
    expect(siblingRange(s, ['detached-1'])).toBeNull();
    expect(siblingRange(s, ['c0', 'detached-1'])).toBeNull();
    expect(siblingRange(s, ['sum-existing'])).toBeNull();
  });

  it('con genitori diversi risale al primo antenato comune', () => {
    const s = makeSheets();
    // sub0 è figlio di c0: il sommario copre il ramo c0 della radice
    expect(siblingRange(s, ['c0', 'sub0'])).toEqual({ parentId: 'root-1', start: 0, end: 0 });
    // cugini: sub1 (sotto c0) e c2 → rami 0..2 della radice
    expect(siblingRange(s, ['sub1', 'c2'])).toEqual({ parentId: 'root-1', start: 0, end: 2 });
  });

  it('restituisce null se i blocchi appartengono a fogli diversi', () => {
    const s = makeSheets();
    expect(siblingRange(s, ['c0', 'other-sheet-c0'])).toBeNull();
  });
});

describe('controller: creazione sommario tra fratelli e cronologia', () => {
  it('addTopicSummary restituisce summaryTopicId e registra lastCreated', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const res = c.addTopicSummary('r', 0, 0, 'Mio Sommario');
    expect(res.summaryTopicId).toBeDefined();
    expect(typeof res.summaryTopicId).toBe('string');

    const sheet = c.workbook()!.sheets[0];
    const createdTopic = sheet.topics.find((t) => t.id === res.summaryTopicId);
    expect(createdTopic).toBeDefined();
    expect(createdTopic?.title).toBe('Mio Sommario');
  });

  it('addSummaryForSiblings crea il sommario tra blocchi fratelli e supporta undo/redo', async () => {
    const c = new AppController();
    const inputSheets = [
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
              { id: 'b0', title: 'Blocco 0' },
              { id: 'b1', title: 'Blocco 1' },
              { id: 'b2', title: 'Blocco 2' },
            ],
          },
        },
      },
    ];
    await c.open(await minimalXmind(inputSheets));

    // Sommario tra b0 e b2 (intervallo contiguo 0..2)
    const { summaryTopicId } = c.addSummaryForSiblings(['b0', 'b2'], 'Sintesi');
    expect(summaryTopicId).toBeDefined();

    let sheet = c.workbook()!.sheets[0];
    const sumTopic = sheet.topics.find((t) => t.id === summaryTopicId);
    expect(sumTopic).toBeDefined();
    expect(sumTopic?.title).toBe('Sintesi');

    // Verifica range nel modello
    const root = c.workbook()!.sheets[0].topics.find((t) => t.id === 'r')!;
    expect(root.summaries).toHaveLength(1);
    expect(root.summaries[0].range).toBe('(0,2)');
    expect(root.summaries[0].id).toBe(summaryTopicId);

    // Undo: il sommario scompare
    c.undo();
    sheet = c.workbook()!.sheets[0];
    expect(sheet.topics.find((t) => t.id === summaryTopicId)).toBeUndefined();
    const rootAfterUndo = sheet.topics.find((t) => t.id === 'r')!;
    expect(rootAfterUndo.summaries).toHaveLength(0);

    // Redo: il sommario riappare
    c.redo();
    sheet = c.workbook()!.sheets[0];
    expect(sheet.topics.find((t) => t.id === summaryTopicId)).toBeDefined();
  });

  it('addSummaryForSiblings lancia un errore se i blocchi non sono fratelli', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    expect(() => c.addSummaryForSiblings(['r', 'a'])).toThrow(/sommario/);
  });
});
