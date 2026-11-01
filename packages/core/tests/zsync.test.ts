import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  blockAt,
  compareVersions,
  md4,
  parseZsyncControl,
  planZsync,
  rsumBlock,
  stripVersionPrefix,
} from '../src/update/index.js';
import type { ZsyncControl, ZsyncPlan, ZsyncRange } from '../src/update/index.js';

interface ControlOptions {
  blocksize: number;
  seqMatches: number;
  rsumBytes: number;
  checksumBytes: number;
}

type Combination = Omit<ControlOptions, 'blocksize'>;

const BLOCK_SMALL = 512;
const BLOCK_LARGE = 2048;
const BLOCK_ODD = 1000;
const BLOCK_SIZES: readonly number[] = [BLOCK_SMALL, BLOCK_LARGE];

const SEQ_SINGLE = 1;
const SEQ_PAIR = 2;
const RSUM_TWO = 2;
const RSUM_THREE = 3;
const RSUM_FULL = 4;
/** Un solo byte di rsum: nel file c'è solo il byte basso di `b`. */
const RSUM_ONE = 1;
const CHECK_FOUR = 4;
const CHECK_FIVE = 5;
const CHECK_EIGHT = 8;
const CHECK_FULL = 16;
const COMBINATIONS: readonly Combination[] = [
  { seqMatches: SEQ_SINGLE, rsumBytes: RSUM_FULL, checksumBytes: CHECK_FULL },
  { seqMatches: SEQ_PAIR, rsumBytes: RSUM_TWO, checksumBytes: CHECK_FOUR },
  { seqMatches: SEQ_PAIR, rsumBytes: RSUM_THREE, checksumBytes: CHECK_FIVE },
  { seqMatches: SEQ_SINGLE, rsumBytes: RSUM_TWO, checksumBytes: CHECK_EIGHT },
  { seqMatches: SEQ_PAIR, rsumBytes: RSUM_ONE, checksumBytes: CHECK_EIGHT },
];
const PLAN_CASES = COMBINATIONS.flatMap((combination) =>
  BLOCK_SIZES.map((blocksize) => ({ ...combination, blocksize })),
);
const DEFAULT_OPTIONS: ControlOptions = {
  blocksize: BLOCK_SMALL,
  seqMatches: SEQ_SINGLE,
  rsumBytes: RSUM_FULL,
  checksumBytes: CHECK_FULL,
};

const BYTE_MASK = 0xff;
const BITS_PER_BYTE = 8;
const WORD_MASK = 0xffff;
const WORD_SHIFT = 16;
const WORD_MODULUS = 65_536;
const RSUM_B_BYTES = 2;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;
const DIGIT_REPEATS = 8;
const PREFIX_LENGTH = 5;
const SUFFIX_LENGTH = 4;

const XS_SHIFT_LEFT_A = 13;
const XS_SHIFT_RIGHT = 17;
const XS_SHIFT_LEFT_B = 5;
const SEED_OLD = 0x12345678;
const SEED_INSERT = 0xbeef;
const SEED_MODIFY = 0xcafe;
const SEED_TAIL = 0xf00d;
const SEED_DEFAULT = 0x51;
const SEED_SMALL = 0x77;
const SEED_TINY = 0x99;
const SEED_INTEROP = 0x2468ace1;

const OLD_LENGTH = 200_000;
const INSERT_LENGTH = 37;
const KEEP_END = 60_000;
const CUT_END = 61_500;
const MODIFY_START = 90_000;
const MODIFY_LENGTH = 700;
const TAIL_LENGTH = 5_000;
const INTEROP_LENGTH = 300_000;
const SMALL_BLOCKS = 5;
const PARTIAL_LENGTH = 77;
const TINY_LENGTH = 100;
const PARSE_LENGTH = 1500;
const PARSE_BLOCKS = 3;
const ERROR_LENGTH = 1024;
const ODD_LENGTH = 3000;
const TRUNCATE_BY = 10;
const RSUM_LENGTH = 2000;
const RSUM_STRADDLE = 1600;
const RSUM_BEYOND = 2500;
const RSUM_LONG_LENGTH = 5000;
const RSUM_LONG_OFFSET = 4000;
const FULL_BYTES_LENGTH = 4096;
const REUSE_MIN_FRACTION = 0.8;
const YIELD_EVERY_SMALL = 4096;

const HAS_ZSYNCMAKE = spawnSync('zsyncmake', ['-V']).error === undefined;
const encoder = new TextEncoder();

