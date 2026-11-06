import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { layoutBoundaries, layoutSheets, validateArchiveBytes } from '../src/index.js';
import type { NodeMetrics, SheetDto, TopicView } from '../src/index.js';

const SHA = 'b'.repeat(64);

async function archive(content: unknown, resources: string[] = [], rawContent?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('content.json', rawContent ?? JSON.stringify(content));
  const entries: Record<string, object> = { 'content.json': {} };
  for (const r of resources) {
    zip.file(r, new Uint8Array([1, 2, 3]));
    entries[r] = {};
  }
  zip.file('manifest.json', JSON.stringify({ 'file-entries': entries }));
  return zip.generateAsync({ type: 'uint8array' });
}

function sheetWith(root: Record<string, unknown>): unknown[] {
  return [{ id: 's', class: 'sheet', rootTopic: { id: 'r', ...root } }];
}

describe('validateArchiveBytes: riferimenti a risorse', () => {
  it('un titolo, una nota o un\'etichetta con "xap:resources/…" non bloccano il salvataggio', async () => {
    const content = sheetWith({
      title: 'xap:resources/inesistente.png',
      labels: ['xap:resources/etichetta.png'],
      notes: { plain: { content: 'xap:resources/nota.png' } },
      extensions: [{ provider: 'org.xmind.ui.mathJax', content: { content: 'xap:resources/latex' } }],
      children: { attached: [{ id: 'c', title: 'xap:attachments/finto.bin' }] },
    });
    const report = await validateArchiveBytes(await archive(content));
    expect(report.resourceRefs).toBe(0);
  });

  it("un'immagine (image.src) senza risorsa resta un errore", async () => {
    const content = sheetWith({ title: '', image: { src: `xap:resources/${SHA}.png`, isMathJaxImage: true } });
    await expect(validateArchiveBytes(await archive(content))).rejects.toThrow(/senza risorsa/);
  });

  it("un'immagine con la sua risorsa registrata passa", async () => {
    const content = sheetWith({ title: '', image: { src: `xap:resources/${SHA}.png` } });
    const report = await validateArchiveBytes(await archive(content, [`resources/${SHA}.png`]));
    expect(report.resourceRefs).toBe(1);
  });

  it('un src annidato (es. immagine nelle note ricche) è controllato', async () => {
    const content = sheetWith({
      title: 'x',
      notes: { realHTML: { content: { paragraphs: [{ image: { src: `xap:resources/${SHA}.png` } }] } } },
    });
    await expect(validateArchiveBytes(await archive(content))).rejects.toThrow(/senza risorsa/);
  });

  it('un link a un allegato (href) senza file resta un errore', async () => {
    const content = sheetWith({ title: 'x', href: 'xap:attachments/a.bin' });
    await expect(validateArchiveBytes(await archive(content))).rejects.toThrow(/senza allegato/);
  });
});

describe('validateArchiveBytes: content.json vuoto', () => {
  it('distingue "vuoto" da "assente"', async () => {
    await expect(validateArchiveBytes(await archive(null, [], ''))).rejects.toThrow(/content\.json è vuoto/);
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ 'file-entries': {} }));
    const missing = await zip.generateAsync({ type: 'uint8array' });
    await expect(validateArchiveBytes(missing)).rejects.toThrow(/assente/);
  });
});

describe('layoutBoundaries: range con lo spazio, come i sommari', () => {
  const metrics: NodeMetrics = { measure: () => ({ w: 100, h: 30 }) };
  function topic(id: string, parentId: string | undefined, over: Partial<TopicView> = {}): TopicView {
    return {
      id,
      sheetIndex: 0,
      parentId,
      depth: parentId ? 1 : 0,
      group: parentId ? 'attached' : '',
      title: id,
      displayTitle: id,
      kind: 'text',
      notes: '',
      labels: [],
      markers: [],
      childCount: 0,
      boundaries: [],
      summaries: [],
      ...over,
    };
  }

  it.each(['(0,1)', '(0, 1)', '(0 ,1)'])('accetta %s', (range) => {
    const topics = [topic('r', undefined, { boundaries: [{ id: 'b', range }] }), topic('a', 'r'), topic('b', 'r')];
    const sheet: SheetDto = { index: 0, title: 's', topics, relationships: [] };
    const frames = layoutBoundaries(layoutSheets([sheet], new Set(), metrics), [sheet]);
    expect(frames).toHaveLength(1);
  });
});
