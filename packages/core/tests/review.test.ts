import { describe, expect, it } from 'vitest';
import {
  buildReviewPath,
  reviewCollapsed,
  reviewFocus,
  stepIndexOf,
} from '../src/review/index.js';
import type { SheetDto, TopicView } from '../src/state/types.js';

/** Topic con i campi obbligatori valorizzati a vuoto; `opts` sovrascrive quello che serve. */
function topic(id: string, opts: Partial<TopicView> = {}): TopicView {
  return {
    id,
    sheetIndex: 0,
    depth: 0,
    group: '',
    title: id,
    displayTitle: '',
    kind: 'text',
    notes: '',
    labels: [],
    markers: [],
    childCount: 0,
    boundaries: [],
    summaries: [],
    ...opts,
  };
}

function sheet(index: number, topics: TopicView[], title = `Foglio ${index}`): SheetDto {
  return { index, title, topics, relationships: [] };
}

function ids(steps: { topicId: string }[]): string[] {
  return steps.map((step) => step.topicId);
}

describe('buildReviewPath', () => {
  it('visita in ordine anticipato un albero a tre livelli', () => {
    // I figli seguono l'ordine di `topics` (qui B compare prima di A): il percorso segue quello.
    const path = buildReviewPath([
      sheet(0, [
        topic('A1', { parentId: 'A' }),
        topic('B', { parentId: 'R' }),
        topic('R'),
        topic('A', { parentId: 'R' }),
        topic('B1', { parentId: 'B' }),
        topic('A2', { parentId: 'A' }),
      ]),
    ]);
    expect(ids(path.steps)).toEqual(['R', 'B', 'B1', 'A', 'A1', 'A2']);
    const byId = new Map(path.steps.map((step) => [step.topicId, step]));
    expect(byId.get('R')).toMatchObject({ depth: 0, ancestorIds: [], childIds: ['B', 'A'] });
    expect(byId.get('A')).toMatchObject({ depth: 1, ancestorIds: ['R'], childIds: ['A1', 'A2'] });
    expect(byId.get('A2')).toMatchObject({ depth: 2, ancestorIds: ['R', 'A'], childIds: [] });
    expect(byId.get('B1')).toMatchObject({ depth: 2, ancestorIds: ['R', 'B'], childIds: [] });
  });

  it('usa displayTitle come titolo e ripiega su title se è vuoto', () => {
    const path = buildReviewPath([
      sheet(0, [topic('R', { title: 'Radice', displayTitle: 'Radice mostrata' }), topic('A', { parentId: 'R', title: 'Solo titolo' })]),
    ]);
    expect(path.steps.map((step) => step.title)).toEqual(['Radice mostrata', 'Solo titolo']);
  });

  it('due fogli: il secondo parte dopo il primo, con isSheetStart e sheetStarts corretti', () => {
    const path = buildReviewPath([
      sheet(0, [topic('R1'), topic('X1', { parentId: 'R1' })], 'Primo'),
      sheet(1, [topic('R2'), topic('X2', { parentId: 'R2' }), topic('Y2', { parentId: 'R2' })], 'Secondo'),
    ]);
    expect(ids(path.steps)).toEqual(['R1', 'X1', 'R2', 'X2', 'Y2']);
    expect(path.steps.map((step) => step.sheetIndex)).toEqual([0, 0, 1, 1, 1]);
    expect(path.steps.map((step) => step.isSheetStart)).toEqual([true, false, true, false, false]);
    expect(path.sheetStarts).toEqual([
      { sheetIndex: 0, title: 'Primo', firstStep: 0, stepCount: 2 },
      { sheetIndex: 1, title: 'Secondo', firstStep: 2, stepCount: 3 },
    ]);
  });

  it('salta i fogli vuoti: nessun passo e nessuna voce in sheetStarts', () => {
    const path = buildReviewPath([
      sheet(0, [topic('R0')]),
      sheet(1, []),
      sheet(2, [topic('R2')]),
    ]);
    expect(ids(path.steps)).toEqual(['R0', 'R2']);
    expect(path.steps.map((step) => step.sheetIndex)).toEqual([0, 2]);
    expect(path.sheetStarts.map((start) => start.sheetIndex)).toEqual([0, 2]);
    expect(path.sheetStarts[1]).toEqual({ sheetIndex: 2, title: 'Foglio 2', firstStep: 1, stepCount: 1 });
  });

  it('senza fogli o con soli fogli vuoti non produce nulla', () => {
    expect(buildReviewPath([])).toEqual({ steps: [], sheetStarts: [] });
    expect(buildReviewPath([sheet(0, [])])).toEqual({ steps: [], sheetStarts: [] });
  });

  it('mette i sommari dopo i figli normali, anche se compaiono prima in topics', () => {
    const path = buildReviewPath([
      sheet(0, [
        topic('R'),
        topic('S1', { parentId: 'R', group: 'summary' }),
        topic('C1', { parentId: 'R' }),
        topic('C2', { parentId: 'R' }),
        topic('SC', { parentId: 'C1', group: 'summary' }),
        topic('CC', { parentId: 'C1' }),
      ]),
    ]);
    expect(ids(path.steps)).toEqual(['R', 'C1', 'CC', 'SC', 'C2', 'S1']);
    const root = path.steps[0];
    expect(root.childIds).toEqual(['C1', 'C2', 'S1']);
    expect(path.steps.find((step) => step.topicId === 'C1')?.childIds).toEqual(['CC', 'SC']);
  });

  it('percorre un blocco libero come albero a sé, dopo quello principale e non come figlio', () => {
    // Il libero F è agganciato a R (parentId), ma non è figlio di R; il suo figlio F1 sì.
    const path = buildReviewPath([
      sheet(0, [
        topic('F', { parentId: 'R', group: 'detached' }),
        topic('R'),
        topic('A', { parentId: 'R' }),
        topic('F1', { parentId: 'F' }),
      ]),
    ]);
    expect(ids(path.steps)).toEqual(['R', 'A', 'F', 'F1']);
    const libero = path.steps.find((step) => step.topicId === 'F');
    expect(libero).toMatchObject({
      ancestorIds: [],
      depth: 0,
      childIds: ['F1'],
      isSheetStart: false,
    });
    expect(path.steps.find((step) => step.topicId === 'R')?.childIds).toEqual(['A']);
    expect(path.steps.find((step) => step.topicId === 'F1')).toMatchObject({
      ancestorIds: ['F'],
      depth: 1,
    });
  });

  it('percorre anche i rami folded', () => {
    const path = buildReviewPath([
      sheet(0, [
        topic('R', { folded: true }),
        topic('A', { parentId: 'R', folded: true }),
        topic('A1', { parentId: 'A' }),
      ]),
    ]);
    expect(ids(path.steps)).toEqual(['R', 'A', 'A1']);
    expect(path.steps[0].childIds).toEqual(['A']);
  });

  it('un ciclo di parentId non manda in loop e non duplica i topic', () => {
    const path = buildReviewPath([
      sheet(0, [
        topic('R'),
        topic('X', { parentId: 'Y' }),
        topic('Y', { parentId: 'X' }),
        topic('S', { parentId: 'S' }),
      ]),
    ]);
    const visitedIds = ids(path.steps);
    expect([...visitedIds].sort()).toEqual(['R', 'S', 'X', 'Y']);
    expect(new Set(visitedIds).size).toBe(visitedIds.length);
    const x = path.steps.find((step) => step.topicId === 'X');
    const y = path.steps.find((step) => step.topicId === 'Y');
    expect(x?.childIds).toEqual(['Y']);
    expect(y?.childIds).toEqual([]);
  });

  it('un ciclo senza nessuna radice parte dal primo topic e non si ripete', () => {
    const path = buildReviewPath([
      sheet(0, [topic('A', { parentId: 'B' }), topic('B', { parentId: 'A' })]),
    ]);
    expect(ids(path.steps)).toEqual(['A', 'B']);
    expect(path.steps[0]).toMatchObject({ ancestorIds: [], depth: 0, childIds: ['B'] });
    expect(path.steps[1]).toMatchObject({ ancestorIds: ['A'], depth: 1, childIds: [] });
  });

  it('un topic con genitore assente dal foglio diventa un albero a sé', () => {
    const path = buildReviewPath([
      sheet(0, [topic('R'), topic('O', { parentId: 'FANTASMA' })]),
    ]);
    expect(ids(path.steps)).toEqual(['R', 'O']);
    expect(path.steps[1]).toMatchObject({ ancestorIds: [], depth: 0 });
  });
});

