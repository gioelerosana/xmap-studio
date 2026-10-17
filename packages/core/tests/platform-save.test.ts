import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppController, CODE_CONFLICT, CODE_XMIND_RUNNING, errorCode } from '../src/index.js';
import type { Platform } from '../src/index.js';
import { nodePlatform } from '../src/node/index.js';
import { minimalXmind } from './helpers.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmap-platform-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function backupsOf(dir: string): string[] {
  const backupDir = path.join(dir, '.xmap-studio', 'backups');
  return existsSync(backupDir) ? readdirSync(backupDir) : [];
}

// Disco reale ma nessun XMind: il test non deve dipendere da un XMind aperto sulla macchina.
const diskOnly: Platform = { ...nodePlatform, xmindProcesses: async () => [] };

describe('save() con nodePlatform', () => {
  it('scrive in modo atomico e crea un backup dal secondo salvataggio', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'mappa.xmind');
    writeFileSync(target, await minimalXmind());

    const c = new AppController(diskOnly);
    await c.openPath(target);
    expect(c.workbook()!.path).toBe(target);

    c.setTopicTitle('a', 'Primo');
    const first = await c.save();
    expect(first.path).toBe(target);
    // Il file esisteva già (l'originale): il backup c'è già al primo salvataggio.
    expect(first.backup).toBeDefined();
    expect(c.isDirty()).toBe(false);

    c.setTopicTitle('a', 'Secondo');
    const second = await c.save();
    expect(second.backup).toBeDefined();
    expect(backupsOf(dir).length).toBe(2);

    // Nessun temporaneo residuo e il file riletto contiene l'ultima modifica.
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    const reopened = new AppController(diskOnly);
    await reopened.openPath(target);
    expect(reopened.workbook()!.sheets[0].topics.find((t) => t.id === 'a')!.title).toBe('Secondo');
  });

  it('saveAs scrive su un nuovo file senza controllo di conflitto', async () => {
    const dir = tempDir();
    const c = new AppController(diskOnly);
    await c.open(await minimalXmind(), undefined, 'nuova.xmind');
    c.setTopicTitle('a', 'X');
    const target = path.join(dir, 'nuova.xmind');
    const res = await c.saveAs(target);
    expect(res.backup).toBeUndefined();
    expect(c.workbook()!.path).toBe(target);
    expect(readFileSync(target).length).toBeGreaterThan(0);
  });

  it('segnala il conflitto se il file è cambiato su disco', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'mappa.xmind');
    writeFileSync(target, await minimalXmind());
    const c = new AppController(diskOnly);
    await c.openPath(target);
    writeFileSync(target, new Uint8Array([1, 2, 3]));
    c.setTopicTitle('a', 'X');
    let code: string | undefined;
    try {
      await c.save();
    } catch (err) {
      code = errorCode(err);
    }
    expect(code).toBe(CODE_CONFLICT);
    expect(Array.from(readFileSync(target))).toEqual([1, 2, 3]);
  });

  it('è bloccato se XMind è in esecuzione, e riesce con force', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'mappa.xmind');
    const original = await minimalXmind();
    writeFileSync(target, original);

    const running: Platform = { ...nodePlatform, xmindProcesses: async () => ['4242: /opt/xmind'] };
    const c = new AppController(running);
    const dto = await c.openPath(target);
    expect(dto.xmindRunning).toEqual(['4242: /opt/xmind']);

    c.setTopicTitle('a', 'Forzato');
    let caught: unknown;
    try {
      await c.save();
    } catch (err) {
      caught = err;
    }
    expect(errorCode(caught)).toBe(CODE_XMIND_RUNNING);
    expect((caught as { details: unknown }).details).toEqual({ processes: ['4242: /opt/xmind'] });
    expect(Array.from(readFileSync(target))).toEqual(Array.from(original));
    expect(c.isDirty()).toBe(true);

    const res = await c.save(true);
    expect(res.path).toBe(target);
    expect(c.isDirty()).toBe(false);
    expect(Array.from(readFileSync(target))).not.toEqual(Array.from(original));
  });
});
