import { describe, expect, it } from 'vitest';
import {
  addImageChild,
  AppController,
  CODE_INVALID_INPUT,
  CODE_TOPIC_NOT_FOUND,
  computeImageResourceName,
  errorCode,
  mimeToExtension,
  scaleImageSize,
  setTopicImage,
  sha256Hex,
  validateArchiveBytes,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

describe('Image topic: pure functions', () => {
  it('deduce estensioni corrette da MIME type e magic bytes', () => {
    expect(mimeToExtension('image/png')).toBe('.png');
    expect(mimeToExtension('image/jpeg')).toBe('.jpg');
    expect(mimeToExtension('image/jpg')).toBe('.jpg');
    expect(mimeToExtension('image/gif')).toBe('.gif');
    expect(mimeToExtension('image/webp')).toBe('.webp');
    expect(mimeToExtension('image/svg+xml')).toBe('.svg');
    expect(mimeToExtension('image/bmp')).toBe('.bmp');

    // Sniffing da magic bytes
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(mimeToExtension('application/octet-stream', pngBytes)).toBe('.png');

    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(mimeToExtension('', jpegBytes)).toBe('.jpg');
  });

  it('calcola nome risorsa canonico basato su SHA-256 esadecimale', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const hash = sha256Hex(bytes);
    const name = computeImageResourceName(bytes, 'image/png');
    expect(name).toBe(`resources/${hash}.png`);
  });

  it('scala correttamente le dimensioni naturali entro 400px', () => {
    // Entrambi <= 400: invariati
    expect(scaleImageSize({ width: 200, height: 150 })).toEqual({ width: 200, height: 150 });
    expect(scaleImageSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });

    // Lato orizzontale più lungo > 400
    expect(scaleImageSize({ width: 800, height: 600 })).toEqual({ width: 400, height: 300 });

    // Lato verticale più lungo > 400
    expect(scaleImageSize({ width: 300, height: 600 })).toEqual({ width: 200, height: 400 });

    // Limite personalizzato
    expect(scaleImageSize({ width: 1000, height: 500 }, 200)).toEqual({ width: 200, height: 100 });
  });

  it('addImageChild aggiunge un sotto-blocco con titolo vuoto e immagine xap:resources', () => {
    const parent: any = { id: 'p1', title: 'Genitore', customAttr: 42 };
    const res = addImageChild(parent, 'resources/abc.png', { width: 800, height: 400 });

    expect(parent.children.attached).toHaveLength(1);
    const child = parent.children.attached[0];
    expect(child.id).toBe(res.newId);
    expect(child.title).toBe('');
    expect(child.image).toEqual({
      src: 'xap:resources/abc.png',
      width: 400,
      height: 200,
    });
    // Preservati campi sconosciuti del genitore
    expect(parent.customAttr).toBe(42);
  });

  it('setTopicImage aggiorna l\'immagine preservando le chiavi extra e rimuovendo MathJax', () => {
    const topic: any = {
      id: 't1',
      title: 'Topic con stile',
      image: {
        src: 'xap:resources/old.png',
        width: 100,
        height: 100,
        align: 'center',
        borderColor: '#ff0000',
        isMathJaxImage: true,
        extraProp: 'conserva',
      },
      extensions: [{ provider: 'org.xmind.ui.mathJax', content: {} }],
    };

    setTopicImage(topic, 'resources/new.jpg', { width: 600, height: 300 });

    expect(topic.image.src).toBe('xap:resources/new.jpg');
    expect(topic.image.width).toBe(400);
    expect(topic.image.height).toBe(200);
    expect(topic.image.align).toBe('center');
    expect(topic.image.borderColor).toBe('#ff0000');
    expect(topic.image.extraProp).toBe('conserva');
    expect(topic.image.isMathJaxImage).toBeUndefined();
    expect(topic.extensions).toBeUndefined();
  });
});

