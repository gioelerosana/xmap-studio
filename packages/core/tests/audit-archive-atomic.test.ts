import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from '../src/node/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmap-audit-atomic-'));
  dirs.push(dir);
  return dir;
}

const posix = process.platform !== 'win32';

describe('atomicWrite: permessi e collegamenti', () => {
  it.skipIf(!posix)('conserva i permessi del file sovrascritto', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'privata.xmind');
    writeFileSync(target, new Uint8Array([1]));
    chmodSync(target, 0o600);

    await atomicWrite(target, new Uint8Array([2]), { makeBackup: false });

    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect([...readFileSync(target)]).toEqual([2]);
  });

  it.skipIf(!posix)('salvando su un collegamento simbolico aggiorna il file vero e lascia il link', async () => {
    const dir = tempDir();
    const realDir = path.join(dir, 'sync');
    mkdirSync(realDir);
    const real = path.join(realDir, 'mappa.xmind');
    writeFileSync(real, new Uint8Array([1]));
    const link = path.join(dir, 'link.xmind');
    symlinkSync(real, link);

    const report = await atomicWrite(link, new Uint8Array([9]), { makeBackup: true });

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect([...readFileSync(real)]).toEqual([9]);
    expect(report.backup?.startsWith(path.join(realDir, '.xmap-studio'))).toBe(true);
  });
});
