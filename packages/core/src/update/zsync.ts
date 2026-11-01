/**
 * Client zsync in TypeScript puro: legge un file di controllo `.zsync`
 * (formato di `zsyncmake` 0.6) e calcola quali blocchi del file di
 * destinazione sono già presenti in un file locale, così che l'aggiornamento
 * scarichi solo quelli mancanti (HTTP Range).
 *
 * Nessuna dipendenza dalla piattaforma: niente `node:`, niente rete. Il
 * download e la scrittura su disco li fa il chiamante (app desktop).
 */

export interface ZsyncControl {
  /** Valore dell'intestazione `zsync:` (es. "0.6.2"). */
  version: string;
  filename: string;
  /** URL del file di destinazione, spesso relativo al `.zsync`. */
  url: string;
  blocksize: number;
  /** Lunghezza in byte del file di destinazione. */
  length: number;
  /** SHA-1 esadecimale (minuscolo) del file di destinazione. */
  sha1: string;
  seqMatches: number;
  rsumBytes: number;
  checksumBytes: number;
  blockCount: number;
  /** rsum di ogni blocco, già mascherata come `rsumKey` (vedi sotto). */
  rsums: Uint32Array;
  /** MD4 troncati di ogni blocco, `checksumBytes` byte per blocco, in fila. */
  checksums: Uint8Array;
}

/** Copia di un blocco del file di destinazione da un offset del file locale. */
export interface ZsyncCopy {
  block: number;
  sourceOffset: number;
}

/** Intervallo di byte del file di destinazione da scaricare: `[start, end)`. */
export interface ZsyncRange {
  start: number;
  end: number;
}

export interface ZsyncPlan {
  copies: ZsyncCopy[];
  missing: ZsyncRange[];
  /** Byte del file di destinazione ricavati dal file locale. */
  reusedBytes: number;
  /** Byte da scaricare. */
  missingBytes: number;
}

export interface ZsyncPlanOptions {
  /** Avanzamento della scansione, da 0 a 1. */
  onProgress?: (fraction: number) => void;
  /**
   * Ogni quanti byte scansionati cedere il controllo all'event loop: la
   * scansione di un file da 150 MB non deve bloccare il processo.
   */
  yieldEvery?: number;
}

const HEADER_END = '\n\n';
/** 1 MiB: nessun zsyncmake reale usa blocchi più grandi. */
const MAX_BLOCKSIZE = 1_048_576;
/** 4 MiB scansionati tra una cessione all'event loop e l'altra. */
const DEFAULT_YIELD_EVERY = 4_194_304;
const WORD16 = 0xffff;
const BYTE = 0xff;
const HALF_SHIFT = 16;
const BYTE_RADIX = 256;
const WORD_RADIX = 65_536;
const MAX_SEQ_MATCHES = 2;
const MAX_RSUM_BYTES = 4;
const MIN_CHECKSUM_BYTES = 3;
const MD4_BYTES = 16;
/** Con 1–2 byte di rsum si confronta solo `b`, con 3 anche il byte basso di `a`, con 4 tutto. */
const RSUM_A_MASKS: readonly number[] = [0, 0, 0, BYTE, WORD16];
/** Con 1 solo byte di rsum il file contiene soltanto il byte basso di `b`. */
const RSUM_B_MASKS: readonly number[] = [BYTE, BYTE, WORD16, WORD16, WORD16];
/** Moltiplicatore di Fibonacci (2^32 / φ) per distribuire le chiavi nei bucket. */
const HASH_MULTIPLIER = 0x9e3779b1;
const LATIN1 = new TextDecoder('latin1');

