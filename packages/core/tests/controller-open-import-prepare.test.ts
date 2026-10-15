import { describe, expect, it } from 'vitest';
import { AppController, CODE_NO_PATH, errorCode, readArchive } from '../src/index.js';
import { minimalXmind } from './helpers.js';

describe('open senza percorso', () => {
  it('il workbook non ha percorso né default relativo al CWD', async () => {
    const c = new AppController();
    const dto = await c.open(await minimalXmind());
    expect(dto.path).toBeNull();
    expect(dto.fileName).toBe('workbook.xmind');
    expect(c.workbook()!.path).toBeNull();
  });

  it('con fileName senza percorso mantiene il nome e path null', async () => {
    const c = new AppController();
    const dto = await c.open(await minimalXmind(), undefined, 'mappa.xmind');
    expect(dto.path).toBeNull();
    expect(dto.fileName).toBe('mappa.xmind');
  });

  it('con percorso deriva il nome dal percorso', async () => {
    const c = new AppController();
    const dto = await c.open(await minimalXmind(), '/tmp/x/mia.xmind');
    expect(dto.path).toBe('/tmp/x/mia.xmind');
    expect(dto.fileName).toBe('mia.xmind');
  });

  it('save() senza percorso fallisce con no_path e non scrive nel CWD', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    let code: string | undefined;
    try {
      await c.save(true, true);
    } catch (err) {
      code = errorCode(err);
    }
    expect(code).toBe(CODE_NO_PATH);
  });
});

describe('importOutline', () => {
  const md = '# Importato\n\n- uno\n- due\n';

  it('con opzioni vuote aggiunge un nuovo foglio', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const dto = await c.importOutline('markdown', md, {});
    expect(dto.sheets).toHaveLength(2);
    expect(dto.sheets[0].topics[0].title).toBe('Radice');
  });

  it('senza opzioni aggiunge un nuovo foglio', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const dto = await c.importOutline('markdown', md);
    expect(dto.sheets).toHaveLength(2);
  });

  it('asNewSheet=false aggancia alla radice del primo foglio', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const dto = await c.importOutline('markdown', md, { asNewSheet: false });
    expect(dto.sheets).toHaveLength(1);
    expect(dto.sheets[0].topics.length).toBeGreaterThan(2);
  });

  it('se il primo foglio non ha radice non lo sovrascrive: aggiunge un foglio', async () => {
    const c = new AppController();
    await c.open(await minimalXmind([{ id: 'vuoto', class: 'sheet', title: 'Vuoto' }]));
    const dto = await c.importOutline('markdown', md, { asNewSheet: false });
    expect(dto.sheets).toHaveLength(2);
    expect(dto.sheets[0].title).toBe('Vuoto');
  });
});

describe('prepareArchiveBytes non muta il workbook vivo', () => {
  const sha = 'a'.repeat(64);

  function live(c: AppController) {
    return (c as unknown as {
      currentWorkbook: {
        archive: { entries: Map<string, Uint8Array>; resources: Map<string, Uint8Array> };
        manifest: Record<string, unknown>;
        content: any[];
      };
    }).currentWorkbook;
  }

  it('un prepare riuscito lascia archivio e manifest invariati', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const wb = live(c);
    wb.archive.entries.set('Thumbnails/thumbnail.png', new Uint8Array([1, 2, 3]));
    wb.archive.resources.set(`resources/${sha}.png`, new Uint8Array([9]));
    const entryKeys = [...wb.archive.entries.keys()];
    const manifestBefore = JSON.stringify(wb.manifest);
    const contentBefore = wb.archive.entries.get('content.json');

    const { bytes } = await c.prepareArchiveBytes();

    expect([...wb.archive.entries.keys()]).toEqual(entryKeys);
    expect(wb.archive.entries.has('Thumbnails/thumbnail.png')).toBe(true);
    expect(wb.archive.entries.get('content.json')).toBe(contentBefore);
    expect(JSON.stringify(wb.manifest)).toBe(manifestBefore);

    // L'output però è pulito: niente thumbnail, risorsa registrata nel manifest.
    const out = await readArchive(bytes);
    expect(out.entries.has('Thumbnails/thumbnail.png')).toBe(false);
    const outManifest = JSON.parse(new TextDecoder().decode(out.entries.get('manifest.json')!));
    expect(Object.keys(outManifest['file-entries'])).toContain(`resources/${sha}.png`);
  });

  it('una validazione fallita lascia archivio e manifest invariati', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const wb = live(c);
    wb.archive.entries.set('Thumbnails/thumbnail.png', new Uint8Array([1, 2, 3]));
    wb.archive.resources.set(`resources/${sha}.png`, new Uint8Array([9]));
    wb.content[0].rootTopic.image = { src: 'xap:resources/mancante.png' };
    const entryKeys = [...wb.archive.entries.keys()];
    const resourceKeys = [...wb.archive.resources.keys()];
    const contentBefore = wb.archive.entries.get('content.json');
    const manifestBefore = JSON.stringify(wb.manifest);

    await expect(c.prepareArchiveBytes()).rejects.toThrow(/senza risorsa/);

    expect([...wb.archive.entries.keys()]).toEqual(entryKeys);
    expect([...wb.archive.resources.keys()]).toEqual(resourceKeys);
    expect(wb.archive.entries.get('content.json')).toBe(contentBefore);
    expect(JSON.stringify(wb.manifest)).toBe(manifestBefore);
  });
});
