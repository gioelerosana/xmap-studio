import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseOPML, toOPML, validateArchiveBytes } from '../src/index.js';
import type { Sheet } from '../src/model/types.js';

async function archiveWithContent(content: unknown): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify(content));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {} } }));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('validateArchiveBytes: fogli', () => {
  it('rifiuta content.json senza fogli', async () => {
    await expect(validateArchiveBytes(await archiveWithContent([]))).rejects.toThrow(/fogli/);
  });

  it('rifiuta un foglio senza argomento centrale', async () => {
    await expect(validateArchiveBytes(await archiveWithContent([{ id: 's' }]))).rejects.toThrow(/argomento centrale/);
  });

  it('accetta un foglio con radice', async () => {
    const report = await validateArchiveBytes(await archiveWithContent([{ id: 's', rootTopic: { id: 'r', title: 'x' } }]));
    expect(report.entries).toBe(2);
  });
});

function sheet(rootTitle: string, notes?: string): Sheet {
  const child = {
    id: 'c',
    title: 'figlio',
    ...(notes ? { notes: { plain: { content: notes } } } : {}),
  };
  return { id: 's', title: 'Foglio', rootTopic: { id: 'r', title: rootTitle, children: { attached: [child] } } } as Sheet;
}

describe('OPML', () => {
  it('le note su più righe restano su più righe per un parser XML', () => {
    const opml = toOPML([sheet('Radice', 'riga 1\nriga 2')]);
    expect(opml).not.toMatch(/riga 1\nriga 2/);
    expect(opml).toContain('riga 1&#10;riga 2');
    const root = parseOPML(opml);
    expect(root.children[0].children[0].notes).toBe('riga 1\nriga 2');
  });

  it('toglie i caratteri non ammessi in XML', () => {
    const opml = toOPML([sheet('A\u0001B\u0008C')]);
    expect(opml).toContain('text="ABC"');
  });

  it("decodifica le entità nel titolo dell'intestazione", () => {
    const root = parseOPML('<opml><head><title>Fisica &amp; Chimica</title></head><body></body></opml>');
    expect(root.title).toBe('Fisica & Chimica');
  });

  it("accetta '>' letterale nei valori degli attributi", () => {
    const root = parseOPML('<opml><body><outline text="a > b" _note="x"><outline text="c"/></outline></body></opml>');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].title).toBe('a > b');
    expect(root.children[0].notes).toBe('x');
    expect(root.children[0].children[0].title).toBe('c');
  });
});

describe('Markdown import', () => {
  it('una riga "3.14" non è un elemento di elenco numerato', () => {
    const root = parseMarkdown('# Radice\n- pi\n3.14159\n1. uno\n2.\n');
    expect(root.children.map((c) => c.title)).toEqual(['pi', 'uno', '']);
  });
});