/** Legge il file di controllo `.zsync`; lancia un errore comprensibile se non è valido. */
export function parseZsyncControl(bytes: Uint8Array): ZsyncControl {
  const headerEnd = indexOfSequence(bytes, HEADER_END);
  if (headerEnd < 0) throw new Error('File .zsync non valido: intestazione incompleta.');
  const headers = new Map<string, string>();
  for (const line of LATIN1.decode(bytes.subarray(0, headerEnd)).split('\n')) {
    // Riga di intestazione: "Blocksize: 2048" → ["Blocksize", "2048"]; rifiuta "senza due punti".
    // Verifica: https://regex101.com/?regex=%5E(%5BA-Za-z0-9-%5D%2B)%3A%5Cs*(.*)%24&testString=Blocksize%3A%202048
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) headers.set(match[1].toLowerCase(), match[2].trim());
  }

  const version = headers.get('zsync');
  if (!version) throw new Error('File .zsync non valido: manca la versione.');
  if (headers.has('z-url') || headers.has('recompress')) {
    throw new Error('File .zsync con dati compressi: non supportato.');
  }
  const blocksize = positiveInt(headers.get('blocksize'), 'Blocksize');
  if (blocksize > MAX_BLOCKSIZE || (blocksize & (blocksize - 1)) !== 0) {
    throw new Error('File .zsync non valido: Blocksize deve essere una potenza di 2.');
  }
  const length = nonNegativeInt(headers.get('length'), 'Length');
  const url = headers.get('url');
  if (!url) throw new Error('File .zsync non valido: manca URL.');
  const sha1 = headers.get('sha-1')?.toLowerCase();
  // 40 cifre esadecimali: "da39a3ee…" sì, "xyz" no.
  // Verifica: https://regex101.com/?regex=%5E%5B0-9a-f%5D%7B40%7D%24&testString=da39a3ee5e6b4b0d3255bfef95601890afd80709
  if (!sha1 || !/^[0-9a-f]{40}$/.test(sha1)) throw new Error('File .zsync non valido: SHA-1 mancante.');

  // "2,2,3" → seq_matches, rsum_bytes, checksum_bytes.
  const lengths = (headers.get('hash-lengths') ?? '1,4,16').split(',').map((part) => Number.parseInt(part, 10));
  const [seqMatches = NaN, rsumBytes = NaN, checksumBytes = NaN] = lengths;
  const inRange = (value: number, min: number, max: number) => value >= min && value <= max;
  if (lengths.length !== 3 || !inRange(seqMatches, 1, MAX_SEQ_MATCHES)
    || !inRange(rsumBytes, 1, MAX_RSUM_BYTES) || !inRange(checksumBytes, MIN_CHECKSUM_BYTES, MD4_BYTES)) {
    throw new Error('File .zsync non valido: Hash-Lengths fuori intervallo.');
  }

  const blockCount = Math.ceil(length / blocksize);
  const entrySize = rsumBytes + checksumBytes;
  const body = bytes.subarray(headerEnd + HEADER_END.length);
  if (body.length < blockCount * entrySize) throw new Error('File .zsync troncato: mancano checksum dei blocchi.');

  const mask = rsumAMask(rsumBytes);
  const bMask = rsumBMask(rsumBytes);
  const rsums = new Uint32Array(blockCount);
  const checksums = new Uint8Array(blockCount * checksumBytes);
  for (let block = 0; block < blockCount; block++) {
    const base = block * entrySize;
    // I byte salvati sono gli ultimi `rsumBytes` di [a_hi, a_lo, b_hi, b_lo].
    let packed = 0;
    for (let i = 0; i < rsumBytes; i++) packed = packed * BYTE_RADIX + (body[base + i] ?? 0);
    rsums[block] = packRsum(Math.floor(packed / WORD_RADIX) & mask, packed & bMask);
    checksums.set(body.subarray(base + rsumBytes, base + entrySize), block * checksumBytes);
  }

  return {
    version,
    filename: headers.get('filename') ?? '',
    url,
    blocksize,
    length,
    sha1,
    seqMatches,
    rsumBytes,
    checksumBytes,
    blockCount,
    rsums,
    checksums,
  };
}

/**
 * Checksum "rolling" di zsync su un blocco: `a` somma dei byte, `b` somma
 * pesata, entrambi a 16 bit. Oltre la fine di `data` i byte valgono 0 (come il
 * padding dell'ultimo blocco). Restituisce `(a << 16) | b`, senza maschera.
 */
