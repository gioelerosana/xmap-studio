import { describe, expect, it } from 'vitest';
import { AppController, readArchive, Sheet } from '../src/index.js';
import { minimalXmind } from './helpers.js';

const ROOT_ID = 'r';
const BRANCH_ID = 'a';
const LEAF_ID = 'b';

/** Radice con due figli; `a` è chiuso nel file e porta un campo sconosciuto da preservare. */
function sheets(branch: unknown = 'folded'): unknown[] {
  return [
    {
      id: 's',
      class: 'sheet',
      title: 'Foglio',
      rootTopic: {
        id: ROOT_ID,
        class: 'topic',
        title: 'Radice',
        children: {
          attached: [
            {
              id: BRANCH_ID,
              title: 'A',
              branch,
              customFlag: { keep: true },
              children: { attached: [{ id: 'a1', title: 'A1' }] },
            },
            { id: LEAF_ID, title: 'B' },
          ],
        },
      },
    },
  ];
}

async function openWith(branch?: unknown): Promise<AppController> {
  const c = new AppController();
  await c.open(await minimalXmind(sheets(branch)));
  return c;
}

async function contentOf(c: AppController): Promise<Sheet[]> {
  const { bytes } = await c.prepareArchiveBytes();
  const archive = await readArchive(bytes);
  const raw = archive.entries.get('content.json');
  if (!raw) throw new Error('content.json assente');
  return JSON.parse(new TextDecoder().decode(raw)) as Sheet[];
}

function topicInFile(content: Sheet[], id: string): Record<string, unknown> {
  const find = (node: unknown): Record<string, unknown> | undefined => {
    if (typeof node !== 'object' || node === null) return undefined;
    const record = node as Record<string, unknown>;
    if (record.id === id) return record;
    const children: unknown[] = Object.values(record.children ?? {}).flat();
    return children.map(find).find((hit) => hit !== undefined);
  };
  const hit = content.map((s) => find(s.rootTopic)).find((h) => h !== undefined);
  if (!hit) throw new Error(`topic ${id} assente`);
  return hit;
}

describe('ramo chiuso (branch: "folded")', () => {
  it('il DTO legge il ramo chiuso del file', async () => {
    const c = await openWith();
    const topics = c.workbook()!.sheets[0].topics;
    expect(topics.find((t) => t.id === BRANCH_ID)?.folded).toBe(true);
    expect(topics.find((t) => t.id === LEAF_ID)?.folded).toBe(false);
  });

  it('chiudere scrive branch e aprire lo rimuove, senza toccare gli altri campi', async () => {
    const c = await openWith();
    c.setTopicFolded(LEAF_ID, true);
    expect(topicInFile(await contentOf(c), LEAF_ID).branch).toBe('folded');

    c.setTopicFolded(BRANCH_ID, false);
    const branch = topicInFile(await contentOf(c), BRANCH_ID);
    expect('branch' in branch).toBe(false);
    expect(branch.customFlag).toEqual({ keep: true });
    expect(branch.title).toBe('A');
    expect(topicInFile(await contentOf(c), 'a1').title).toBe('A1');
  });

  it('un valore sconosciuto di branch resta com è quando si apre il ramo', async () => {
    const c = await openWith('ramo-sconosciuto');
    expect(c.workbook()!.sheets[0].topics.find((t) => t.id === BRANCH_ID)?.folded).toBe(false);
    c.setTopicFolded(BRANCH_ID, false);
    expect(topicInFile(await contentOf(c), BRANCH_ID).branch).toBe('ramo-sconosciuto');
  });

  it('il ripiegamento rende il file modificato ed è un passo di undo', async () => {
    const c = await openWith();
    expect(c.workbook()!.dirty).toBe(false);
    const dto = c.setTopicFolded(LEAF_ID, true);
    expect(dto.dirty).toBe(true);
    expect(dto.canUndo).toBe(true);

    const undone = c.undo();
    expect(undone.sheets[0].topics.find((t) => t.id === LEAF_ID)?.folded).toBe(false);
    expect(undone.dirty).toBe(false);
    expect(topicInFile(await contentOf(c), LEAF_ID).branch).toBeUndefined();
    expect(topicInFile(await contentOf(c), BRANCH_ID).branch).toBe('folded');

    const redone = c.redo();
    expect(redone.sheets[0].topics.find((t) => t.id === LEAF_ID)?.folded).toBe(true);
  });

  it('annullare una modifica successiva lascia il ramo chiuso', async () => {
    const c = await openWith();
    c.setTopicFolded(LEAF_ID, true);
    c.setTopicTitle(LEAF_ID, 'B2');

    const undone = c.undo();
    expect(undone.sheets[0].topics.find((t) => t.id === LEAF_ID)?.title).toBe('B');
    expect(undone.sheets[0].topics.find((t) => t.id === LEAF_ID)?.folded).toBe(true);
  });

  it('aggiungere un figlio apre il ramo, in un solo passo di undo', async () => {
    const c = await openWith();
    c.setTopicFolded(LEAF_ID, true);
    expect(c.workbook()!.sheets[0].topics.find((t) => t.id === LEAF_ID)?.folded).toBe(true);

    c.addTopic(LEAF_ID, 'Nuovo');
    expect(c.workbook()!.sheets[0].topics.find((t) => t.id === LEAF_ID)?.folded).toBe(false);
    expect(topicInFile(await contentOf(c), LEAF_ID).branch).toBeUndefined();

    const undone = c.undo();
    expect(undone.sheets[0].topics.find((t) => t.id === LEAF_ID)?.folded).toBe(true);
  });

  it('un ramo già nello stato richiesto non cambia il file', async () => {
    const c = await openWith();
    const before = await contentOf(c);
    c.setTopicFolded(BRANCH_ID, true);
    expect(await contentOf(c)).toEqual(before);
    expect(c.workbook()!.dirty).toBe(false);
  });

  it('la radice chiusa nel file resta chiusa dopo il round-trip', async () => {
    const c = await openWith();
    c.setTopicFolded(ROOT_ID, true);
    const reopened = new AppController();
    const { bytes } = await c.prepareArchiveBytes();
    await reopened.open(bytes);
    expect(reopened.workbook()!.sheets[0].topics.find((t) => t.id === ROOT_ID)?.folded).toBe(true);
  });
});