/** Generatore xorshift32 deterministico: stesso seme, stessi byte. */
function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  let state = seed;
  return Uint8Array.from({ length }, () => {
    state ^= state << XS_SHIFT_LEFT_A;
    state ^= state >>> XS_SHIFT_RIGHT;
    state ^= state << XS_SHIFT_LEFT_B;
    return state & BYTE_MASK;
  });
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_WIDTH, '0')).join('');
}

function sha1Hex(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

/** Copia di `source` con inserimento in testa, cancellazione in mezzo, modifica di un tratto e coda nuova. */
function editedCopy(source: Uint8Array): Uint8Array {
  return concatBytes(
    pseudoRandomBytes(INSERT_LENGTH, SEED_INSERT),
    source.subarray(0, KEEP_END),
    source.subarray(CUT_END, MODIFY_START),
    pseudoRandomBytes(MODIFY_LENGTH, SEED_MODIFY),
    source.subarray(MODIFY_START + MODIFY_LENGTH),
    pseudoRandomBytes(TAIL_LENGTH, SEED_TAIL),
  );
}

function controlFields(data: Uint8Array, options: ControlOptions): [string, string][] {
  return [
    ['zsync', '0.6.2'],
    ['Filename', 'file.bin'],
    ['MTime', 'Sun, 01 Nov 2026 00:00:00 +0000'],
    ['Blocksize', String(options.blocksize)],
    ['Length', String(data.length)],
    ['Hash-Lengths', `${options.seqMatches},${options.rsumBytes},${options.checksumBytes}`],
    ['URL', 'file.bin'],
    ['SHA-1', sha1Hex(data)],
  ];
}

/** Una voce del corpo: gli ultimi `rsumBytes` byte del rsum, poi `checksumBytes` byte di MD4 troncato. */
function controlEntry(data: Uint8Array, block: number, options: ControlOptions): Uint8Array {
  const { blocksize, rsumBytes, checksumBytes } = options;
  const offset = block * blocksize;
  const rsum = rsumBlock(data, offset, blocksize);
  const rsumPart = Array.from(
    { length: rsumBytes },
    (_, index) => (rsum >>> (BITS_PER_BYTE * (rsumBytes - 1 - index))) & BYTE_MASK,
  );
  return concatBytes(Uint8Array.from(rsumPart), md4(blockAt(data, offset, blocksize)).subarray(0, checksumBytes));
}

function controlBody(data: Uint8Array, options: ControlOptions): Uint8Array {
  const blockCount = Math.ceil(data.length / options.blocksize);
  return concatBytes(...Array.from({ length: blockCount }, (_, block) => controlEntry(data, block, options)));
}

function encodeControl(fields: readonly (readonly [string, string])[], body: Uint8Array): Uint8Array {
  const header = fields.map(([key, value]) => `${key}: ${value}\n`).join('') + '\n';
  return concatBytes(encoder.encode(header), body);
}

/** Genera un file `.zsync` come zsyncmake per `data`. */
function makeControl(data: Uint8Array, options: ControlOptions): Uint8Array {
  return encodeControl(controlFields(data, options), controlBody(data, options));
}

/** Chiave attesa di un blocco dopo il parsing: `a` conta solo per i byte di `a` scritti nel file, `b` sempre intero. */
function expectedRsumKey(rsum: number, rsumBytes: number): number {
  const aBytes = Math.max(0, rsumBytes - RSUM_B_BYTES);
  const aMask = (1 << (BITS_PER_BYTE * aBytes)) - 1;
  // Con meno di 2 byte anche `b` è parziale: restano i suoi byte bassi.
  const bMask = (1 << (BITS_PER_BYTE * Math.min(rsumBytes, RSUM_B_BYTES))) - 1;
  return ((((rsum >>> WORD_SHIFT) & aMask) << WORD_SHIFT) | (rsum & bMask)) >>> 0;
}

/** Riferimento ingenuo di rsum: somme dirette con padding a zero oltre la fine. */
function naiveRsum(data: Uint8Array, offset: number, blocksize: number): number {
  const bytes = Array.from({ length: blocksize }, (_, index) => data[offset + index] ?? 0);
  const a = bytes.reduce((sum, byte) => sum + byte, 0) % WORD_MODULUS;
  const b = bytes.reduce((sum, byte, index) => sum + ((blocksize - index) * byte) % WORD_MODULUS, 0) % WORD_MODULUS;
  return a * WORD_MODULUS + b;
}

/** Ricostruisce il file di destinazione come il client: copie dal file locale, poi gli intervalli scaricati. */
function rebuild(control: ZsyncControl, plan: ZsyncPlan, oldData: Uint8Array, newData: Uint8Array): Uint8Array {
  const out = new Uint8Array(control.length);
  plan.copies.forEach(({ block, sourceOffset }) => {
    const start = block * control.blocksize;
    const count = Math.min(control.blocksize, control.length - start);
    // subarray oltre la fine si ferma da sola: il resto del blocco resta a zero, come il padding.
    out.set(oldData.subarray(sourceOffset, sourceOffset + count), start);
  });
  plan.missing.forEach(({ start, end }) => out.set(newData.subarray(start, end), start));
  return out;
}

function sumOfRanges(ranges: readonly ZsyncRange[]): number {
  return ranges.reduce((total, range) => total + (range.end - range.start), 0);
}

/** Intervalli ordinati, non vuoti, disgiunti e non adiacenti (quelli adiacenti vanno fusi), dentro [0, length]. */
function expectOrderedRanges(ranges: readonly ZsyncRange[], length: number): void {
  ranges.reduce((previousEnd, range) => {
    expect(range.start).toBeGreaterThan(previousEnd);
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.end).toBeLessThanOrEqual(length);
    return range.end;
  }, Number.NEGATIVE_INFINITY);
}

