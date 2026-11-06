import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from '../src/node/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(): { target: string; backupDir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmap-backups-'));
  dirs.push(dir);
  const backupDir = path.join(dir, '.xmap-studio', 'backups');
  mkdirSync(backupDir, { recursive: true });
  const target = path.join(dir, 'mappa.xmind');
  writeFileSync(target, new Uint8Array([1]));
  return { target, backupDir };
}

describe('pruneBackups', () => {
  it('ordina per timestamp nel nome, non per mtime', async () => {
    const { target, backupDir } = setup();
    // Backup vecchi (2020) con mtime recentissimo, come dopo copyFileSync su macOS/Windows.
    const future = new Date(Date.now() + 3600_000);
    const old = ['20200101-000000', '20200102-000000', '20200103-000000', '20200104-000000', '20200105-000000'];
    for (const ts of old) {
      const file = path.join(backupDir, `mappa.backup.${ts}.xmind`);
      writeFileSync(file, new Uint8Array([0]));
      utimesSync(file, future, future);
    }

    const report = await atomicWrite(target, new Uint8Array([2]));
    const left = readdirSync(backupDir).sort();
    expect(left).toHaveLength(5);
    expect(left).not.toContain('mappa.backup.20200101-000000.xmind');
    expect(report.backup && path.basename(report.backup)).toBeDefined();
    expect(left).toContain(path.basename(report.backup ?? ''));
  });

  it('il contatore di collisione nello stesso secondo conta dopo il timestamp', async () => {
    const { target, backupDir } = setup();
    for (const name of ['20200101-000000-2', '20200101-000000', '20200101-000000-1', '20200102-000000', '20200103-000000']) {
      writeFileSync(path.join(backupDir, `mappa.backup.${name}.xmind`), new Uint8Array([0]));
    }
    await atomicWrite(target, new Uint8Array([2]));
    const left = readdirSync(backupDir);
    expect(left).not.toContain('mappa.backup.20200101-000000.xmind');
    expect(left).toContain('mappa.backup.20200101-000000-1.xmind');
    expect(left).toContain('mappa.backup.20200101-000000-2.xmind');
  });

  it("non tocca i backup di un altro file chiamato 'mappa.backup.X'", async () => {
    const { target, backupDir } = setup();
    const others = [1, 2, 3, 4, 5, 6].map((d) => `mappa.backup.X.backup.2020010${d}-000000.xmind`);
    for (const name of [...others, 'mappa.backup.manuale.xmind']) {
      writeFileSync(path.join(backupDir, name), new Uint8Array([0]));
    }
    await atomicWrite(target, new Uint8Array([2]));
    const left = readdirSync(backupDir);
    for (const name of [...others, 'mappa.backup.manuale.xmind']) expect(left).toContain(name);
    expect(left).toHaveLength(others.length + 2);
  });
});
