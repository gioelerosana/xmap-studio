import { describe, expect, it } from 'vitest';
import {
  applyEquation,
  MATHJAX_PROVIDER,
  moveTopic,
  setFillColor,
  setNotes,
  setTitleRuns,
  Sheet,
  Topic,
} from '../src/index.js';

describe('moveTopic conserva le relazioni', () => {
  it('nello stesso foglio le relazioni del blocco spostato restano', () => {
    const sheets: Sheet[] = [
      {
        id: 's1',
        rootTopic: {
          id: 'root',
          title: 'R',
          children: {
            attached: [
              { id: 'a', title: 'A', children: { attached: [{ id: 'a1', title: 'A1' }] } },
              { id: 'b', title: 'B' },
              { id: 'c', title: 'C' },
            ],
          },
        },
        relationships: [{ id: 'r1', end1Id: 'a1', end2Id: 'c' }],
      },
    ];
    moveTopic(sheets, 'a', 'b', 'into');
    expect(sheets[0].relationships).toEqual([{ id: 'r1', end1Id: 'a1', end2Id: 'c' }]);
  });

  it('tra fogli diversi elimina solo le relazioni che toccano il sottoalbero spostato', () => {
    const sheets: Sheet[] = [
      {
        id: 's1',
        rootTopic: {
          id: 'root1',
          title: 'R1',
          children: {
            attached: [
              { id: 'a', title: 'A', children: { attached: [{ id: 'a1', title: 'A1' }] } },
              { id: 'c', title: 'C' },
            ],
          },
        },
        relationships: [
          { id: 'r1', end1Id: 'a', end2Id: 'c' },
          { id: 'r2', end1Id: 'a1', end2Id: 'c' },
          { id: 'keep', end1Id: 'c', end2Id: 'altro' },
        ],
      },
      {
        id: 's2',
        rootTopic: { id: 'root2', title: 'R2', children: { attached: [{ id: 'x', title: 'X' }] } },
      },
    ];
    moveTopic(sheets, 'a', 'x', 'into');
    expect(sheets[0].relationships).toEqual([{ id: 'keep', end1Id: 'c', end2Id: 'altro' }]);
    expect(sheets[1].relationships).toBeUndefined();
  });

  it('spostare un sommario rimuove il suo riferimento dal genitore', () => {
    const sheets: Sheet[] = [
      {
        id: 's1',
        rootTopic: {
          id: 'root',
          title: 'R',
          children: {
            attached: [{ id: 'c0', title: 'C0' }, { id: 'x', title: 'X' }],
            summary: [{ id: 'sum', title: 'Sommario' }],
          },
          summaries: [{ id: 'sd', range: '(0,0)', topicId: 'sum' }],
        },
      },
    ];
    moveTopic(sheets, 'sum', 'x', 'into');
    const root = sheets[0].rootTopic;
    expect(root?.summaries).toBeUndefined();
    expect(root?.children?.summary).toBeUndefined();
    expect(root?.children?.attached?.[1].children?.attached?.map((t) => t.id)).toEqual(['sum']);
  });
});

