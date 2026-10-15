import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readArchive, sha256Hex, sha256HexAsync, validateArchiveBytes } from '../src/index.js';

const PAYLOAD = 'PAYLOAD-0123456789-PAYLOAD';

/** Archivio non compresso con una risorsa di cui alteriamo un byte dopo il CRC. */
async function corruptedArchive(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('content.json', '[]');
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'resources/a.png': {} } }));
  zip.file('resources/a.png', PAYLOAD);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const marker = new TextEncoder().encode(PAYLOAD);
  for (let i = 0; i + marker.length <= bytes.length; i++) {
    if (marker.every((b, j) => bytes[i + j] === b)) {
      bytes[i + 5] ^= 0xff;
      return bytes;
    }
  }
  throw new Error('payload non trovato');
}

describe('integrità dello ZIP', () => {
  it('readArchive rifiuta un archivio con CRC errato', async () => {
    await expect(readArchive(await corruptedArchive())).rejects.toThrow(/crc32/i);
  });

  it('validateArchiveBytes rifiuta un archivio con CRC errato', async () => {
    await expect(validateArchiveBytes(await corruptedArchive())).rejects.toThrow(/crc32/i);
  });
});

describe('sha256', () => {
  it('sync e async coincidono con i vettori noti', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex('abc')).toBe(abc);
    expect(await sha256HexAsync('abc')).toBe(abc);
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(sha256Hex(big)).toBe(await sha256HexAsync(big));
  });

  it('async considera solo la vista, non il buffer sottostante', async () => {
    const backing = new TextEncoder().encode('xxabcxx');
    expect(await sha256HexAsync(backing.subarray(2, 5))).toBe(sha256Hex('abc'));
  });
});
