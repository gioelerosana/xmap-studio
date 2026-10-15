import { describe, expect, it } from 'vitest';
import { CODE_CONFLICT, CODE_VALIDATION, XmapError } from '../src/index.js';
import { guardedSave } from '../src/node/index.js';
import type { GuardedSaveDeps } from '../src/node/index.js';

function deps(overrides: Partial<GuardedSaveDeps> = {}) {
  const calls: string[] = [];
  const d: GuardedSaveDeps = {
    xmindProcesses: async () => {
      calls.push('processes');
      return [];
    },
    validate: async () => {
      calls.push('validate');
    },
    atomicWrite: async (_path, bytes) => {
      calls.push('write');
      return { backup: '/b/x.xmind', bytesWritten: bytes.length };
    },
    ...overrides,
  };
  return { d, calls };
}

const bytes = new Uint8Array([1, 2, 3]);

describe('guardedSave', () => {
  it('con XMind chiuso valida e scrive', async () => {
    const { d, calls } = deps();
    const res = await guardedSave('/x.xmind', bytes, {}, d);
    expect(res).toEqual({ ok: true, backup: '/b/x.xmind', bytes: 3 });
    expect(calls).toEqual(['processes', 'validate', 'write']);
  });

  it('con XMind aperto rifiuta e non scrive', async () => {
    const { d, calls } = deps({ xmindProcesses: async () => ['7: xmind'] });
    const res = await guardedSave('/x.xmind', bytes, { force: false }, d);
    expect(res).toMatchObject({ ok: false, code: 'xmind_running', processes: ['7: xmind'] });
    expect(calls).toEqual([]);
  });

  it('solo force === true scavalca il blocco, senza nemmeno interrogare i processi', async () => {
    const processes = async () => ['7: xmind'];
    const forced = deps({ xmindProcesses: processes });
    expect(await guardedSave('/x.xmind', bytes, { force: true }, forced.d)).toMatchObject({ ok: true });
    expect(forced.calls).toEqual(['validate', 'write']);

    const truthy = deps({ xmindProcesses: processes });
    const res = await guardedSave('/x.xmind', bytes, { force: 1 as unknown as boolean }, truthy.d);
    expect(res).toMatchObject({ ok: false, code: 'xmind_running' });
  });

  it('un errore di validazione non arriva alla scrittura e conserva il codice', async () => {
    const { d, calls } = deps({
      validate: async () => {
        throw new XmapError(CODE_VALIDATION, 'zip rotto');
      },
    });
    const res = await guardedSave('/x.xmind', bytes, {}, d);
    expect(res).toEqual({ ok: false, code: 'validation', message: 'zip rotto' });
    expect(calls).not.toContain('write');
  });

  it('inoltra expectedHash e riporta il conflitto', async () => {
    let seen: string | undefined;
    const { d } = deps({
      atomicWrite: async (_p, _b, options) => {
        seen = options.expectedHash;
        throw new XmapError(CODE_CONFLICT, 'cambiato');
      },
    });
    const res = await guardedSave('/x.xmind', bytes, { expectedHash: 'abc' }, d);
    expect(seen).toBe('abc');
    expect(res).toEqual({ ok: false, code: 'conflict', message: 'cambiato' });
  });

  it('errori sconosciuti diventano io', async () => {
    const { d } = deps({
      atomicWrite: async () => {
        throw new Error('disco pieno');
      },
    });
    expect(await guardedSave('/x.xmind', bytes, {}, d)).toEqual({
      ok: false,
      code: 'io',
      message: 'disco pieno',
    });
  });
});