describe('moveTopic aggiorna i range di bordi e sommari del genitore di destinazione', () => {
  it('riordinando prima di un fratello il bordo continua a coprire gli stessi figli', () => {
    const sheets: Sheet[] = [
      {
        id: 's1',
        rootTopic: {
          id: 'root',
          title: 'R',
          children: {
            attached: [
              { id: 'a', title: 'A' },
              { id: 'b', title: 'B' },
              { id: 'c', title: 'C' },
            ],
          },
          boundaries: [{ id: 'bd', range: '(1,2)' }],
        },
      },
    ];
    moveTopic(sheets, 'a', 'b', 'before');
    const root = sheets[0].rootTopic;
    expect(root?.children?.attached?.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(root?.boundaries).toEqual([{ id: 'bd', range: '(1,2)' }]);
  });

  it('inserendo da un altro ramo nel mezzo sposta il sommario che segue il punto di inserimento', () => {
    const sheets: Sheet[] = [
      {
        id: 's1',
        rootTopic: {
          id: 'root',
          title: 'R',
          children: {
            attached: [
              { id: 'p', title: 'P', children: { attached: [{ id: 'p1', title: 'P1' }] } },
              { id: 'b', title: 'B' },
              { id: 'c', title: 'C' },
              { id: 'd', title: 'D' },
            ],
            summary: [{ id: 'sum', title: 'S' }],
          },
          summaries: [{ id: 'sd', range: '(2,3)', topicId: 'sum' }],
        },
      },
    ];
    moveTopic(sheets, 'p1', 'b', 'before');
    const root = sheets[0].rootTopic;
    expect(root?.children?.attached?.map((t) => t.id)).toEqual(['p', 'p1', 'b', 'c', 'd']);
    expect(root?.summaries).toEqual([{ id: 'sd', range: '(3,4)', topicId: 'sum' }]);
  });

  it('spostando dentro (into) i range esistenti restano invariati', () => {
    const sheets: Sheet[] = [
      {
        id: 's1',
        rootTopic: {
          id: 'root',
          title: 'R',
          children: {
            attached: [
              { id: 'p', title: 'P', children: { attached: [{ id: 'p1', title: 'P1' }] } },
              { id: 'b', title: 'B' },
              { id: 'c', title: 'C' },
            ],
          },
          boundaries: [{ id: 'bd', range: '(1,2)' }],
        },
      },
    ];
    moveTopic(sheets, 'p1', 'root', 'into');
    const root = sheets[0].rootTopic;
    expect(root?.children?.attached?.map((t) => t.id)).toEqual(['p', 'b', 'c', 'p1']);
    expect(root?.boundaries).toEqual([{ id: 'bd', range: '(1,2)' }]);
  });
});

describe('moveTopic: riordino fra fratelli dello stesso genitore', () => {
  const sheetWith = (boundaryRange: string): Sheet[] => [
    {
      id: 's1',
      rootTopic: {
        id: 'root',
        title: 'R',
        children: {
          attached: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
          ],
        },
        boundaries: [{ id: 'bd', range: boundaryRange, title: 'Gruppo' }],
      },
    },
  ];

  it('un bordo sul solo blocco spostato non viene eliminato', () => {
    const sheets = sheetWith('(2,2)');
    moveTopic(sheets, 'c', 'a', 'before');
    const root = sheets[0].rootTopic;
    expect(root?.children?.attached?.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(root?.boundaries).toEqual([{ id: 'bd', range: '(2,2)', title: 'Gruppo' }]);
  });

  it('dopo l’ultimo fratello il blocco va in coda e il bordo resta intero', () => {
    const sheets = sheetWith('(1,2)');
    moveTopic(sheets, 'a', 'c', 'after');
    const root = sheets[0].rootTopic;
    expect(root?.children?.attached?.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(root?.boundaries?.[0].range).toBe('(1,2)');
  });
});

describe('setNotes conserva le chiavi sconosciute delle note', () => {
  it('aggiorna plain e realHTML lasciando invariate le altre chiavi', () => {
    const topic: Topic = {
      id: 't',
      notes: {
        plain: { content: 'vecchio', lang: 'it' },
        realHTML: { content: '<p>vecchio</p>', dir: 'ltr' },
        owner: 'x',
      },
    };
    setNotes(topic, 'nuovo');
    expect(topic.notes).toEqual({
      plain: { content: 'nuovo', lang: 'it' },
      realHTML: { content: '<p>nuovo</p>', dir: 'ltr' },
      owner: 'x',
    });
  });
});

describe('setFillColor rimuove solo svg:fill', () => {
  it('conserva id, type e le altre proprietà di style', () => {
    const topic: Topic = {
      id: 't',
      style: { id: 'st-1', type: 'topic', properties: { 'svg:fill': '#ff0000', 'fo:font-size': '12pt' } },
    };
    setFillColor(topic, null);
    expect(topic.style).toEqual({ id: 'st-1', type: 'topic', properties: { 'fo:font-size': '12pt' } });
  });

  it('con svg:fill unica proprietà conserva style.id', () => {
    const topic: Topic = { id: 't', style: { id: 'st-1', properties: { 'svg:fill': '#ff0000' } } };
    setFillColor(topic, null);
    expect(topic.style).toEqual({ id: 'st-1' });
  });

  it('elimina style quando non resta alcuna chiave', () => {
    const topic: Topic = { id: 't', style: { properties: { 'svg:fill': '#ff0000' } } };
    setFillColor(topic, null);
    expect(topic.style).toBeUndefined();
  });
});

describe('setTitleRuns conserva le chiavi sconosciute dei frammenti attributedTitle', () => {
  it('con lo stesso numero di frammenti mantiene fo:font-family del primo', () => {
    const topic: Topic = {
      id: 't',
      title: 'Alpha beta',
      attributedTitle: [{ text: 'Alpha', 'fo:font-family': 'Arial' }, { text: ' beta' }],
    };
    setTitleRuns(topic, [{ text: 'Alpha' }, { text: ' beta', bold: true }]);
    expect(topic.attributedTitle).toEqual([
      { text: 'Alpha', 'fo:font-family': 'Arial' },
      { text: ' beta', 'fo:font-weight': 'bold' },
    ]);
  });

  it('con un numero diverso di frammenti mantiene le chiavi identiche su tutti i frammenti precedenti', () => {
    const topic: Topic = {
      id: 't',
      title: 'Alpha beta',
      attributedTitle: [
        { text: 'Alpha', 'fo:font-family': 'Arial' },
        { text: ' beta', 'fo:font-family': 'Arial' },
      ],
    };
    setTitleRuns(topic, [{ text: 'Alpha beta', bold: true }]);
    expect(topic.attributedTitle).toEqual([
      { text: 'Alpha beta', 'fo:font-weight': 'bold', 'fo:font-family': 'Arial' },
    ]);
  });
});

describe('applyEquation conserva le chiavi dell\'immagine esistente', () => {
  it('unisce src, width, height e isMathJaxImage senza perdere align e chiavi sconosciute', async () => {
    const OLD_IMAGE_PX = 10;
    const topic: Topic = {
      id: 't',
      title: 'x',
      image: {
        src: 'xap:resources/old.png',
        width: OLD_IMAGE_PX,
        height: OLD_IMAGE_PX,
        align: 'center',
        customKey: 'keep',
      },
    };
    const { outcome } = await applyEquation(topic, 'x^2');
    expect(topic.image).toEqual({
      src: `xap:${outcome.resource}`,
      width: outcome.width,
      height: outcome.height,
      isMathJaxImage: true,
      align: 'center',
      customKey: 'keep',
    });
    expect(topic.extensions).toEqual([{ provider: MATHJAX_PROVIDER, content: { content: 'x^2' } }]);
  });
});