const OLD_DATA = pseudoRandomBytes(OLD_LENGTH, SEED_OLD);
const NEW_DATA = editedCopy(OLD_DATA);

describe('md4', () => {
  // Vettori di test di RFC 1320, appendice A.5.
  it.each([
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
    ['1234567890'.repeat(DIGIT_REPEATS), 'e33b4ddc9c38f2199c3e7b164fcc0536'],
  ])('vettore RFC 1320 per "%s"', (message, expected) => {
    expect(hex(md4(encoder.encode(message)))).toBe(expected);
  });

  it('su una subarray con byteOffset non nullo dà lo stesso risultato della copia', () => {
    const bytes = encoder.encode('1234567890'.repeat(DIGIT_REPEATS));
    const backing = new Uint8Array(PREFIX_LENGTH + bytes.length + SUFFIX_LENGTH);
    backing.set(bytes, PREFIX_LENGTH);
    const view = backing.subarray(PREFIX_LENGTH, PREFIX_LENGTH + bytes.length);

    expect(view.byteOffset).toBe(PREFIX_LENGTH);
    expect(hex(md4(view))).toBe(hex(md4(bytes)));
  });
});

describe('rsumBlock', () => {
  it.each([
    { name: 'blocco pieno', length: RSUM_LENGTH, offset: 0, blocksize: BLOCK_SMALL },
    { name: 'blocco che sfora la fine dei dati', length: RSUM_LENGTH, offset: RSUM_STRADDLE, blocksize: BLOCK_SMALL },
    { name: 'blocco interamente oltre la fine', length: RSUM_LENGTH, offset: RSUM_BEYOND, blocksize: BLOCK_SMALL },
    { name: 'blocco da 2048 che sfora', length: RSUM_LONG_LENGTH, offset: RSUM_LONG_OFFSET, blocksize: BLOCK_LARGE },
  ])('coincide con il calcolo ingenuo: $name', ({ length, offset, blocksize }) => {
    const data = pseudoRandomBytes(length, SEED_DEFAULT);
    expect(rsumBlock(data, offset, blocksize)).toBe(naiveRsum(data, offset, blocksize));
  });

  it('gestisce il caso di massimo valore dei byte senza overflow', () => {
    const data = new Uint8Array(FULL_BYTES_LENGTH).fill(BYTE_MASK);
    expect(rsumBlock(data, 0, BLOCK_LARGE)).toBe(naiveRsum(data, 0, BLOCK_LARGE));
  });
});

describe('versioni', () => {
  it('compareVersions ignora il prefisso v', () => {
    expect(compareVersions('v26.2.0', '26.2.0')).toBe(0);
  });

  it('compareVersions confronta numericamente, non come testo', () => {
    expect(compareVersions('26.10.0', '26.9.9')).toBeGreaterThan(0);
    expect(compareVersions('26.9.9', '26.10.0')).toBeLessThan(0);
  });

  it('compareVersions riconosce una patch più recente', () => {
    expect(compareVersions('26.2.1', '26.2.0')).toBeGreaterThan(0);
  });

  it('compareVersions tratta le parti mancanti come zero', () => {
    expect(compareVersions('26.2', '26.2.0')).toBe(0);
  });

  it('stripVersionPrefix toglie la v iniziale e lascia il resto', () => {
    expect(stripVersionPrefix('v26.2.0')).toBe('26.2.0');
    expect(stripVersionPrefix('26.2.0')).toBe('26.2.0');
    expect(stripVersionPrefix(' v1.0.0 ')).toBe('1.0.0');
  });
});