describe('reviewFocus', () => {
  // Albero: R -> A -> {A1, A2}; R -> B
  const path = buildReviewPath([
    sheet(0, [
      topic('R'),
      topic('A', { parentId: 'R' }),
      topic('A1', { parentId: 'A' }),
      topic('A2', { parentId: 'A' }),
      topic('B', { parentId: 'R' }),
    ]),
  ]);

  it('su una foglia: lit = passo e antenati, path = antenati e passo', () => {
    const step = path.steps[2];
    expect(step.topicId).toBe('A1');
    const focus = reviewFocus(step);
    expect(focus.lit).toEqual(new Set(['A1', 'R', 'A']));
    expect(focus.path).toEqual(new Set(['R', 'A', 'A1']));
  });

  it('su un ramo intermedio: lit include anche i figli diretti, path resta la catena', () => {
    const step = path.steps[1];
    expect(step.topicId).toBe('A');
    const focus = reviewFocus(step);
    expect(focus.lit).toEqual(new Set(['A', 'R', 'A1', 'A2']));
    expect(focus.path).toEqual(new Set(['R', 'A']));
  });

  it('sulla radice: lit = radice e figli, path = solo la radice', () => {
    const focus = reviewFocus(path.steps[0]);
    expect(focus.lit).toEqual(new Set(['R', 'A', 'B']));
    expect(focus.path).toEqual(new Set(['R']));
  });
});

