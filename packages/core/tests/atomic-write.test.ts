import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Simula Windows: fsync su un descrittore aperto in sola lettura fallisce con EPERM
// (FlushFileBuffers richiede un handle con accesso in scrittura).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readOnly = new Set<number>();
  const openSync = (file: import('node:fs').PathLike, flags?: import('node:fs').OpenMode, mode?: import('node:fs').Mode | null) => {
    const fd = actual.openSync(file, flags, mode);
    if (flags === undefined || flags === 'r' || flags === 'rs') readOnly.add(fd);
    else readOnly.delete(fd);
    return fd;
  };
  const closeSync = (fd: number) => {
    readOnly.delete(fd);
    actual.closeSync(fd);
  };
  const fsyncSync = (fd: number) => {
    if (readOnly.has(fd)) {
      throw Object.assign(new Error('EPERM: operation not permitted, fsync'), { code: 'EPERM' });
    }
    actual.fsyncSync(fd);
  };
  const patched = { ...actual, openSync, closeSync, fsyncSync };
  return { ...patched, default: patched };
});

const { atomicWrite } = await import('../src/node/index.js');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('atomicWrite con fsync in stile Windows', () => {
  it('sovrascrive un file esistente creando il backup senza EPERM', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'xmap-atomic-'));
    dirs.push(dir);
    const target = path.join(dir, 'mappa.xmind');
    writeFileSync(target, new Uint8Array([1, 2, 3]));

    const report = await atomicWrite(target, new Uint8Array([4, 5, 6]), { makeBackup: true });

    expect([...readFileSync(target)]).toEqual([4, 5, 6]);
    expect(report.backup).toBeDefined();
    expect(report.backup !== undefined && existsSync(report.backup)).toBe(true);
    expect([...readFileSync(report.backup ?? '')]).toEqual([1, 2, 3]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
