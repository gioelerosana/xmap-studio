import { CODE_FORMAT, XmapError } from '../errors.js';
import type JSZip from 'jszip';
import { loadJSZip } from './zip.js';
import { Entries, RawArchive, Resources } from './types.js';

/**
 * SHA-256 esadecimale, sincrono e identico su ogni piattaforma: serve dove
 * l'hash è parte del formato (nome della risorsa PNG, regola MathJax).
 */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return pureSha256(bytes);
}

/**
 * SHA-256 asincrono: usa WebCrypto (browser, Electron e Node ≥ 18) per i
 * buffer grandi come l'intero archivio, con ricaduta sull'implementazione pura.
 */
export async function sha256HexAsync(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;

  if (globalThis.crypto?.subtle) {
    // Copia in un ArrayBuffer proprio: la vista può puntare a un buffer condiviso più grande.
    const digestBytes = new Uint8Array(bytes.length);
    digestBytes.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', digestBytes.buffer);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return pureSha256(bytes);
}

/** Costanti di SHA-256 (FIPS 180-4 §4.2.2). */
const SHA256_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** Valori iniziali di SHA-256 (FIPS 180-4 §5.3.3). */
const SHA256_H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/**
 * SHA-256 in JS puro, a blocchi di 64 byte su array tipizzati: nessuna copia
 * dell'input in un array di parole, così un'immagine di molti MB si fa in
 * decine di ms invece che in centinaia (il calcolo è sincrono, sul thread della UI).
 */
function pureSha256(bytes: Uint8Array): string {
  const H = Int32Array.from(SHA256_H0);
  const w = new Int32Array(64);
  const len = bytes.length;
  // Coda: i byte dell'ultimo blocco incompleto, il bit 1 e la lunghezza in bit (64 bit big-endian).
  const tailStart = len - (len % 64);
  const tailLen = len - tailStart + 9 <= 64 ? 64 : 128;
  const tail = new Uint8Array(tailLen);
  tail.set(bytes.subarray(tailStart));
  tail[len - tailStart] = 0x80;
  const bitsHi = Math.floor(len / 0x20000000);
  const bitsLo = (len * 8) >>> 0;
  const tailView = new DataView(tail.buffer);
  tailView.setUint32(tailLen - 8, bitsHi);
  tailView.setUint32(tailLen - 4, bitsLo);

  const compress = (src: Uint8Array, off: number): void => {
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      w[i] = (src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const gamma0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const gamma1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + gamma0 + w[i - 7] + gamma1) | 0;
    }
    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  };

  for (let off = 0; off < tailStart; off += 64) compress(bytes, off);
  for (let off = 0; off < tailLen; off += 64) compress(tail, off);

  let result = '';
  for (let i = 0; i < 8; i++) result += (H[i] >>> 0).toString(16).padStart(8, '0');
  return result;
}

/**
 * Legge l'archivio ZIP .xmind e separa le risorse dalle altre entry.
 * Genera errore se content.json non è presente (formato legacy XMind 8 non supportato).
 */
export async function readArchive(data: ArrayBuffer | Uint8Array): Promise<RawArchive> {
  // checkCRC32: un archivio corrotto deve fallire qui, non produrre byte sbagliati.
  const JSZipLib = await loadJSZip();
  let zip: JSZip;
  try {
    zip = await JSZipLib.loadAsync(data, { checkCRC32: true });
  } catch (err) {
    throw new XmapError(CODE_FORMAT, `Il file non è un archivio ZIP valido: ${err}`);
  }
  const entries: Entries = new Map();
  const resources: Resources = new Map();

  const filePromises: Promise<void>[] = [];

  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    filePromises.push(
      file.async('uint8array').then((bytes) => {
        if (relativePath.startsWith('resources/') && !relativePath.endsWith('/')) {
          resources.set(relativePath, bytes);
        } else {
          entries.set(relativePath, bytes);
        }
      })
    );
  });

  await Promise.all(filePromises);

  if (!entries.has('content.json')) {
    throw new XmapError(CODE_FORMAT, 'content.json assente: formato legacy XMind 8 non supportato');
  }

  return { entries, resources };
}

/**
 * Ricostruisce i byte dello ZIP ordinando prima le entry non-risorsa e poi le risorse.
 */
export async function buildArchiveBytes(archive: RawArchive): Promise<Uint8Array> {
  const JSZipLib = await loadJSZip();
  const zip = new JSZipLib();

  // Prima le entry non-risorsa (come content.json, manifest.json, metadata.json)
  for (const [name, data] of archive.entries) {
    zip.file(name, data);
  }

  // Poi le risorse (PNG, equazioni, allegati)
  for (const [name, data] of archive.resources) {
    zip.file(name, data);
  }

  return await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