export function rsumBlock(data: Uint8Array, offset: number, blocksize: number): number {
  let a = 0;
  let b = 0;
  for (let i = 0; i < blocksize; i++) {
    const c = data[offset + i] ?? 0;
    a += c;
    b += (blocksize - i) * c;
  }
  return packRsum(a, b);
}

/** `(a << 16) | b` come intero senza segno, con `a` e `b` ridotti a 16 bit. */
function packRsum(a: number, b: number): number {
  return (((a & WORD16) << HALF_SHIFT) | (b & WORD16)) >>> 0;
}

/** Maschera di `a` per il confronto: con 2 byte di rsum conta solo `b`. */
export function rsumAMask(rsumBytes: number): number {
  return RSUM_A_MASKS[rsumBytes] ?? WORD16;
}

/** Maschera di `b` per il confronto: con 1 byte di rsum conta solo il suo byte basso. */
export function rsumBMask(rsumBytes: number): number {
  return RSUM_B_MASKS[rsumBytes] ?? WORD16;
}

/**
 * Confronta il file locale con il file di controllo: per ogni blocco della
 * destinazione trova, se c'è, un offset del file locale con lo stesso
 * contenuto (rsum + MD4, con `seqMatches` blocchi consecutivi). Il risultato
 * va comunque verificato con lo SHA-1 a file ricostruito.
 */
