import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { AppController, runAgentTool, type AgentContext, type TopicView, type WorkbookDto } from '../src/index.js';
import { minimalXmind } from './helpers.js';

const CTX: AgentContext = { activeSheetIndex: 0, selectedTopicIds: [] };

/**
 * Mappa di prova: foglio 1 con radice `r` e figli `a` (con a1, a2 e a2x sotto a2) e `b`;
 * foglio 2 con una sola radice. Campi sconosciuti (`foo`, `bar`) per il test di round-trip.
 */
function fixture(): unknown[] {
  return [
    {
      id: 's1',
      class: 'sheet',
      title: 'Foglio',
      foo: 'campo-foglio',
      rootTopic: {
        id: 'r',
        class: 'topic',
        title: 'Radice',
        bar: 'campo-radice',
        children: {
          attached: [
            {
              id: 'a',
              title: 'A',
              notes: { plain: { content: 'Nota lunga su A' } },
              labels: ['uno'],
              markers: [{ markerId: 'priority-2' }],
              foo: 'x',
              children: {
                attached: [
                  { id: 'a1', title: 'A1' },
                  { id: 'a2', title: 'A2', children: { attached: [{ id: 'a2x', title: 'A2X' }] } },
                ],
              },
            },
            { id: 'b', title: 'B' },
          ],
        },
      },
    },
    {
      id: 's2',
      class: 'sheet',
      title: 'Secondo',
      rootTopic: { id: 'r2', class: 'topic', title: 'Radice 2' },
    },
  ];
}

async function openMap(sheets?: unknown[]): Promise<AppController> {
  const c = new AppController();
  await c.open(await minimalXmind(sheets ?? fixture()));
  return c;
}

function wbOf(c: AppController): WorkbookDto {
  const wb = c.workbook();
  if (!wb) throw new Error('Nessuna mappa aperta nel test');
  return wb;
}

function topicOf(c: AppController, id: string): TopicView {
  const topic = wbOf(c)
    .sheets.flatMap((s) => s.topics)
    .find((t) => t.id === id);
  if (!topic) throw new Error(`Blocco ${id} assente nel test`);
  return topic;
}

function countTopics(c: AppController): number {
  return wbOf(c).sheets.reduce((n, s) => n + s.topics.length, 0);
}

/** Legge content.json dai byte che l'app salverebbe, come farebbe un file `.xmind` aperto altrove. */
async function contentJson(c: AppController): Promise<Array<Record<string, unknown>>> {
  const { bytes } = await c.prepareArchiveBytes();
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('content.json');
  if (!file) throw new Error('content.json assente nell\'archivio');
  return JSON.parse(await file.async('string')) as Array<Record<string, unknown>>;
}

/** Trova un blocco per id dentro content.json (ricerca ricorsiva). */
function rawTopic(node: unknown, id: string): Record<string, unknown> | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  if ((node as { id?: unknown }).id === id) return node as Record<string, unknown>;
  for (const value of Object.values(node)) {
    const found = rawTopic(value, id);
    if (found) return found;
  }
  return undefined;
}

describe('read_map', () => {
  it('mostra titoli, foglio mostrato e selezione dell\'utente', async () => {
    const c = await openMap();
    const all = await runAgentTool(c, 'read_map', {}, CTX);
    expect(all.changed).toBe(false);
    expect(all.text).toContain('[r] Radice');
    expect(all.text).toContain('[a] A');
    expect(all.text).toContain('1. Foglio (mostrato)');

    const selected = await runAgentTool(c, 'read_map', {}, { ...CTX, selectedTopicIds: ['a'] });
    expect(selected.text).toContain("Selezione dell'utente: [a] A");
  });

  it('con depth 0 mostra solo la radice e il numero dei figli nascosti', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'read_map', { depth: 0 }, CTX);
    expect(r.text).toContain('[r] Radice');
    expect(r.text).toContain('2 figli non mostrati');
    expect(r.text).not.toContain('[a] A');
  });

  it('con topicId mostra solo il ramo di quel blocco', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'read_map', { topicId: 'a' }, CTX);
    expect(r.text).toContain('ramo di [a]');
    expect(r.text).toContain('[a2x] A2X');
    expect(r.text).not.toContain('[b] B');
    expect(r.text).not.toContain('[r] Radice');
  });

  it('un foglio inesistente è un errore', async () => {
    const c = await openMap();
    await expect(runAgentTool(c, 'read_map', { sheet: 9 }, CTX)).rejects.toThrow(/inesistente/);
  });

  it('con sheet mostra il foglio richiesto', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'read_map', { sheet: 2 }, CTX);
    expect(r.text).toContain('Foglio 2 «Secondo»');
    expect(r.text).toContain('[r2] Radice 2');
  });
});