describe('parseZsyncControl', () => {
  it.each(COMBINATIONS)(
    'legge campi e tabelle di blocchi con rsumBytes $rsumBytes e checksumBytes $checksumBytes',
    (combination) => {
      const data = pseudoRandomBytes(PARSE_LENGTH, SEED_DEFAULT);
      const options: ControlOptions = { blocksize: BLOCK_SMALL, ...combination };
      const control = parseZsyncControl(makeControl(data, options));
      const offsets = Array.from({ length: PARSE_BLOCKS }, (_, block) => block * BLOCK_SMALL);

      expect(control).toMatchObject({
        version: '0.6.2',
        filename: 'file.bin',
        url: 'file.bin',
        blocksize: BLOCK_SMALL,
        length: data.length,
        sha1: sha1Hex(data),
        seqMatches: combination.seqMatches,
        rsumBytes: combination.rsumBytes,
        checksumBytes: combination.checksumBytes,
        blockCount: PARSE_BLOCKS,
      });
      expect(Array.from(control.rsums)).toEqual(
        offsets.map((offset) => expectedRsumKey(rsumBlock(data, offset, BLOCK_SMALL), combination.rsumBytes)),
      );
      expect(control.checksums).toEqual(
        concatBytes(
          ...offsets.map((offset) =>
            md4(blockAt(data, offset, BLOCK_SMALL)).subarray(0, combination.checksumBytes),
          ),
        ),
      );
    },
  );

  it('rifiuta un file senza riga vuota che chiude l\'intestazione', () => {
    const truncatedHeader = encoder.encode('zsync: 0.6.2\nBlocksize: 512\nLength: 10\n');
    expect(() => parseZsyncControl(truncatedHeader)).toThrow('intestazione incompleta');
  });

  it('rifiuta un Blocksize che non è una potenza di 2', () => {
    const control = makeControl(pseudoRandomBytes(ODD_LENGTH, SEED_DEFAULT), { ...DEFAULT_OPTIONS, blocksize: BLOCK_ODD });
    expect(() => parseZsyncControl(control)).toThrow('potenza di 2');
  });

  it('rifiuta un file senza SHA-1', () => {
    const data = pseudoRandomBytes(ERROR_LENGTH, SEED_DEFAULT);
    const fields = controlFields(data, DEFAULT_OPTIONS).filter(([key]) => key !== 'SHA-1');
    const control = encodeControl(fields, controlBody(data, DEFAULT_OPTIONS));
    expect(() => parseZsyncControl(control)).toThrow('SHA-1 mancante');
  });

  it('rifiuta un corpo troncato', () => {
    const full = makeControl(pseudoRandomBytes(ERROR_LENGTH, SEED_DEFAULT), DEFAULT_OPTIONS);
    expect(() => parseZsyncControl(full.subarray(0, full.length - TRUNCATE_BY))).toThrow('troncato');
  });

  it('rifiuta un file con Z-URL (dati compressi non supportati)', () => {
    const data = pseudoRandomBytes(ERROR_LENGTH, SEED_DEFAULT);
    const fields: [string, string][] = [...controlFields(data, DEFAULT_OPTIONS), ['Z-URL', 'file.bin.gz']];
    expect(() => parseZsyncControl(encodeControl(fields, controlBody(data, DEFAULT_OPTIONS)))).toThrow('non supportato');
  });
});

