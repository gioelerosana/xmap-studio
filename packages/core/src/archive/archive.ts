import { CODE_FORMAT, XmapError } from '../errors.js';
import JSZip from 'jszip';
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

function pureSha256(bytes: Uint8Array): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const words: number[] = [];
  const asciiBitLength = bytes.length * 8;

  const K: number[] = [];
  const H: number[] = [];

  let isComposite: Record<number, boolean> = {};
  for (let candidate = 2, primeCounter = 0; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = candidate * candidate; i < 312; i += candidate) {
        isComposite[i] = true;
      }
      if (primeCounter < 8) {
        H[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      }
      K[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
  }

  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << ((3 - (i % 4)) * 8);
  }

  words[bytes.length >> 2] |= 0x80 << ((3 - (bytes.length % 4)) * 8);
  words[(((bytes.length + 8) >> 6) << 4) + 15] = asciiBitLength;

  const w: number[] = new Array(64);
  for (let j = 0; j < words.length; j += 16) {
    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];

    for (let i = 0; i < 64; i++) {
      if (i < 16) {
        w[i] = words[j + i] | 0;
      } else {
        const gamma0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const gamma1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + gamma0 + w[i - 7] + gamma1) | 0;
      }

      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
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
  }

  let result = '';
  for (let i = 0; i < 8; i++) {
    const hex = (H[i] >>> 0).toString(16).padStart(8, '0');
    result += hex;
  }
  return result;
}

/**
 * Legge l'archivio ZIP .xmind e separa le risorse dalle altre entry.
 * Genera errore se content.json non è presente (formato legacy XMind 8 non supportato).
 */
export async function readArchive(data: ArrayBuffer | Uint8Array): Promise<RawArchive> {
  // checkCRC32: un archivio corrotto deve fallire qui, non produrre byte sbagliati.
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data, { checkCRC32: true });
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
  const zip = new JSZip();

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
