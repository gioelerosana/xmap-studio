import { describe, expect, it } from 'vitest';
import {
  AppController,
  readTitleRuns,
  setTitleRuns,
  Topic,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

const sheetWith = (a: Record<string, unknown>) => [
  {
    id: 's1',
    class: 'sheet',
    title: 'Sheet 1',
    rootTopic: {
      id: 'root',
      class: 'topic',
      title: 'Root',
      children: {
        attached: [
          {
            id: 'a',
            class: 'topic',
            title: 'fbf è soddisfacibile',
            ...a,
          },
        ],
      },
    },
  },
];

describe('setTitleRuns e formattazione parziale (attributedTitle)', () => {
  it('scrive title come concatenazione e attributedTitle con frammenti formattati', () => {
    const t: Topic = { id: 't1', title: 'vecchio' };
    setTitleRuns(t, [
      { text: 'Hello ', bold: true },
      { text: 'world', italic: true },
    ]);

    expect(t.title).toBe('Hello world');
    expect(t.attributedTitle).toEqual([
      { text: 'Hello ', 'fo:font-weight': 'bold' },
      { text: 'world', 'fo:font-style': 'italic' },
    ]);
  });

  it('unisce frammenti adiacenti con stile identico', () => {
    const t: Topic = { id: 't1' };
    setTitleRuns(t, [
      { text: 'Hello ', bold: true },
      { text: 'beautiful ', bold: true },
      { text: 'world', italic: true },
      { text: '!', italic: true },
    ]);

    expect(t.title).toBe('Hello beautiful world!');
    expect(t.attributedTitle).toEqual([
      { text: 'Hello beautiful ', 'fo:font-weight': 'bold' },
      { text: 'world!', 'fo:font-style': 'italic' },
    ]);
  });

  it('se nessun frammento ha stile, rimuove attributedTitle e lascia solo title', () => {
    const t: Topic = {
      id: 't1',
      title: 'fbf è soddisfacibile',
      attributedTitle: [{ text: 'fbf è ' }, { text: 'soddisfacibile', 'fo:font-weight': 'bold' }],
    };
    setTitleRuns(t, [{ text: 'solo testo semplice' }]);
    expect(t.title).toBe('solo testo semplice');
    expect(t.attributedTitle).toBeUndefined();

    // Anche quando i frammenti multipli non hanno stile
    setTitleRuns(t, [{ text: 'parte 1 ' }, { text: 'parte 2' }]);
    expect(t.title).toBe('parte 1 parte 2');
    expect(t.attributedTitle).toBeUndefined();
  });

  it('preserva chiavi sconosciute e attributi avanzati dei frammenti', () => {
    const t: Topic = { id: 't1' };
    setTitleRuns(t, [
      {
        text: 'fbf ',
        bold: true,
        underline: true,
        color: '#ff0000',
        customProp: 'custom1',
      } as any,
      {
        text: 'soddisfacibile',
        'fo:font-family': 'Helvetica',
        customProp: 'custom2',
      } as any,
    ]);

    expect(t.title).toBe('fbf soddisfacibile');
    expect(t.attributedTitle).toEqual([
      {
        text: 'fbf ',
        'fo:font-weight': 'bold',
        'fo:text-decoration': 'underline',
        'fo:color': '#ff0000',
        customProp: 'custom1',
      },
      {
        text: 'soddisfacibile',
        'fo:font-family': 'Helvetica',
        customProp: 'custom2',
      },
    ]);
  });

  it('gestisce cancellazione di titleUnedited', () => {
    const t: Topic = { id: 't1', titleUnedited: true };
    setTitleRuns(t, [{ text: 'nuovo', bold: true }]);
    expect(t.titleUnedited).toBeUndefined();
    expect(t.title).toBe('nuovo');
  });

  it('readTitleRuns è compatibile con i frammenti generati da setTitleRuns', () => {
    const t: Topic = { id: 't1' };
    setTitleRuns(t, [
      { text: 'normale ' },
      { text: 'grassetto', bold: true },
      { text: ' corsivo', italic: true },
    ]);
    const read = readTitleRuns(t);
    expect(read).toEqual([
      { text: 'normale ' },
      { text: 'grassetto', bold: true },
      { text: ' corsivo', italic: true },
    ]);
  });

  it('AppController.setTopicTitleRuns gestisce storia, undo e mergeWithPrevious', async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind(sheetWith({})));

    // Modifica del titolo con frammenti
    const dto1 = ctrl.setTopicTitleRuns('a', [
      { text: 'titolo ' },
      { text: 'speciale', bold: true },
    ]);
    const topicA1 = dto1.sheets[0].topics.find((x) => x.id === 'a');
    expect(topicA1?.title).toBe('titolo speciale');
    expect(topicA1?.titleRuns).toEqual([
      { text: 'titolo ' },
      { text: 'speciale', bold: true },
    ]);

    // Undo torna allo stato precedente
    const undoDto = ctrl.undo();
    const topicAUndo = undoDto.sheets[0].topics.find((x) => x.id === 'a');
    expect(topicAUndo?.title).toBe('fbf è soddisfacibile');
    expect(topicAUndo?.titleRuns).toBeUndefined();

    // Redo ripristina i frammenti
    const redoDto = ctrl.redo();
    const topicARedo = redoDto.sheets[0].topics.find((x) => x.id === 'a');
    expect(topicARedo?.title).toBe('titolo speciale');
    expect(topicARedo?.titleRuns).toEqual([
      { text: 'titolo ' },
      { text: 'speciale', bold: true },
    ]);

    // Test mergeWithPrevious con creazione nuovo blocco
    const { newId: createdId } = ctrl.addTopic('a', 'Nuovo');
    const mergedDto = ctrl.setTopicTitleRuns(
      createdId,
      [{ text: 'Nuovo ', bold: true }, { text: 'blocco' }],
      { mergeWithPrevious: true }
    );
    const createdTopic = mergedDto.sheets[0].topics.find((x) => x.id === createdId);
    expect(createdTopic?.title).toBe('Nuovo blocco');
    expect(createdTopic?.titleRuns).toEqual([
      { text: 'Nuovo ', bold: true },
      { text: 'blocco' },
    ]);

    // Un singolo undo annulla sia la rinomina che la creazione del blocco!
    const singleUndoDto = ctrl.undo();
    expect(singleUndoDto.sheets[0].topics.find((x) => x.id === createdId)).toBeUndefined();
  });
  it("gestisce runs vuoti o senza testo", () => {
    const t: Topic = { id: "t1", title: "pre", attributedTitle: [{ text: "pre", "fo:font-weight": "bold" }] };
    setTitleRuns(t, []);
    expect(t.title).toBe("");
    expect(t.attributedTitle).toBeUndefined();

    setTitleRuns(t, [{ text: "" }]);
    expect(t.title).toBe("");
    expect(t.attributedTitle).toBeUndefined();
  });

  it("non aggiunge passi di cronologia se il titolo e i frammenti sono identici", async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind(sheetWith({})));
    ctrl.setTopicTitleRuns("a", [{ text: "ciao ", bold: true }, { text: "mondo" }]);
    const posBefore = (ctrl as any).currentWorkbook.pos;
    ctrl.setTopicTitleRuns("a", [{ text: "ciao ", bold: true }, { text: "mondo" }]);
    const posAfter = (ctrl as any).currentWorkbook.pos;
    expect(posAfter).toBe(posBefore);
  });

  it("lancia CODE_TOPIC_NOT_FOUND per topic inesistente", async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind(sheetWith({})));
    expect(() => ctrl.setTopicTitleRuns("non-esiste", [{ text: "x" }])).toThrowError(/non trovato/);
  });
});