describe('reviewCollapsed', () => {
  // R ha figli A e B; A ha figlio A1; B ha solo un libero (non conta come figlio); S1 è un sommario di R.
  const s = sheet(0, [
    topic('R'),
    topic('A', { parentId: 'R' }),
    topic('A1', { parentId: 'A' }),
    topic('B', { parentId: 'R' }),
    topic('L', { parentId: 'B', group: 'detached' }),
    topic('S1', { parentId: 'R', group: 'summary' }),
  ]);

  it('restituisce i topic con figli non aperti, senza le foglie né i topic con soli liberi', () => {
    expect(reviewCollapsed(s, new Set())).toEqual(new Set(['R', 'A']));
  });

  it('esclude i topic già in opened', () => {
    expect(reviewCollapsed(s, new Set(['A']))).toEqual(new Set(['R']));
    expect(reviewCollapsed(s, new Set(['R', 'A']))).toEqual(new Set());
  });
});

describe('stepIndexOf', () => {
  const path = buildReviewPath([
    sheet(0, [topic('R0'), topic('X0', { parentId: 'R0' })]),
    sheet(3, [topic('R3')]),
  ]);

  it('restituisce l’indice del passo quando il topic è nel foglio indicato', () => {
    expect(stepIndexOf(path, 0, 'X0')).toBe(1);
    expect(stepIndexOf(path, 3, 'R3')).toBe(2);
  });

  it('restituisce -1 per un topic inesistente o nel foglio sbagliato', () => {
    expect(stepIndexOf(path, 0, 'NON-C-E')).toBe(-1);
    expect(stepIndexOf(path, 3, 'X0')).toBe(-1);
    expect(stepIndexOf(path, 1, 'R0')).toBe(-1);
  });
});
