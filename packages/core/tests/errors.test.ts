import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  AppController,
  CODE_FORMAT,
  CODE_IO,
  CODE_LATEX,
  CODE_MOVE,
  CODE_NO_WORKBOOK,
  CODE_TOPIC_NOT_FOUND,
  CODE_VALIDATION,
  XmapError,
  errorCode,
  readArchive,
  toErrorPayload,
  validateArchiveBytes,
} from '../src/index.js';

async function minimalXmind(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'content.json',
    JSON.stringify([
      {
        id: 's1',
        class: 'sheet',
        title: 'Foglio',
        rootTopic: { id: 'r', class: 'topic', title: 'Radice', children: { attached: [{ id: 'a', title: 'A' }] } },
      },
    ])
  );
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  zip.file('metadata.json', '{}');
  return zip.generateAsync({ type: 'uint8array' });
}

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return errorCode(err);
  }
  return undefined;
}

describe('errori con codice', () => {
  it('XmapError espone code, details e name', () => {
    const err = new XmapError(CODE_IO, 'boom', { a: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('XmapError');
    expect(err.code).toBe('io');
    expect(err.details).toEqual({ a: 1 });
  });

  it('toErrorPayload usa io per gli errori sconosciuti', () => {
    expect(toErrorPayload(new XmapError(CODE_LATEX, 'x'))).toEqual({ code: 'latex', message: 'x' });
    expect(toErrorPayload(new Error('y'))).toEqual({ code: 'io', message: 'y' });
    expect(toErrorPayload('z')).toEqual({ code: 'io', message: 'z' });
    expect(errorCode(new Error('y'))).toBeUndefined();
  });

  it('senza workbook: no_workbook', async () => {
    const c = new AppController();
    expect(await codeOf(() => c.setTopicTitle('a', 'x'))).toBe(CODE_NO_WORKBOOK);
    expect(await codeOf(() => c.prepareArchiveBytes())).toBe(CODE_NO_WORKBOOK);
  });

  it('topic inesistente: topic_not_found', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    expect(await codeOf(() => c.setTopicTitle('zzz', 'x'))).toBe(CODE_TOPIC_NOT_FOUND);
    expect(await codeOf(() => c.addTopic('zzz', 'x'))).toBe(CODE_TOPIC_NOT_FOUND);
  });

  it('spostamento non valido: move', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    expect(await codeOf(() => c.moveTopic('r', 'a', 'into'))).toBe(CODE_MOVE);
  });

  it('LaTeX non valido: latex', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    expect(await codeOf(() => c.apply('a', '\\frac{'))).toBe(CODE_LATEX);
    expect(await codeOf(() => c.apply('a', '   '))).toBe(CODE_LATEX);
  });

  it('ZIP corrotto: format in lettura, validation in validazione', async () => {
    const garbage = new TextEncoder().encode('non sono uno zip');
    expect(await codeOf(() => readArchive(garbage))).toBe(CODE_FORMAT);
    expect(await codeOf(() => new AppController().open(garbage))).toBe(CODE_FORMAT);
    expect(await codeOf(() => validateArchiveBytes(garbage))).toBe(CODE_VALIDATION);
  });

  it('formato di importazione sconosciuto: format', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    expect(await codeOf(() => c.importOutline('docx', 'x'))).toBe(CODE_FORMAT);
  });
});
