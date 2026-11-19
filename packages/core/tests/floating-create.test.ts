import { describe, expect, it } from 'vitest';
import {
  AppController,
  CODE_INVALID_INPUT,
  CODE_TOPIC_NOT_FOUND,
  errorCode,
  readArchive,
  sha256Hex,
  validateArchiveBytes,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);

async function entryJson(bytes: Uint8Array, name: string) {
  const archive = await readArchive(bytes);
  const raw = archive.entries.get(name);
  if (!raw) throw new Error(`${name} assente`);
  return JSON.parse(new TextDecoder().decode(raw));
}

async function rootJson(c: AppController) {
  const { bytes } = await c.prepareArchiveBytes();
  return (await entryJson(bytes, 'content.json'))[0].rootTopic;
}

describe('creazione di blocchi liberi', () => {
  it('addFloatingTopic aggiunge un blocco detached alla radice con position intera', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const { dto, newId } = c.addFloatingTopic('r', { x: 120.4, y: -80.6 }, 'Libero');
    const view = dto.sheets[0].topics.find((t) => t.id === newId);
    expect(view?.group).toBe('detached');
    expect(view?.title).toBe('Libero');

    const root = await rootJson(c);
    const free = root.children.detached.find((t: { id: string }) => t.id === newId);
    expect(free.position).toEqual({ x: 120, y: -81 });
    c.undo();
    expect(c.workbook()?.sheets[0].topics.some((t) => t.id === newId)).toBe(false);
  });

  it('addFloatingImageTopic crea un\'immagine libera con risorsa nel manifest e archivio valido', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const { dto, newId } = c.addFloatingImageTopic('r', { x: -200, y: 50 }, fakePng, 'image/png', {
      width: 800,
      height: 400,
    });
    const view = dto.sheets[0].topics.find((t) => t.id === newId);
    expect(view?.group).toBe('detached');
    expect(view?.kind).toBe('image');
    expect(view?.imageW).toBe(400);
    expect(view?.imageH).toBe(200);

    const resource = `resources/${sha256Hex(fakePng)}.png`;
    expect(c.resourceBytes(`xap:${resource}`)).toEqual(fakePng);

    const { bytes } = await c.prepareArchiveBytes();
    await validateArchiveBytes(bytes);
    const manifest = await entryJson(bytes, 'manifest.json');
    expect(Object.keys(manifest['file-entries'])).toContain(resource);

    const root = await rootJson(c);
    const free = root.children.detached.find((t: { id: string }) => t.id === newId);
    expect(free.position).toEqual({ x: -200, y: 50 });
    expect(free.image.src).toBe(`xap:${resource}`);
  });

  it('un blocco libero si collega con una relazione', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const { newId } = c.addFloatingImageTopic('r', { x: 0, y: 300 }, fakePng, 'image/png', { width: 10, height: 10 });
    const dto = c.addTopicRelationship('r', newId);
    expect(dto.sheets[0].relationships.some((r) => r.end1Id === 'r' && r.end2Id === newId)).toBe(true);
  });

  it('rifiuta ancore inesistenti e posizioni non finite senza modificare il documento', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    try {
      c.addFloatingTopic('nope', { x: 0, y: 0 }, '');
      expect.unreachable();
    } catch (e) {
      expect(errorCode(e)).toBe(CODE_TOPIC_NOT_FOUND);
    }
    try {
      c.addFloatingImageTopic('r', { x: NaN, y: 0 }, fakePng, 'image/png', { width: 1, height: 1 });
      expect.unreachable();
    } catch (e) {
      expect(errorCode(e)).toBe(CODE_INVALID_INPUT);
    }
    expect(c.isDirty()).toBe(false);
    expect(c.resourceBytes(`xap:resources/${sha256Hex(fakePng)}.png`)).toBeNull();
  });
});