describe('planZsync', () => {
  it.each(PLAN_CASES)(
    'ricostruisce il file nuovo con blocksize $blocksize, seqMatches $seqMatches, rsumBytes $rsumBytes, checksumBytes $checksumBytes',
    async (options) => {
      const control = parseZsyncControl(makeControl(NEW_DATA, options));
      const progress: number[] = [];
      const plan = await planZsync(control, OLD_DATA, { onProgress: (fraction) => progress.push(fraction) });

      expect(rebuild(control, plan, OLD_DATA, NEW_DATA)).toEqual(NEW_DATA);
      expect(plan.reusedBytes + plan.missingBytes).toBe(control.length);
      expect(plan.reusedBytes).toBeGreaterThanOrEqual(control.length * REUSE_MIN_FRACTION);
      expect(sumOfRanges(plan.missing)).toBe(plan.missingBytes);
      expectOrderedRanges(plan.missing, control.length);
      expect(progress.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true);
      expect(progress[progress.length - 1]).toBe(1);
    },
  );

  it('cede il controllo all\'event loop e riporta l\'avanzamento in ordine crescente', async () => {
    const control = parseZsyncControl(makeControl(NEW_DATA, DEFAULT_OPTIONS));
    const progress: number[] = [];
    const plan = await planZsync(control, OLD_DATA, {
      yieldEvery: YIELD_EVERY_SMALL,
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(progress.length).toBeGreaterThan(1);
    expect(progress.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true);
    expect(progress.slice(1).every((fraction, index) => fraction >= (progress[index] ?? 0))).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
    expect(rebuild(control, plan, OLD_DATA, NEW_DATA)).toEqual(NEW_DATA);
  });

  describe('casi limite', () => {
    it('file locale vuoto: tutto il file va scaricato in un solo intervallo', async () => {
      const control = parseZsyncControl(makeControl(NEW_DATA, DEFAULT_OPTIONS));
      const plan = await planZsync(control, new Uint8Array(0));

      expect(plan.copies).toEqual([]);
      expect(plan.missing).toEqual([{ start: 0, end: control.length }]);
      expect(plan.reusedBytes).toBe(0);
      expect(plan.missingBytes).toBe(control.length);
    });

    it('file locale identico: nessun intervallo da scaricare', async () => {
      const control = parseZsyncControl(makeControl(NEW_DATA, DEFAULT_OPTIONS));
      const plan = await planZsync(control, NEW_DATA);

      expect(plan.missing).toEqual([]);
      expect(plan.missingBytes).toBe(0);
      expect(plan.reusedBytes).toBe(control.length);
      expect(plan.copies).toHaveLength(control.blockCount);
      expect(rebuild(control, plan, NEW_DATA, NEW_DATA)).toEqual(NEW_DATA);
    });

    it('lunghezza non multipla del blocksize: l\'ultimo blocco parziale si riusa solo se identico', async () => {
      const data = pseudoRandomBytes(SMALL_BLOCKS * BLOCK_SMALL + PARTIAL_LENGTH, SEED_SMALL);
      const control = parseZsyncControl(makeControl(data, DEFAULT_OPTIONS));

      const identical = await planZsync(control, data);
      expect(identical.missing).toEqual([]);
      expect(identical.reusedBytes).toBe(data.length);

      const changedTail = data.slice();
      changedTail[changedTail.length - 1] ^= BYTE_MASK;
      const plan = await planZsync(control, changedTail);
      expect(plan.missing).toEqual([{ start: SMALL_BLOCKS * BLOCK_SMALL, end: data.length }]);
      expect(plan.missingBytes).toBe(PARTIAL_LENGTH);
      expect(rebuild(control, plan, changedTail, data)).toEqual(data);
    });

    it('destinazione più corta di un blocco: riusata se identica, altrimenti scaricata intera', async () => {
      const tiny = pseudoRandomBytes(TINY_LENGTH, SEED_TINY);
      const control = parseZsyncControl(makeControl(tiny, DEFAULT_OPTIONS));

      const identical = await planZsync(control, tiny);
      expect(identical.copies).toEqual([{ block: 0, sourceOffset: 0 }]);
      expect(identical.missing).toEqual([]);
      expect(identical.reusedBytes).toBe(TINY_LENGTH);

      const other = await planZsync(control, pseudoRandomBytes(TINY_LENGTH, SEED_MODIFY));
      expect(other.copies).toEqual([]);
      expect(other.missing).toEqual([{ start: 0, end: TINY_LENGTH }]);
    });
  });

  describe.skipIf(!HAS_ZSYNCMAKE)('interoperabilità con zsyncmake reale', () => {
    let workDir = '';

    beforeAll(() => {
      workDir = mkdtempSync(join(tmpdir(), 'xmap-zsync-'));
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it('legge il .zsync prodotto da zsyncmake e ricostruisce una versione modificata', async () => {
      const newData = pseudoRandomBytes(INTEROP_LENGTH, SEED_INTEROP);
      writeFileSync(join(workDir, 'new.bin'), newData);
      execFileSync('zsyncmake', ['-u', 'new.bin', '-o', 'new.bin.zsync', 'new.bin'], {
        cwd: workDir,
        stdio: 'ignore',
      });

      const control = parseZsyncControl(readFileSync(join(workDir, 'new.bin.zsync')));
      expect(control.length).toBe(newData.length);
      expect(control.sha1).toBe(sha1Hex(newData));

      const oldData = editedCopy(newData);
      const plan = await planZsync(control, oldData);
      const rebuilt = rebuild(control, plan, oldData, newData);
      expect(rebuilt).toEqual(newData);
      expect(sha1Hex(rebuilt)).toBe(control.sha1);
      expect(plan.reusedBytes).toBeGreaterThan(0);
    });
  });
});
