import { describe, expect, it } from 'vitest';
import {
  AppController,
  cloneTopicSubtree,
  Sheet,
  Topic,
  validateArchiveBytes,
  XMAP_CLIPBOARD_VERSION,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

describe('cloneTopicSubtree', () => {
  it('rigenera tutti gli id in modo univoco preservando tutti i campi sconosciuti', () => {
    const original: Topic = {
      id: 'topic-root',
      title: 'Original Root',
      customProp: 'custom-value',
      nestedUnknown: { a: 1, b: [2, 3] },
      image: {
        src: 'xap:resources/test-image.png',
        width: 100,
        height: 100,
      },
      children: {
        attached: [
          {
            id: 'child-1',
            title: 'Child 1',
            extraField: 42,
            children: {
              attached: [
                {
                  id: 'grandchild-1',
                  title: 'Grandchild 1',
                  deepField: true,
                },
              ],
            },
          },
        ],
      },
    };

    const cloned = cloneTopicSubtree(original);

    // ID tutti nuovi e diversi da quelli originali
    expect(cloned.id).toBeDefined();
    expect(cloned.id).not.toBe('topic-root');
    const child1 = cloned.children?.attached?.[0];
    expect(child1?.id).toBeDefined();
    expect(child1?.id).not.toBe('child-1');
    const grand1 = child1?.children?.attached?.[0];
    expect(grand1?.id).toBeDefined();
    expect(grand1?.id).not.toBe('grandchild-1');

    // Tutti gli ID sono distinti tra loro
    const ids = new Set([cloned.id, child1?.id, grand1?.id]);
    expect(ids.size).toBe(3);

    // Proprietà sconosciute preservate al 100%
    expect(cloned['customProp']).toBe('custom-value');
    expect(cloned['nestedUnknown']).toEqual({ a: 1, b: [2, 3] });
    expect(child1?.['extraField']).toBe(42);
    expect(grand1?.['deepField']).toBe(true);

    // Risorse preservate
    expect(cloned.image?.src).toBe('xap:resources/test-image.png');
  });

  it('aggiorna i riferimenti interni di summary e link interni xmind:#id', () => {
    const original: Topic = {
      id: 'parent',
      title: 'Parent',
      href: 'xmind:#child-target',
      summaries: [
        {
          id: 'summary-desc-1',
          range: '(0,1)',
          topicId: 'summary-topic-1',
        },
      ],
      children: {
        attached: [
          { id: 'child-target', title: 'Target' },
          { id: 'child-2', title: 'Sibling' },
        ],
        summary: [
          { id: 'summary-topic-1', title: 'Summary Topic' },
        ],
      },
    };

    const cloned = cloneTopicSubtree(original);

    const newTargetId = cloned.children?.attached?.[0]?.id;
    const newSummaryTopicId = cloned.children?.summary?.[0]?.id;
    const newSummaryDesc = cloned.summaries?.[0];

    expect(newTargetId).toBeDefined();
    expect(newSummaryTopicId).toBeDefined();
    expect(newSummaryDesc).toBeDefined();

    // Il descrittore di summary punta al nuovo ID del topic di summary
    expect(newSummaryDesc?.topicId).toBe(newSummaryTopicId);
    expect(newSummaryDesc?.id).not.toBe('summary-desc-1');

    // Il link interno href è stato aggiornato con il nuovo ID
    expect(cloned.href).toBe(`xmind:#${newTargetId}`);
  });
});

describe('AppController: copia, incolla e duplica blocchi', () => {
  it('copyTopic restituisce payload serializzato con versione e topic', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const payloadStr = c.copyTopic('a');
    const parsed = JSON.parse(payloadStr);

    expect(parsed.xmapStudioClipboard).toBe(XMAP_CLIPBOARD_VERSION);
    expect(parsed.topic.id).toBe('a');
    expect(parsed.topic.title).toBe('A');

    // Errore se topic non esiste
    expect(() => c.copyTopic('non-existing')).toThrow();
  });

  it('pasteTopic incolla come figlio con id nuovi e undo in un solo passo', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    const payloadStr = c.copyTopic('a');
    const { newId, dto } = c.pasteTopic('r', payloadStr);

    expect(newId).not.toBe('a');
    const rootSheet = c.workbook()!.sheets[0];
    const pasted = rootSheet.topics.find((t) => t.id === newId);
    expect(pasted).toBeDefined();
    expect(pasted?.parentId).toBe('r');
    expect(pasted?.title).toBe('A');

    // Undo ripristina lo stato precedente rimuovendo il topic incollato
    c.undo();
    expect(c.workbook()!.sheets[0].topics.some((t) => t.id === newId)).toBe(false);

    // Redo lo reinserisce
    c.redo();
    expect(c.workbook()!.sheets[0].topics.some((t) => t.id === newId)).toBe(true);
  });

  it('pasteTopic rifiuta payload non validi con errore comprensibile', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    expect(() => c.pasteTopic('r', 'invalid-json')).toThrow(/non valido/i);
    expect(() => c.pasteTopic('r', JSON.stringify({ wrong: true }))).toThrow(/non riconosciuto/i);
    expect(() => c.pasteTopic('unknown-parent', c.copyTopic('a'))).toThrow(/non trovato/i);
  });

  it('duplicateTopic duplica come fratello subito dopo con un passo di undo', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    // Aggiungiamo un secondo fratello 'b' dopo 'a'
    const { newId: bId } = c.addSiblingTopic('a', 'B', 'after');

    // Duplichiamo 'a'
    const { newId: dupId } = c.duplicateTopic('a');
    expect(dupId).not.toBe('a');

    const topics = c.workbook()!.sheets[0].topics;
    const aIdx = topics.findIndex((t) => t.id === 'a');
    const dupIdx = topics.findIndex((t) => t.id === dupId);
    const bIdx = topics.findIndex((t) => t.id === bId);

    // Il duplicato deve stare tra 'a' e 'b'
    expect(dupIdx).toBe(aIdx + 1);
    expect(bIdx).toBe(dupIdx + 1);

    // Undo rimuove il duplicato in un solo passo
    c.undo();
    expect(c.workbook()!.sheets[0].topics.some((t) => t.id === dupId)).toBe(false);
    expect(c.workbook()!.sheets[0].topics.some((t) => t.id === bId)).toBe(true);
  });

  it('duplicateTopic lancia un errore comprensibile sulla radice', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    expect(() => c.duplicateTopic('r')).toThrow(/radice non può essere duplicata/i);
  });
});

describe('copia/incolla tra file diversi', () => {
  it("porta con sé le risorse delle immagini, così il file di destinazione resta valido", async () => {
    const a = new AppController();
    await a.open(await minimalXmind());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
    const { newId } = a.addImageTopic('r', png, 'image/png', { width: 120, height: 80 });
    const payload = a.copyTopic(newId);
    expect(JSON.parse(payload).resources).toBeDefined();

    const b = new AppController();
    await b.open(await minimalXmind());
    b.pasteTopic('r', payload);
    const prepared = await b.prepareArchiveBytes();
    const report = await validateArchiveBytes(prepared.bytes);
    expect(report.resources).toBeGreaterThanOrEqual(1);
    expect(report.resourceRefs).toBeGreaterThanOrEqual(1);
  });
});
