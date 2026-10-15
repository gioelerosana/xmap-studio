import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppController,
  atomicWrite,
  buildArchiveBytes,
  RawArchive,
  readArchive,
  sha256HexAsync,
  validateArchiveBytes,
} from '../src/index.js';

const tempDirs: string[] = [];

function makeArchive(
  sheets: unknown[],
  options: {
    resources?: Record<string, number[]>;
    attachments?: Record<string, number[]>;
  } = {}
): Promise<Uint8Array> {
  const fileEntries: Record<string, object> = {
    'content.json': {},
    'metadata.json': {},
  };
  const resources = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(options.resources ?? {})) {
    const key = `resources/${name}`;
    resources.set(key, new Uint8Array(bytes));
    fileEntries[key] = {};
  }

  const entries = new Map<string, Uint8Array>();
  entries.set('content.json', new TextEncoder().encode(JSON.stringify(sheets)));
  entries.set('metadata.json', new TextEncoder().encode('{"dataStructureVersion":"3"}'));
  for (const [name, bytes] of Object.entries(options.attachments ?? {})) {
    const key = `attachments/${name}`;
    entries.set(key, new Uint8Array(bytes));
    fileEntries[key] = {};
  }
  entries.set('manifest.json', new TextEncoder().encode(JSON.stringify({ 'file-entries': fileEntries })));

  const archive: RawArchive = { entries, resources };
  return buildArchiveBytes(archive);
}

