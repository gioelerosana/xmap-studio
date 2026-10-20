import { describe, expect, it } from 'vitest';
import { AppController, sha256Hex, validateArchiveBytes } from '../src/index.js';
import { minimalXmind } from './helpers.js';

const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);

const siblingsSheets = [
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

describe('controller: sommario con immagine sui blocchi fratelli', () => {
  it('addSummaryImageForSiblings crea il sommario e ne fa un blocco-immagine', async () => {
    const c = new AppController();
    await c.open(await minimalXmind(siblingsSheets));

    const { summaryTopicId } = c.addSummaryImageForSiblings(['b0', 'b2'], fakePng, 'image/png', {
      width: 800,
      height: 600,
    });

    const sheet = c.workbook()!.sheets[0];
    const summaryView = sheet.topics.find((t) => t.id === summaryTopicId);
    expect(summaryView).toBeDefined();
    expect(summaryView?.group).toBe('summary');
    expect(summaryView?.kind).toBe('image');
    expect(summaryView?.title).toBe('');
    expect(summaryView?.imageSrc).toBe(`xap:resources/${sha256Hex(fakePng)}.png`);
    expect(summaryView?.imageW).toBe(400);
    expect(summaryView?.imageH).toBe(300);

    const root = sheet.topics.find((t) => t.id === 'r')!;
    expect(root.summaries).toHaveLength(1);
    expect(root.summaries[0].range).toBe('(0,2)');
    expect(root.summaries[0].id).toBe(summaryTopicId);
  });

  it('registra la risorsa nell archivio e nel manifest, e l archivio preparato è valido', async () => {
    const c = new AppController();
    await c.open(await minimalXmind(siblingsSheets));
    const { summaryTopicId } = c.addSummaryImageForSiblings(['b0', 'b1'], fakePng, 'image/png', {
      width: 200,
      height: 100,
    });

    const resourceName = `resources/${sha256Hex(fakePng)}.png`;
    expect(c.resourceBytes(`xap:${resourceName}`)).toEqual(fakePng);
    const manifestEntries = (c as any).currentWorkbook.manifest?.['file-entries'];
    expect(manifestEntries?.[resourceName]).toBeDefined();

    const prepared = await c.prepareArchiveBytes();
    const report = await validateArchiveBytes(prepared.bytes);
    expect(report.resourceRefs).toBeGreaterThanOrEqual(1);
    expect(summaryTopicId).toBeTruthy();
  });

  it('è un solo passo di undo e redo', async () => {
    const c = new AppController();
    await c.open(await minimalXmind(siblingsSheets));
    const { summaryTopicId } = c.addSummaryImageForSiblings(['b0', 'b2'], fakePng, 'image/png', {
      width: 200,
      height: 200,
    });

    c.undo();
    const afterUndo = c.workbook()!.sheets[0];
    expect(afterUndo.topics.find((t) => t.id === summaryTopicId)).toBeUndefined();
    expect(afterUndo.topics.find((t) => t.id === 'r')!.summaries).toHaveLength(0);

    c.redo();
    const afterRedo = c.workbook()!.sheets[0];
    expect(afterRedo.topics.find((t) => t.id === summaryTopicId)?.imageSrc).toMatch(/^xap:resources\//);
  });

  it('con selezione non valida lancia un errore e non modifica la mappa', async () => {
    const c = new AppController();
    await c.open(await minimalXmind(siblingsSheets));
    const before = c.workbook()!.sheets[0].topics.length;

    expect(() => c.addSummaryImageForSiblings(['r', 'b0'], fakePng, 'image/png', { width: 1, height: 1 })).toThrow(
      /sommario/
    );
    expect(() => c.addSummaryImageForSiblings(['non-esistente'], fakePng, 'image/png', { width: 1, height: 1 })).toThrow(
      /sommario/
    );
    expect(c.workbook()!.sheets[0].topics.length).toBe(before);
  });

  it('rifiuta un\'immagine vuota senza creare il sommario', async () => {
    const c = new AppController();
    await c.open(await minimalXmind(siblingsSheets));
    expect(() =>
      c.addSummaryImageForSiblings(['b0', 'b1'], new Uint8Array(0), 'image/png', { width: 1, height: 1 })
    ).toThrowError();
    expect(c.workbook()!.sheets[0].topics.find((t) => t.id === 'r')!.summaries).toHaveLength(0);
  });
});
