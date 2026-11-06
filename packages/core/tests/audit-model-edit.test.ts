import { describe, expect, it } from 'vitest';
import {
  AppController,
  moveTopic,
  removeTopic,
  removeTopicKeepChildren,
  Sheet,
  Topic,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

/**
 * Radice con tre figli; un sommario copre solo `c1` e il suo topic (`sum`, con un figlio `sumKid`)
 * è collegato da relazioni a `c0`.
 */
function sheetsWithSummaryRelationships(): Sheet[] {
  return [
    {
      id: 's',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: {
          attached: [
            { id: 'c0', title: 'c0' },
            { id: 'c1', title: 'c1', children: { detached: [{ id: 'free', title: 'F' }] } },
            { id: 'c2', title: 'c2' },
          ],
          summary: [{ id: 'sum', title: 'S', children: { attached: [{ id: 'sumKid', title: 'K' }] } }],
        },
        summaries: [{ id: 'd', range: '(1,1)', topicId: 'sum' }],
      } as Topic,
      relationships: [
        { id: 'r-sum', end1Id: 'c0', end2Id: 'sum' },
        { id: 'r-kid', end1Id: 'sumKid', end2Id: 'c2' },
        { id: 'r-keep', end1Id: 'c0', end2Id: 'c2' },
      ],
    },
  ];
}

function relationshipIds(sheets: Sheet[]): string[] {
  return (sheets[0].relationships ?? []).map((r) => r.id ?? '');
}

describe('relazioni verso i topic di sommario eliminati insieme al loro range', () => {
  it('removeTopic: niente relazioni orfane verso il sommario (e i suoi figli) sparito', () => {
    const sheets = sheetsWithSummaryRelationships();
    removeTopic(sheets, 'c1');
    expect(sheets[0].rootTopic?.children?.summary).toBeUndefined();
    expect(relationshipIds(sheets)).toEqual(['r-keep']);
  });

  it('moveTopic: spostando l\'unico blocco coperto, il sommario sparisce con le sue relazioni', () => {
    const sheets = sheetsWithSummaryRelationships();
    moveTopic(sheets, 'c1', 'c2', 'into');
    expect(sheets[0].rootTopic?.children?.summary).toBeUndefined();
    expect(relationshipIds(sheets)).toEqual(['r-keep']);
  });

  it('removeTopicKeepChildren: idem quando il blocco ha solo figli liberi', () => {
    const sheets = sheetsWithSummaryRelationships();
    removeTopicKeepChildren(sheets, 'c1');
    expect(sheets[0].rootTopic?.children?.summary).toBeUndefined();
    expect(relationshipIds(sheets)).toEqual(['r-keep']);
  });
});

describe('fusione di creazione e rinomina con la cronologia piena', () => {
  it('non fonde la rinomina in un passo successivo alla creazione', async () => {
    const controller = new AppController();
    await controller.open(await minimalXmind());
    // Riempie la cronologia fino al tetto (200 snapshot): da qui `pos` resta fermo.
    for (let i = 0; i < 210; i++) controller.setTopicTitle('a', `A${i}`);

    const { newId } = controller.addTopic('r', '');
    controller.setTopicColor('a', '#FF0000');
    controller.setTopicTitle(newId, 'Nuovo', { mergeWithPrevious: true });

    // Il primo undo annulla solo la rinomina: colore e blocco nuovo restano.
    controller.undo();
    const topics = controller.workbook()?.sheets[0].topics ?? [];
    expect(topics.find((t) => t.id === 'a')?.fillColor).toBe('#FF0000');
    expect(topics.find((t) => t.id === newId)?.title).toBe('');
  });
});