describe('AppController: addImageTopic e setTopicImage', () => {
  it('addImageTopic crea un nuovo sotto-blocco, aggiunge e registra la risorsa nel manifest', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const hash = sha256Hex(fakePng);
    const expectedResource = `resources/${hash}.png`;

    const { dto, newId } = c.addImageTopic('r', fakePng, 'image/png', { width: 800, height: 600 });

    expect(newId).toBeTruthy();
    const sheet = dto.sheets[0];
    const imageTopic = sheet.topics.find((t) => t.id === newId);
    expect(imageTopic).toBeDefined();
    expect(imageTopic?.title).toBe('');
    expect(imageTopic?.parentId).toBe('r');
    expect(imageTopic?.imageSrc).toBe(`xap:${expectedResource}`);
    expect(imageTopic?.imageW).toBe(400);
    expect(imageTopic?.imageH).toBe(300);

    // Risorsa presente nell'archivio e recuperabile da resourceBytes
    const bytes = c.resourceBytes(`xap:${expectedResource}`);
    expect(bytes).toEqual(fakePng);

    // Risorsa registrata nel manifest del workbook
    const manifestEntries = (c as any).currentWorkbook.manifest?.['file-entries'];
    expect(manifestEntries?.[expectedResource]).toBeDefined();

    // Validazione dell'archivio preparato prima del salvataggio
    const prepared = await c.prepareArchiveBytes();
    const report = await validateArchiveBytes(prepared.bytes);
    expect(report.resources).toBeGreaterThanOrEqual(1);
    expect(report.resourceRefs).toBeGreaterThanOrEqual(1);
  });

  it('deduplica la risorsa se la stessa immagine viene aggiunta più volte', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x99, 0x88]);
    const hash = sha256Hex(fakePng);
    const resName = `resources/${hash}.png`;

    const res1 = c.addImageTopic('r', fakePng, 'image/png', { width: 200, height: 200 });
    const res2 = c.addImageTopic('r', fakePng, 'image/png', { width: 200, height: 200 });

    expect(res1.newId).not.toBe(res2.newId);

    // L'archivio contiene una sola istanza della risorsa
    const rawArchive = (c as any).currentWorkbook.archive;
    expect(rawArchive.resources.has(resName)).toBe(true);

    const resourceKeys = Array.from(rawArchive.resources.keys()).filter((k) => k === resName);
    expect(resourceKeys).toHaveLength(1);

    const prepared = await c.prepareArchiveBytes();
    await validateArchiveBytes(prepared.bytes);
  });

  it('preserva campi sconosciuti su sheet e topics durante il round-trip', async () => {
    const customSheets = [
      {
        id: 's1',
        class: 'sheet',
        title: 'Foglio',
        customSheetField: 'valore_speciale',
        rootTopic: {
          id: 'r',
          class: 'topic',
          title: 'Radice',
          customTopicField: { nested: 123 },
          children: {
            attached: [
              {
                id: 'c1',
                title: 'Figlio 1',
                customChildProp: [1, 2, 3],
              },
            ],
          },
        },
      },
    ];

    const c = new AppController();
    await c.open(await minimalXmind(customSheets));

    const fakeJpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22]);
    const { newId } = c.addImageTopic('c1', fakeJpg, 'image/jpeg', { width: 500, height: 500 });

    const root = (c as any).currentWorkbook.content[0].rootTopic;
    expect(root.customTopicField).toEqual({ nested: 123 });
    expect((c as any).currentWorkbook.content[0].customSheetField).toBe('valore_speciale');

    const c1 = root.children.attached[0];
    expect(c1.customChildProp).toEqual([1, 2, 3]);

    const imgChild = c1.children.attached[0];
    expect(imgChild.id).toBe(newId);
    expect(imgChild.image.src).toMatch(/^xap:resources\/[a-f0-9]{64}\.jpg$/);

    const prepared = await c.prepareArchiveBytes();
    await validateArchiveBytes(prepared.bytes);
  });

  it('setTopicImage sostituisce l\'immagine su un blocco esistente', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
    const dto = c.setTopicImage('a', fakePng, 'image/png', { width: 300, height: 200 });

    const topicA = dto.sheets[0].topics.find((t) => t.id === 'a');
    expect(topicA?.imageSrc).toMatch(/^xap:resources\/[a-f0-9]{64}\.png$/);
    expect(topicA?.imageW).toBe(300);
    expect(topicA?.imageH).toBe(200);

    const prepared = await c.prepareArchiveBytes();
    await validateArchiveBytes(prepared.bytes);
  });

  it('supporta l\'annullamento (undo) in un solo passaggio', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x44, 0x55]);
    const { newId } = c.addImageTopic('r', fakePng, 'image/png', { width: 400, height: 400 });

    expect(c.workbook()?.sheets[0].topics.some((t) => t.id === newId)).toBe(true);

    c.undo();
    expect(c.workbook()?.sheets[0].topics.some((t) => t.id === newId)).toBe(false);

    c.redo();
    expect(c.workbook()?.sheets[0].topics.some((t) => t.id === newId)).toBe(true);
  });

  it('lancia eccezioni su input non validi', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());

    const fakePng = new Uint8Array([1, 2, 3]);

    // Parent inesistente
    expect(() => c.addImageTopic('non-esistente', fakePng, 'image/png', { width: 100, height: 100 })).toThrowError();
    try {
      c.addImageTopic('non-esistente', fakePng, 'image/png', { width: 100, height: 100 });
    } catch (err) {
      expect(errorCode(err)).toBe(CODE_TOPIC_NOT_FOUND);
    }

    // Buffer vuoto
    expect(() => c.addImageTopic('r', new Uint8Array(0), 'image/png', { width: 100, height: 100 })).toThrowError();
    try {
      c.addImageTopic('r', new Uint8Array(0), 'image/png', { width: 100, height: 100 });
    } catch (err) {
      expect(errorCode(err)).toBe(CODE_INVALID_INPUT);
    }

    // setTopicImage su topic inesistente
    try {
      c.setTopicImage('non-esistente', fakePng, 'image/png', { width: 100, height: 100 });
    } catch (err) {
      expect(errorCode(err)).toBe(CODE_TOPIC_NOT_FOUND);
    }
  });
});
