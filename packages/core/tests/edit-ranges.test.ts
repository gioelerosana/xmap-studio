import { describe, expect, it } from 'vitest';
import { removeTopic, Sheet, Topic } from '../src/index.js';

function sheetWith(parent: Partial<Topic>): Sheet[] {
  const children = ['c0', 'c1', 'c2'].map((id) => ({ id, title: id }));
  return [
    {
      id: 's',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: { attached: children, summary: [{ id: 'sum', title: 'S' }] },
        ...parent,
      } as Topic,
    },
  ];
}

describe('range di boundary e summary alla rimozione di un figlio', () => {
  it('elimina il boundary che copriva solo il figlio rimosso', () => {
    const sheets = sheetWith({ boundaries: [{ id: 'b', range: '(2,2)' }] });
    removeTopic(sheets, 'c2');
    expect(sheets[0].rootTopic!.boundaries).toBeUndefined();
  });

  it('elimina summary e topic di sommario che coprivano solo il figlio rimosso', () => {
    const sheets = sheetWith({ summaries: [{ id: 'x', range: '(1,1)', topicId: 'sum' }] });
    removeTopic(sheets, 'c1');
    const root = sheets[0].rootTopic!;
    expect(root.summaries).toBeUndefined();
    expect(root.children?.summary).toBeUndefined();
  });

  it('accorcia o trasla i range che restano validi', () => {
    const sheets = sheetWith({
      boundaries: [
        { id: 'span', range: '(0,2)' },
        { id: 'after', range: '(2,2)' },
        { id: 'before', range: '(0,0)' },
      ],
    });
    removeTopic(sheets, 'c1');
    expect(sheets[0].rootTopic!.boundaries).toEqual([
      { id: 'span', range: '(0,1)' },
      { id: 'after', range: '(1,1)' },
      { id: 'before', range: '(0,0)' },
    ]);
  });

  it('non inventa un range quando manca e lascia invariato master', () => {
    const sheets = sheetWith({
      boundaries: [{ id: 'none' }, { id: 'm', range: 'master' }],
    });
    removeTopic(sheets, 'c0');
    expect(sheets[0].rootTopic!.boundaries).toEqual([{ id: 'none' }, { id: 'm', range: 'master' }]);
  });
});