describe('add_topics', () => {
  it('aggiunge un sottoalbero annidato in un solo passo di undo', async () => {
    const c = await openMap();
    const before = countTopics(c);
    const r = await runAgentTool(
      c,
      'add_topics',
      {
        parentId: 'b',
        topics: [
          {
            title: 'Nuovo',
            notes: 'Una nota',
            labels: ['etichetta'],
            markers: ['priority-1'],
            children: [{ title: 'Figlio', children: [{ title: 'Nipote' }] }],
          },
          { title: 'Secondo' },
        ],
      },
      CTX
    );
    expect(countTopics(c)).toBe(before + 4);
    expect(r.changed).toBe(true);
    expect(r.text).toContain('Aggiunti 4 blocchi sotto [b]');

    const topics = wbOf(c).sheets[0].topics;
    const nuovo = topics.find((t) => t.title === 'Nuovo');
    const figlio = topics.find((t) => t.title === 'Figlio');
    const nipote = topics.find((t) => t.title === 'Nipote');
    expect(nuovo?.id).toBe(r.focusTopicId);
    expect(nuovo?.parentId).toBe('b');
    expect(nuovo?.notes).toBe('Una nota');
    expect(nuovo?.labels).toEqual(['etichetta']);
    expect(nuovo?.markers).toContain('priority-1');
    expect(figlio?.parentId).toBe(nuovo?.id);
    expect(nipote?.parentId).toBe(figlio?.id);

    c.undo();
    expect(countTopics(c)).toBe(before);
    expect(wbOf(c).canUndo).toBe(false);
  });

  it('un marker sconosciuto fa fallire senza modificare la mappa', async () => {
    const c = await openMap();
    const before = countTopics(c);
    await expect(
      runAgentTool(c, 'add_topics', { parentId: 'b', topics: [{ title: 'X', children: [{ title: 'Y', markers: ['marker-inesistente'] }] }] }, CTX)
    ).rejects.toThrow(/Marker sconosciuto/);
    expect(countTopics(c)).toBe(before);
    expect(wbOf(c).canUndo).toBe(false);
  });

  it('un nodo con latex diventa una formula', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'add_topics', { parentId: 'b', topics: [{ title: '', latex: 'x^2+1' }] }, CTX);
    expect(r.changed).toBe(true);
    expect(r.text).toContain('Formule applicate: 1');
    const formula = topicOf(c, r.focusTopicId ?? '');
    expect(formula.kind).toBe('equation');
    expect(formula.latex).toBe('x^2+1');
  });

  it('errori su genitore sconosciuto ed elenco vuoto', async () => {
    const c = await openMap();
    await expect(runAgentTool(c, 'add_topics', { parentId: 'zzz', topics: [{ title: 'X' }] }, CTX)).rejects.toThrow(/non trovato/);
    await expect(runAgentTool(c, 'add_topics', { parentId: 'b', topics: [] }, CTX)).rejects.toThrow(/elenco non vuoto/);
  });
});

