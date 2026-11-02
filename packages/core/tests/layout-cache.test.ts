import { afterEach, describe, expect, it } from 'vitest';
import {
  estimateNodeSize,
  layoutSheets,
  setTextMeasurer,
  type Layout,
  type NodeSizeInput,
  type SheetDto,
  type SheetTheme,
  type TextMeasurer,
  type TopicView,
} from '../src/index.js';

/** Separatore interno della chiave di misura: un testo che lo contiene non deve collidere con altri campi. */
const KEY_SEP = '\u0001';

/** Misura che dipende dal font: `Mono` pesa il doppio, così il cambio di font si vede nelle dimensioni. */
const familyMeasurer: TextMeasurer = (text, fontSizePx, bold, family) =>
  [...text].length * fontSizePx * (family === 'Mono' ? 0.8 : 0.4) * (bold ? 1.2 : 1);

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
    childCount: 0,
    boundaries: [],
    summaries: [],
    ...over,
  };
}

/** Tema con lo stesso font e grassetto opzionale per tutti e tre i livelli. */
function themeWith(fontFamily: string, bold?: boolean): SheetTheme {
  const style = { fontFamily, bold };
  return { levels: { central: style, main: style, sub: style } };
}

function sheetWith(theme: SheetTheme, topics: TopicView[]): SheetDto {
  return { index: 0, title: 's', topics, relationships: [], theme };
}

/** Radice, due rami e un sotto-ramo, con testi di lunghezze diverse (`displayTitle` ha la precedenza sul titolo). */
function sampleTopics(): TopicView[] {
  const text = (value: string): Partial<TopicView> => ({ title: value, displayTitle: value });
  return [
    topic('r', undefined, text('Radice di prova')),
    topic('a', 'r', text('Ramo uno con un testo più lungo')),
    topic('b', 'r', text('Ramo due')),
    topic('a1', 'a', { depth: 2, ...text('Sotto ramo con testo') }),
  ];
}

function widthsById(layout: Layout): Record<string, number> {
  return Object.fromEntries(layout.nodes.map((n) => [n.id, n.w]));
}

afterEach(() => {
  setTextMeasurer(null);
});

describe('cache delle misure dei blocchi', () => {
  it('due layout dello stesso SheetDto danno risultati identici', () => {
    const dto = sheetWith(themeWith('Sans'), sampleTopics());
    expect(layoutSheets([dto])).toEqual(layoutSheets([dto]));
  });

  it('con viste riusate, il cambio di font del tema produce la misura del nuovo font', () => {
    setTextMeasurer(familyMeasurer);
    const topics = sampleTopics();
    const sans = sheetWith(themeWith('Sans'), topics);
    const mono = sheetWith(themeWith('Mono'), topics);

    const sansWidths = widthsById(layoutSheets([sans]));
    const monoWidths = widthsById(layoutSheets([mono]));

    expect(monoWidths).not.toEqual(sansWidths);
    expect(monoWidths).toEqual(widthsById(layoutSheets([structuredClone(mono)])));
  });

  it('il grassetto del tema entra nella misura anche con viste riusate', () => {
    setTextMeasurer(familyMeasurer);
    const topics = sampleTopics();
    const plain = sheetWith(themeWith('Sans'), topics);
    const bold = sheetWith(themeWith('Sans', true), topics);

    const plainWidths = widthsById(layoutSheets([plain]));
    const boldWidths = widthsById(layoutSheets([bold]));

    expect(boldWidths).not.toEqual(plainWidths);
    expect(boldWidths).toEqual(widthsById(layoutSheets([structuredClone(bold)])));
  });

  it('dopo setTextMeasurer le misure si ricalcolano anche con viste riusate', () => {
    const dto = sheetWith(themeWith('Sans'), sampleTopics());

    setTextMeasurer((text, fontSizePx) => [...text].length * fontSizePx * 0.4);
    const narrow = widthsById(layoutSheets([dto]));

    setTextMeasurer((text, fontSizePx) => [...text].length * fontSizePx * 0.8);
    const wide = widthsById(layoutSheets([dto]));

    expect(wide).not.toEqual(narrow);
    expect(wide).toEqual(widthsById(layoutSheets([structuredClone(dto)])));
  });
});

describe('misure per id del blocco', () => {
  /** Larghezza del blocco `a` dopo un primo layout con la vista originale (cache per id piena). */
  function widthAfterChange(change: Partial<TopicView>): { before: number; after: number; fresh: number } {
    setTextMeasurer(familyMeasurer);
    const base = sampleTopics();
    const before = widthsById(layoutSheets([sheetWith(themeWith('Sans'), base)])).a;
    const changed = base.map((t) => (t.id === 'a' ? { ...t, ...change } : t));
    const after = widthsById(layoutSheets([sheetWith(themeWith('Sans'), changed)])).a;
    // Riferimento senza cache per id: misuratore reinstallato, quindi cache vuote.
    setTextMeasurer(familyMeasurer);
    const fresh = widthsById(layoutSheets([sheetWith(themeWith('Sans'), changed)])).a;
    return { before, after, fresh };
  }

  it('stesso id con titolo diverso si rimisura', () => {
    const r = widthAfterChange({ title: 'Corto', displayTitle: 'Corto' });
    expect(r.after).not.toBe(r.before);
    expect(r.after).toBe(r.fresh);
  });

  it('stesso id con dimensione del testo diversa si rimisura', () => {
    const r = widthAfterChange({ textStyle: { fontSizePx: 30 } });
    expect(r.after).not.toBe(r.before);
    expect(r.after).toBe(r.fresh);
  });

  it('stesso id con frammenti di titolo diversi si rimisura', () => {
    const text = 'Ramo uno con un testo più lungo';
    const r1 = widthAfterChange({ titleRuns: [{ text }] });
    const r2 = widthAfterChange({ titleRuns: [{ text, fontSizePx: 30 }] });
    expect(r2.after).not.toBe(r1.after);
    expect(r2.after).toBe(r2.fresh);
  });

  it('stesso id con marker in più si rimisura', () => {
    const r = widthAfterChange({ title: 'x', displayTitle: 'x', markers: ['a', 'b', 'c', 'd'] });
    expect(r.after).toBe(r.fresh);
    expect(r.after).toBeGreaterThan(widthAfterChange({ title: 'x', displayTitle: 'x' }).after);
  });
});

describe('chiave delle dimensioni', () => {
  it('un separatore dentro il testo non fa collidere campi diversi', () => {
    const bothFields: NodeSizeInput = {
      depth: 2,
      title: 'Radice',
      displayTitle: `parte uno lunga${KEY_SEP}parte due lunga`,
    };
    const shiftedFields: NodeSizeInput = {
      depth: 2,
      title: `Radice${KEY_SEP}parte uno lunga`,
      displayTitle: 'parte due lunga',
    };
    setTextMeasurer(familyMeasurer);
    const expectedBoth = estimateNodeSize(bothFields);
    setTextMeasurer(familyMeasurer);
    const expectedShifted = estimateNodeSize(shiftedFields);
    expect(expectedShifted).not.toEqual(expectedBoth);

    setTextMeasurer(familyMeasurer);
    expect(estimateNodeSize(bothFields)).toEqual(expectedBoth);
    expect(estimateNodeSize(shiftedFields)).toEqual(expectedShifted);
  });
});