export async function planZsync(
  control: ZsyncControl,
  local: Uint8Array,
  options: ZsyncPlanOptions = {},
): Promise<ZsyncPlan> {
  const { blocksize, blockCount, rsums, checksums, checksumBytes, seqMatches } = control;
  const mask = rsumAMask(control.rsumBytes);
  const bMask = rsumBMask(control.rsumBytes);
  const keyOf = (packed: number) => packRsum((packed >>> HALF_SHIFT) & mask, packed & bMask);
  const sources = new Float64Array(blockCount).fill(-1);
  let remaining = blockCount;

  // Tabella hash a indirizzamento per catene: head[bucket] → primo blocco, next[blocco] → successivo.
  let tableSize = 1;
  // Almeno il doppio dei blocchi, potenza di 2: catene corte e bucket con una maschera.
  while (tableSize < blockCount * MAX_SEQ_MATCHES) tableSize <<= 1;
  const tableMask = tableSize - 1;
  const bucketOf = (key: number) => ((Math.imul(key, HASH_MULTIPLIER) >>> HALF_SHIFT) ^ key) & tableMask;
  const head = new Int32Array(tableSize).fill(-1);
  const next = new Int32Array(blockCount).fill(-1);
  for (let block = blockCount - 1; block >= 0; block--) {
    const bucket = bucketOf(rsums[block] ?? 0);
    next[block] = head[bucket] ?? -1;
    head[bucket] = block;
  }

  // MD4 delle finestre in `x` e `x + blocksize`, calcolati solo se una rsum coincide.
  let digestOffset = -1;
  let digests: [Uint8Array | null, Uint8Array | null] = [null, null];
  const checksumMatches = (offset: number, block: number) => {
    if (digestOffset !== x) {
      digestOffset = x;
      digests = [null, null];
    }
    const slot = offset === x ? 0 : 1;
    const digest = digests[slot] ?? md4(blockAt(local, offset, blocksize));
    digests[slot] = digest;
    const base = block * checksumBytes;
    for (let i = 0; i < checksumBytes; i++) if (digest[i] !== checksums[base + i]) return false;
    return true;
  };

  const shift = Math.log2(blocksize);
  // Letture fuori dai limiti di un typed array deottimizzano il ciclo: oltre la fine vale 0.
  const localLength = local.length;
  const byteAt = (offset: number) => (offset < localLength ? (local[offset] as number) : 0);
  const yieldEvery = options.yieldEvery ?? DEFAULT_YIELD_EVERY;
  let nextYield = yieldEvery;
  // Due finestre rolling: in `x` e, per seqMatches = 2, in `x + blocksize`.
  let r0 = rsumBlock(local, 0, blocksize);
  let r1 = seqMatches > 1 ? rsumBlock(local, blocksize, blocksize) : 0;
  let x = 0;

  while (x < local.length && remaining > 0) {
    let matched = false;
    const key0 = keyOf(r0);
    for (let block = head[bucketOf(key0)] ?? -1; block >= 0; block = next[block] ?? -1) {
      if (rsums[block] !== key0) continue;
      const hasNext = seqMatches > 1 && block + 1 < blockCount;
      if (hasNext && rsums[block + 1] !== keyOf(r1)) continue;
      if (!checksumMatches(x, block)) continue;
      if (hasNext && !checksumMatches(x + blocksize, block + 1)) continue;
      matched = true;
      if (sources[block] === -1) {
        sources[block] = x;
        remaining--;
      }
      if (hasNext && sources[block + 1] === -1) {
        sources[block + 1] = x + blocksize;
        remaining--;
      }
    }

    if (matched) {
      // Il blocco trovato non può contenerne un altro che inizi al suo interno: si salta avanti.
      // La seconda finestra diventa la prima: rsum e MD4 già calcolati si riusano.
      x += blocksize;
      if (seqMatches > 1) {
        r0 = r1;
        r1 = rsumBlock(local, x + blocksize, blocksize);
        digests = [digests[1], null];
        digestOffset = x;
      } else {
        r0 = rsumBlock(local, x, blocksize);
      }
    } else {
      const entering = byteAt(x + blocksize);
      r0 = roll(r0, byteAt(x), entering, shift);
      if (seqMatches > 1) r1 = roll(r1, entering, byteAt(x + MAX_SEQ_MATCHES * blocksize), shift);
      x++;
    }

    if (x >= nextYield) {
      nextYield = x + yieldEvery;
      options.onProgress?.(Math.min(1, x / local.length));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  options.onProgress?.(1);

  const copies: ZsyncCopy[] = [];
  const missing: ZsyncRange[] = [];
  let reusedBytes = 0;
  for (let block = 0; block < blockCount; block++) {
    const start = block * blocksize;
    const end = Math.min(start + blocksize, control.length);
    const source = sources[block] ?? -1;
    if (source >= 0) {
      copies.push({ block, sourceOffset: source });
      reusedBytes += end - start;
      continue;
    }
    const last = missing[missing.length - 1];
    if (last && last.end === start) last.end = end;
    else missing.push({ start, end });
  }
  return { copies, missing, reusedBytes, missingBytes: control.length - reusedBytes };
}

/** Sposta la finestra di un byte: esce `oldByte`, entra `newByte`. */
function roll(packed: number, oldByte: number, newByte: number, shift: number): number {
  const a = ((packed >>> HALF_SHIFT) - oldByte + newByte) & WORD16;
  return packRsum(a, (packed & WORD16) + a - (oldByte << shift));
}

/** Blocco di `blocksize` byte da `offset`, con padding a zero oltre la fine. */
export function blockAt(data: Uint8Array, offset: number, blocksize: number): Uint8Array {
  if (offset + blocksize <= data.length) return data.subarray(offset, offset + blocksize);
  const block = new Uint8Array(blocksize);
  if (offset < data.length) block.set(data.subarray(offset));
  return block;
}

function indexOfSequence(bytes: Uint8Array, sequence: string): number {
  const codes = Array.from(sequence, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i + codes.length <= bytes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

function nonNegativeInt(value: string | undefined, name: string): number {
  // Solo cifre: "2048" sì, "2k" o "-1" no.
  // Verifica: https://regex101.com/?regex=%5E%5Cd%2B%24&testString=2048
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`File .zsync non valido: ${name} mancante.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`File .zsync non valido: ${name} fuori intervallo.`);
  return parsed;
}

function positiveInt(value: string | undefined, name: string): number {
  const parsed = nonNegativeInt(value, name);
  if (parsed === 0) throw new Error(`File .zsync non valido: ${name} deve essere positivo.`);
  return parsed;
}

const MD4_BLOCK = 64;
const MD4_LENGTH_BYTES = 8;
const MD4_WORDS = 16;
const MD4_WORD_BYTES = 4;
const MD4_PAD_BYTE = 0x80;
const BITS_PER_BYTE = 8;
const UINT32_RADIX = 0x1_0000_0000;
const MD4_INIT: readonly number[] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

const MD4_ROUND2 = 0x5a827999;
const MD4_ROUND3 = 0x6ed9eba1;
const MD4_ORDER2: readonly number[] = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
const MD4_ORDER3: readonly number[] = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const MD4_SHIFTS1: readonly number[] = [3, 7, 11, 19];
const MD4_SHIFTS2: readonly number[] = [3, 5, 9, 13];
const MD4_SHIFTS3: readonly number[] = [3, 9, 11, 15];
const WORD_BITS = 32;

/**
 * MD4 (RFC 1320): zsync lo usa come checksum forte dei blocchi. È nel ciclo
 * caldo dell'aggiornamento: niente allocazioni per passo, i blocchi interi si
 * leggono direttamente da `data` e solo la coda viene copiata col padding.
 */
export function md4(data: Uint8Array): Uint8Array {
  const state = Int32Array.from(MD4_INIT);
  const words = new Int32Array(MD4_WORDS);
  const fullLength = data.length - (data.length % MD4_BLOCK);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let chunk = 0; chunk < fullLength; chunk += MD4_BLOCK) md4Chunk(state, words, dataView, chunk);

  // Coda + 0x80 + lunghezza in bit a 64 bit, arrotondata a uno o due blocchi.
  const tail = data.subarray(fullLength);
  const tailLength = Math.ceil((tail.length + 1 + MD4_LENGTH_BYTES) / MD4_BLOCK) * MD4_BLOCK;
  const padded = new Uint8Array(tailLength);
  padded.set(tail);
  padded[tail.length] = MD4_PAD_BYTE;
  const tailView = new DataView(padded.buffer);
  const bitLength = data.length * BITS_PER_BYTE;
  tailView.setUint32(tailLength - MD4_LENGTH_BYTES, bitLength >>> 0, true);
  tailView.setUint32(tailLength - MD4_WORD_BYTES, Math.floor(bitLength / UINT32_RADIX), true);
  for (let chunk = 0; chunk < tailLength; chunk += MD4_BLOCK) md4Chunk(state, words, tailView, chunk);

  const out = new Uint8Array(MD4_BYTES);
  const outView = new DataView(out.buffer);
  state.forEach((word, i) => outView.setInt32(i * MD4_WORD_BYTES, word, true));
  return out;
}

function md4Chunk(state: Int32Array, words: Int32Array, view: DataView, offset: number): void {
  for (let i = 0; i < MD4_WORDS; i++) words[i] = view.getInt32(offset + i * MD4_WORD_BYTES, true);
  let a = state[0] ?? 0;
  let b = state[1] ?? 0;
  let c = state[2] ?? 0;
  let d = state[3] ?? 0;
  let t = 0;
  for (let i = 0; i < MD4_WORDS; i++) {
    t = rotl32((a + ((b & c) | (~b & d)) + (words[i] ?? 0)) | 0, MD4_SHIFTS1[i % MD4_WORD_BYTES] ?? 0);
    a = d; d = c; c = b; b = t;
  }
  for (let i = 0; i < MD4_WORDS; i++) {
    const word = words[MD4_ORDER2[i] ?? 0] ?? 0;
    t = rotl32((a + ((b & c) | (b & d) | (c & d)) + word + MD4_ROUND2) | 0, MD4_SHIFTS2[i % MD4_WORD_BYTES] ?? 0);
    a = d; d = c; c = b; b = t;
  }
  for (let i = 0; i < MD4_WORDS; i++) {
    const word = words[MD4_ORDER3[i] ?? 0] ?? 0;
    t = rotl32((a + (b ^ c ^ d) + word + MD4_ROUND3) | 0, MD4_SHIFTS3[i % MD4_WORD_BYTES] ?? 0);
    a = d; d = c; c = b; b = t;
  }
  state[0] = ((state[0] ?? 0) + a) | 0;
  state[1] = ((state[1] ?? 0) + b) | 0;
  state[2] = ((state[2] ?? 0) + c) | 0;
  state[3] = ((state[3] ?? 0) + d) | 0;
}

function rotl32(value: number, bits: number): number {
  return (value << bits) | (value >>> (WORD_BITS - bits));
}