describe('update_topic', () => {
  it('modifica titolo, note, etichette e marker in un solo passo di undo', async () => {
    const c = await openMap();
    const r = await runAgentTool(
      c,
      'update_topic',
      { topicId: 'a', title: 'A nuovo', notes: 'Nuova nota', labels: ['due', 'tre'], addMarkers: ['task-done'] },
      CTX
    );
    expect(r.changed).toBe(true);
    expect(r.focusTopicId).toBe('a');
    const a = topicOf(c, 'a');
    expect(a.title).toBe('A nuovo');
    expect(a.notes).toBe('Nuova nota');
    expect(a.labels).toEqual(['due', 'tre']);
    expect(a.markers).toEqual(expect.arrayContaining(['priority-2', 'task-done']));

    c.undo();
    const back = topicOf(c, 'a');
    expect(back.title).toBe('A');
    expect(back.notes).toBe('Nota lunga su A');
    expect(back.labels).toEqual(['uno']);
    expect(back.markers).toEqual(['priority-2']);
    expect(wbOf(c).canUndo).toBe(false);
  });

  it('notes null toglie le note', async () => {
    const c = await openMap();
    await runAgentTool(c, 'update_topic', { topicId: 'a', notes: null }, CTX);
    expect(topicOf(c, 'a').notes).toBe('');
  });

  it('un colore non valido è un errore', async () => {
    const c = await openMap();
    await expect(runAgentTool(c, 'update_topic', { topicId: 'a', color: 'rosso' }, CTX)).rejects.toThrow(/#RRGGBB/);
    expect(wbOf(c).canUndo).toBe(false);
  });

  it('senza nessun campo da cambiare è un errore', async () => {
    const c = await openMap();
    await expect(runAgentTool(c, 'update_topic', { topicId: 'a' }, CTX)).rejects.toThrow(/Nessuna modifica/);
  });
});

describe('campi sconosciuti (round-trip)', () => {
  it('il campo extra di un blocco sopravvive a update_topic, quello di foglio e radice a add_topics', async () => {
    const c = await openMap();
    await runAgentTool(c, 'update_topic', { topicId: 'a', title: 'A2' }, CTX);
    let content = await contentJson(c);
    expect(rawTopic(content, 'a')?.foo).toBe('x');
    expect(rawTopic(content, 'a')?.title).toBe('A2');

    await runAgentTool(c, 'add_topics', { parentId: 'r', topics: [{ title: 'Nuovo sotto la radice' }] }, CTX);
    content = await contentJson(c);
    expect(content[0].foo).toBe('campo-foglio');
    expect(rawTopic(content, 'r')?.bar).toBe('campo-radice');
    expect(rawTopic(content, 'a')?.foo).toBe('x');
  });
});

describe('formule, spostamenti ed eliminazioni', () => {
  it('set_equation applica la formula e con latex vuoto la toglie', async () => {
    const c = await openMap();
    const on = await runAgentTool(c, 'set_equation', { topicId: 'b', latex: '\\frac{1}{2}' }, CTX);
    expect(on.changed).toBe(true);
    expect(topicOf(c, 'b').kind).toBe('equation');

    const off = await runAgentTool(c, 'set_equation', { topicId: 'b', latex: '' }, CTX);
    expect(off.changed).toBe(true);
    expect(off.text).toContain('tornato testo');
    expect(topicOf(c, 'b').kind).toBe('text');
  });

  it('move_topic con placement non valido è un errore; con uno valido sposta il blocco', async () => {
    const c = await openMap();
    await expect(
      runAgentTool(c, 'move_topic', { topicId: 'a', targetId: 'b', placement: 'sopra' }, CTX)
    ).rejects.toThrow(/placement/);

    const r = await runAgentTool(c, 'move_topic', { topicId: 'b', targetId: 'a', placement: 'before' }, CTX);
    expect(r.changed).toBe(true);
    const order = wbOf(c).sheets[0].topics.filter((t) => t.parentId === 'r').map((t) => t.id);
    expect(order).toEqual(['b', 'a']);
  });

  it('delete_topic elimina il ramo e restituisce il genitore come focus', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'delete_topic', { topicId: 'a' }, CTX);
    expect(r.changed).toBe(true);
    expect(r.focusTopicId).toBe('r');
    expect(r.text).toContain('Eliminati 4 blocchi');
    expect(wbOf(c).sheets[0].topics.map((t) => t.id).sort()).toEqual(['b', 'r']);

    c.undo();
    expect(topicOf(c, 'a2x').id).toBe('a2x');
  });

  it('delete_topic con keepChildren ricollega i figli al genitore', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'delete_topic', { topicId: 'a', keepChildren: true }, CTX);
    expect(r.focusTopicId).toBe('r');
    expect(r.text).toContain('2 figli ricollegati');
    expect(wbOf(c).sheets[0].topics.some((t) => t.id === 'a')).toBe(false);
    expect(topicOf(c, 'a1').parentId).toBe('r');
    expect(topicOf(c, 'a2').parentId).toBe('r');
    expect(topicOf(c, 'a2x').parentId).toBe('a2');
  });

  it('la radice non si elimina', async () => {
    const c = await openMap();
    await expect(runAgentTool(c, 'delete_topic', { topicId: 'r' }, CTX)).rejects.toThrow();
  });
});

describe('ricerca, marker, selezione', () => {
  it('find_topics trova per titolo e per note', async () => {
    const c = await openMap();
    const byTitle = await runAgentTool(c, 'find_topics', { query: 'a1' }, CTX);
    expect(byTitle.changed).toBe(false);
    expect(byTitle.text).toContain('1 blocchi contengono «a1»');
    expect(byTitle.text).toContain('[a1] A1');

    const byNote = await runAgentTool(c, 'find_topics', { query: 'LUNGA' }, CTX);
    expect(byNote.text).toContain('[a] A');
  });

  it('find_topics rispetta limit e segnala i risultati esclusi', async () => {
    const c = await openMap();
    for (let i = 1; i <= 5; i++) {
      await runAgentTool(c, 'add_topics', { parentId: 'b', topics: [{ title: `Esempio ${i}` }] }, CTX);
    }
    const r = await runAgentTool(c, 'find_topics', { query: 'esempio', limit: 2 }, CTX);
    expect(r.text).toContain('5 blocchi contengono «esempio»');
    expect(r.text).toContain('altri 3 risultati');
    expect(r.text.split('\n').filter((line) => line.startsWith('- [')).length).toBe(2);
  });

  it('list_markers elenca i marker utilizzabili', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'list_markers', {}, CTX);
    expect(r.changed).toBe(false);
    expect(r.text).toContain('priority-1');
  });

  it('select_topic restituisce il focus senza modificare la mappa', async () => {
    const c = await openMap();
    const r = await runAgentTool(c, 'select_topic', { topicId: 'a2' }, CTX);
    expect(r.changed).toBe(false);
    expect(r.focusTopicId).toBe('a2');
    expect(r.text).toContain('Selezionato [a2]');
    expect(wbOf(c).canUndo).toBe(false);
  });

  it('strumenti sconosciuti o di scope host/app sono errori', async () => {
    const c = await openMap();
    await expect(runAgentTool(c, 'strumento_inesistente', {}, CTX)).rejects.toThrow(/Strumento sconosciuto/);
    await expect(runAgentTool(c, 'list_maps', {}, CTX)).rejects.toThrow(/Strumento sconosciuto/);
    await expect(runAgentTool(c, 'save_map', {}, CTX)).rejects.toThrow(/Strumento sconosciuto/);
  });
});