async function openFixture(bytes: Uint8Array): Promise<AppController> {
  const controller = new AppController();
  await controller.open(bytes, '/tmp/migration-fixture.xmind', 'migration-fixture.xmind');
  return controller;
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmap-migration-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parità della migrazione Rust → TypeScript', () => {
  it('registra gli allegati nel manifest e valida il round-trip', async () => {
    const input = await makeArchive([
      { id: 'sheet-1', rootTopic: { id: 'root', title: 'Root', children: { attached: [{ id: 'child', title: '' }] } } },
    ]);
    const controller = await openFixture(input);
    controller.attachFileToTopic('child', 'algebra.pdf', new Uint8Array([1, 2, 3]));

    const { bytes, validation } = await controller.prepareArchiveBytes();
    expect(validation.entries).toBeGreaterThan(0);
    await expect(validateArchiveBytes(bytes)).resolves.toMatchObject({ entries: validation.entries });

    const archive = await readArchive(bytes);
    const content = JSON.parse(new TextDecoder().decode(archive.entries.get('content.json')!));
    const manifest = JSON.parse(new TextDecoder().decode(archive.entries.get('manifest.json')!));
    const href = content[0].rootTopic.children.attached[0].href as string;
    const key = href.slice('xap:'.length);
    expect(href).toMatch(/^xap:attachments\/[0-9a-f-]+\.bin$/);
    expect(archive.entries.has(key)).toBe(true);
    expect(manifest['file-entries'][key]).toEqual({});
    expect(content[0].rootTopic.children.attached[0].title).toBe('algebra.pdf');
  });

  it('durante il merge conserva gli allegati e risolve le collisioni di percorso', async () => {
    const target = await makeArchive(
      [{ id: 'same-sheet', rootTopic: { id: 'same-root', title: 'Target' } }],
      { attachments: { 'shared.bin': [9, 9] } }
    );
    const source = await makeArchive(
      [{
        id: 'same-sheet',
        rootTopic: {
          id: 'same-root',
          title: 'Source',
          href: 'xap:attachments/shared.bin',
          children: { attached: [{ id: 'source-child', title: 'Child', href: 'xmind:#same-root' }] },
        },
      }],
      { attachments: { 'shared.bin': [1, 2, 3] } }
    );
    const controller = await openFixture(target);

    await controller.mergeWorkbook(source);
    const { bytes } = await controller.prepareArchiveBytes();
    const merged = await readArchive(bytes);
    const content = JSON.parse(new TextDecoder().decode(merged.entries.get('content.json')!));
    const addedRoot = content[1].rootTopic;
    const attachmentPath = addedRoot.href.slice('xap:'.length);

    expect(addedRoot.id).not.toBe('same-root');
    expect(attachmentPath).not.toBe('attachments/shared.bin');
    expect(Array.from(merged.entries.get(attachmentPath)!)).toEqual([1, 2, 3]);
    expect(addedRoot.children.attached[0].href).toBe(`xmind:#${addedRoot.id}`);
    await expect(validateArchiveBytes(bytes)).resolves.toBeDefined();
  });

  it('esporta un sottoalbero con id rimappati, risorse e allegati validati', async () => {
    const input = await makeArchive(
      [{
        id: 'sheet-1',
        rootTopic: {
          id: 'root',
          title: 'Root',
          children: {
            attached: [{
              id: 'branch',
              title: 'Branch',
              image: { src: 'xap:resources/diagram.png' },
              href: 'xap:attachments/notes.bin',
              children: { attached: [{ id: 'inside', title: 'Inside', href: 'xmind:#branch' }] },
            }],
          },
        },
      }],
      { resources: { 'diagram.png': [7, 8] }, attachments: { 'notes.bin': [4, 5] } }
    );
    const controller = await openFixture(input);

    const bytes = await controller.splitTopic('branch');
    const archive = await readArchive(bytes);
    const content = JSON.parse(new TextDecoder().decode(archive.entries.get('content.json')!));
    const root = content[0].rootTopic;
    const manifest = JSON.parse(new TextDecoder().decode(archive.entries.get('manifest.json')!));

    expect(root.id).not.toBe('branch');
    expect(root.children.attached[0].href).toBe(`xmind:#${root.id}`);
    expect(archive.resources.has('resources/diagram.png')).toBe(true);
    expect(archive.entries.has('attachments/notes.bin')).toBe(true);
    expect(manifest['file-entries']['attachments/notes.bin']).toEqual({});
    await expect(validateArchiveBytes(bytes)).resolves.toBeDefined();
  });

  it('rifiuta relazioni tra fogli e marker nuovi fuori catalogo', async () => {
    const bytes = await makeArchive([
      { id: 'sheet-1', rootTopic: { id: 'root-1', title: 'Uno', children: { attached: [{ id: 'topic-1', title: 'Topic', markers: [{ markerId: 'future-marker' }] }] } } },
      { id: 'sheet-2', rootTopic: { id: 'root-2', title: 'Due' } },
    ]);
    const controller = await openFixture(bytes);

    expect(() => controller.addTopicRelationship('topic-1', 'root-2')).toThrow(/stesso foglio/);
    expect(() => controller.toggleTopicMarker('topic-1', 'unknown-marker')).toThrow(/sconosciuto/);
    controller.toggleTopicMarker('topic-1', 'future-marker');
    expect(controller.workbook()!.sheets[0].topics.find((topic) => topic.id === 'topic-1')!.markers).toEqual([]);
    expect(controller.isDirty()).toBe(true);
  });

  it('mantiene gli extra di task e stile e aggiorna boundary, summary e link', async () => {
    const bytes = await makeArchive([
      {
        id: 'sheet-1',
        rootTopic: {
          id: 'root',
          title: 'Root',
          style: { properties: { 'line-color': '#123456' } },
          extensions: [{ provider: 'org.xmind.ui.task', content: { priority: 2, dependencies: ['keep-me'] } }],
          children: { attached: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }] },
        },
      },
    ]);
    const controller = await openFixture(bytes);

    controller.setTopicNotes('root', 'riga 1\n<riga 2>');
    controller.setTopicNotesDisplay('root', 'block');
    controller.setTopicLabels('root', [' tag ', 'tag', 'second']);
    controller.setTopicHref('root', '#one');
    controller.setTopicTask('root', { priority: 4, progress: 50 });
    controller.setTopicColor('root', '#abcdef');
    controller.addTopicBoundary('root');
    controller.addTopicSummary('root');

    const { bytes: output } = await controller.prepareArchiveBytes();
    const archive = await readArchive(output);
    const content = JSON.parse(new TextDecoder().decode(archive.entries.get('content.json')!));
    const root = content[0].rootTopic;

    expect(root.notes.plain.content).toBe('riga 1\n<riga 2>');
    expect(root.notes.realHTML.content).toContain('&lt;riga 2&gt;');
    expect(root.notesDisplay).toBe('block');
    expect(root.labels).toEqual(['tag', 'second']);
    expect(root.href).toBe('xmind:#one');
    expect(root.extensions[0].content.dependencies).toEqual(['keep-me']);
    expect(root.extensions[0].content.priority).toBe(4);
    expect(root.style.properties['line-color']).toBe('#123456');
    expect(root.style.properties['svg:fill']).toBe('#abcdef');
    expect(root.boundaries[0].range).toBe('(0,1)');
    expect(root.children.summary).toHaveLength(1);
    expect(root.summaries[0].topicId).toBe(root.children.summary[0].id);
  });

  it('importa Markdown come nuovo foglio e crea topic persistenti', async () => {
    const bytes = await makeArchive([{ id: 'sheet-1', rootTopic: { id: 'root', title: 'Root' } }]);
    const controller = await openFixture(bytes);

    const dto = await controller.importOutline('markdown', '# Imported\n\n- Child\n  - Detail');
    expect(dto.sheets).toHaveLength(2);
    expect(dto.sheets[1].topics.map((topic) => topic.title)).toEqual(['Imported', 'Child', 'Detail']);
    expect(controller.isDirty()).toBe(true);
  });

  it('applica un batch di equazioni tutto o niente', async () => {
    const bytes = await makeArchive([
      { id: 'sheet-1', rootTopic: { id: 'root', title: 'Root', children: { attached: [{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }] } } },
    ]);
    const controller = await openFixture(bytes);

    const result = await controller.applyBatch([
      { topicId: 'first', latex: 'x^2', titleMode: { kind: 'keep_title' } },
      { topicId: 'second', latex: '' },
    ]);

    expect(result.modified).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(controller.isDirty()).toBe(false);
    expect(controller.workbook()!.sheets[0].topics.every((topic) => topic.kind !== 'equation')).toBe(true);
    await expect(controller.applyBatch([])).rejects.toThrow(/Nessuna equazione/);
  });

  it('blocca una scrittura atomica se il file è cambiato dall’apertura', async () => {
    const dir = makeTempDir();
    const target = path.join(dir, 'map.xmind');
    const original = new Uint8Array([1, 2, 3]);
    writeFileSync(target, original);
    const expectedHash = await sha256HexAsync(original);
    writeFileSync(target, new Uint8Array([9, 8, 7]));

    await expect(atomicWrite(target, new Uint8Array([4, 5, 6]), true, expectedHash)).rejects.toThrow(/cambiato su disco/);
    expect(Array.from(readFileSync(target))).toEqual([9, 8, 7]);
  });

  it('non dichiara salvato un workbook se manca un adapter di filesystem', async () => {
    const bytes = await makeArchive([{ id: 'sheet-1', rootTopic: { id: 'root', title: 'Root' } }]);
    const controller = await openFixture(bytes);
    controller.setTopicTitle('root', 'Modified');

    await expect(controller.save()).rejects.toThrow(/adapter di filesystem/);
    expect(controller.isDirty()).toBe(true);
  });
});
