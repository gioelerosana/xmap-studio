import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AppController,
  buildArchiveBytes,
  readArchive,
  sha256Hex,
  validateArchiveBytes,
} from '../src/index.js';

const DEMO_FILE = path.resolve(__dirname, '../../../demo/Relazioni.xmap-studio.xmind');

describe('XMap Studio Core - Lossless Round-Trip & Invariants', () => {
  it('opens real .xmind file without data loss', async () => {
    expect(fs.existsSync(DEMO_FILE)).toBe(true);
    const buffer = fs.readFileSync(DEMO_FILE);

    const controller = new AppController();
    const dto = await controller.open(buffer, DEMO_FILE, 'Relazioni.xmap-studio.xmind');

    expect(dto).toBeDefined();
    expect(dto.sheets.length).toBeGreaterThan(0);

    const firstSheet = dto.sheets[0];
    expect(firstSheet.topics.length).toBeGreaterThan(0);

    // Verifica che l'archivio si ricostruisca e passi la validazione di integrità
    const { bytes, validation } = await controller.prepareArchiveBytes();
    expect(bytes.length).toBeGreaterThan(0);
    expect(validation.entries).toBeGreaterThan(0);

    // Riapre i byte generati e confronta la struttura con l'originale
    const reArchive = await readArchive(bytes);
    const origArchive = await readArchive(buffer);

    const origContentStr = new TextDecoder().decode(origArchive.entries.get('content.json')!);
    const reContentStr = new TextDecoder().decode(reArchive.entries.get('content.json')!);

    const origContent = JSON.parse(origContentStr);
    const reContent = JSON.parse(reContentStr);

    expect(reContent).toEqual(origContent);
  });

  it('applies MathJax equation adhering to the 12 sacred rules', async () => {
    const buffer = fs.readFileSync(DEMO_FILE);
    const controller = new AppController();
    await controller.open(buffer, DEMO_FILE);

    const wbDto = controller.workbook()!;
    const targetTopic = wbDto.sheets[0].topics[1];
    expect(targetTopic).toBeDefined();

    const formula = '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}';
    const updatedDto = await controller.apply(targetTopic.id, formula);

    const modifiedTopic = updatedDto.sheets[0].topics.find((t) => t.id === targetTopic.id)!;
    expect(modifiedTopic.kind).toBe('equation');
    expect(modifiedTopic.latex).toBe(formula);
    expect(modifiedTopic.imageSrc).toMatch(/^xap:resources\/[a-f0-9]{64}\.png$/);

    // Recupera i byte PNG e verifica l'hash SHA-256
    const pngBytes = controller.resourceBytes(modifiedTopic.imageSrc!);
    expect(pngBytes).toBeDefined();
    expect(pngBytes!.length).toBeGreaterThan(0);

    const hash = sha256Hex(pngBytes!);
    expect(modifiedTopic.imageSrc).toBe(`xap:resources/${hash}.png`);

    // Validazione pre-salvataggio
    const { bytes, validation } = await controller.prepareArchiveBytes();
    expect(validation.resourceRefs).toBeGreaterThan(0);

    // Verifica che i byte siano un valido zip apribile
    const reValidation = await validateArchiveBytes(bytes);
    expect(reValidation.entries).toBeGreaterThan(0);
  });

  it('supports undo and redo reliably', async () => {
    const buffer = fs.readFileSync(DEMO_FILE);
    const controller = new AppController();
    await controller.open(buffer, DEMO_FILE);

    const rootId = controller.workbook()!.sheets[0].topics[0].id;

    // Aggiunge un topic
    const { dto: dto1, newId } = controller.addTopic(rootId, 'Nuovo Argomento');
    expect(dto1.sheets[0].topics.some((t) => t.id === newId)).toBe(true);
    expect(controller.isDirty()).toBe(true);

    // Undo
    const dto2 = controller.undo();
    expect(dto2.sheets[0].topics.some((t) => t.id === newId)).toBe(false);

    // Redo
    const dto3 = controller.redo();
    expect(dto3.sheets[0].topics.some((t) => t.id === newId)).toBe(true);
  });

  it('exports to Markdown, OPML and Outline correctly', async () => {
    const buffer = fs.readFileSync(DEMO_FILE);
    const controller = new AppController();
    await controller.open(buffer, DEMO_FILE);

    const md = controller.export('markdown');
    expect(md).toContain('# ');

    const opml = controller.export('opml');
    expect(opml).toContain('<opml version="2.0">');
    expect(opml).toContain('<outline ');

    const outline = controller.export('outline');
    expect(outline).toContain('• ');
  });

  it('computes logic chart layout coordinates', async () => {
    const buffer = fs.readFileSync(DEMO_FILE);
    const controller = new AppController();
    await controller.open(buffer, DEMO_FILE);

    const layout = controller.mapLayout(0);
    expect(layout).toBeDefined();
    expect(layout!.nodes.length).toBeGreaterThan(0);
    expect(layout!.width).toBeGreaterThan(100);
    expect(layout!.height).toBeGreaterThan(50);

    // Il primo nodo (radice) deve essere a sinistra
    const root = layout!.nodes[0];
    expect(root.x).toBe(20);
  });
});
