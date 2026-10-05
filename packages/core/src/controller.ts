import { buildArchiveBytes, readArchive } from './archive/archive.js';
import { atomicWrite } from './archive/atomic.js';
import { RawArchive } from './archive/types.js';
import {
  addChild,
  addRelationship,
  addSummary,
  addBoundary,
  MovePlacement,
  moveTopic,
  removeBoundary,
  removeRelationship,
  removeSummary,
  removeTopic,
  setHref,
  setLabels,
  setNotes,
  setNotesDisplay,
  setTitle,
  toggleMarker,
} from './model/edit.js';
import { Sheet, Topic } from './model/types.js';
import {
  countTopics,
  findTopic,
  fontSizePx,
  newTopicId,
  remapIds,
  setFillColor,
  sheetIndexOf,
  topicLatex,
  topicTitle,
  walkTopic,
} from './model/utils.js';
import { applyEquation, removeEquation, TitleMode } from './latex/equation.js';
import { renderLatexToSvg } from './latex/mathjax.js';
import { svgToPng } from './latex/raster.js';
import { clearTask, writeTask, TaskData } from './task/task.js';
import { refreshManifest } from './safety/manifest.js';
import { xmindProcesses } from './safety/process.js';
import { validateArchiveBytes, ValidationReport } from './safety/validate.js';
import { toMarkdown } from './exporters/markdown.js';
import { toOPML } from './exporters/opml.js';
import { toOutline } from './exporters/outline.js';
import { importToSheet } from './exporters/import.js';
import { Layout } from './layout/types.js';
import { layoutSheets } from './layout/layout.js';
import {
  BatchResultDto,
  BatchSpec,
  MergeResultDto,
  SaveResultDto,
  WorkbookDto,
} from './state/types.js';
import { OpenWorkbook } from './state/workbook.js';

export class AppController {
  private currentWorkbook: OpenWorkbook | null = null;

  public workbook(): WorkbookDto | null {
    return this.currentWorkbook ? this.currentWorkbook.toDto() : null;
  }

  public isOpen(): boolean {
    return this.currentWorkbook !== null;
  }

  public isDirty(): boolean {
    return this.currentWorkbook ? this.currentWorkbook.isDirty() : false;
  }

  public resourceBytes(src: string): Uint8Array | null {
    if (!this.currentWorkbook) return null;
    let clean = src.startsWith('xap:') ? src.slice(4) : src;
    if (clean.startsWith('/')) clean = clean.slice(1);

    if (this.currentWorkbook.archive.resources.has(clean)) {
      return this.currentWorkbook.archive.resources.get(clean)!;
    }
    if (this.currentWorkbook.archive.entries.has(clean)) {
      return this.currentWorkbook.archive.entries.get(clean)!;
    }
    return null;
  }

  public mapTitle(): string | null {
    if (!this.currentWorkbook) return null;
    const firstSheet = this.currentWorkbook.content[0];
    if (!firstSheet) return null;
    return (
      (firstSheet.rootTopic ? topicTitle(firstSheet.rootTopic) : '') ||
      firstSheet.title ||
      this.currentWorkbook.fileName
    );
  }

  public async open(
    data: ArrayBuffer | Uint8Array,
    path: string = 'workbook.xmind',
    fileName?: string
  ): Promise<WorkbookDto> {
    const archive = await readArchive(data);
    const contentBytes = archive.entries.get('content.json');
    if (!contentBytes) {
      throw new Error('content.json assente');
    }
    const contentStr = new TextDecoder('utf-8').decode(contentBytes);
    const content: Sheet[] = JSON.parse(contentStr);

    let manifest: Record<string, unknown> = {};
    const manifestBytes = archive.entries.get('manifest.json');
    if (manifestBytes) {
      try {
        manifest = JSON.parse(new TextDecoder('utf-8').decode(manifestBytes));
      } catch {
        manifest = { 'file-entries': {} };
      }
    }

    const running = await xmindProcesses();
    const name = fileName || path.split('/').pop() || 'workbook.xmind';

    this.currentWorkbook = new OpenWorkbook(path, name, archive, content, manifest, running);
    return this.currentWorkbook.toDto();
  }

  public async openPath(filePath: string): Promise<WorkbookDto> {
    const fs = await import('node:fs');
    const pathMod = await import('node:path');
    const resolved = pathMod.resolve(filePath);
    const buffer = fs.readFileSync(resolved);
    return await this.open(buffer, resolved, pathMod.basename(resolved));
  }

  public preview(latex: string, emPx: number = 23.33) {
    return renderLatexToSvg(latex, emPx);
  }

  private ensureWorkbook(): OpenWorkbook {
    if (!this.currentWorkbook) {
      throw new Error('Nessun workbook aperto');
    }
    return this.currentWorkbook;
  }

  public async apply(
    topicId: string,
    latex: string,
    options: {
      titleMode?: TitleMode;
      fontSizePx?: number;
      color?: string;
    } = {}
  ): Promise<WorkbookDto> {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) {
      throw new Error(`Topic ${topicId} non trovato`);
    }

    const fontPx = options.fontSizePx ?? fontSizePx(topic);
    const emPx = fontPx ? fontPx * 1.25 : 23.33;

    const { outcome, png } = await applyEquation(topic, latex, {
      emPx,
      titleMode: options.titleMode,
      color: options.color,
    });

    wb.archive.resources.set(outcome.resource, png);
    wb.pushHistory();
    return wb.toDto();
  }

  public async applyBatch(specs: BatchSpec[]): Promise<BatchResultDto> {
    const wb = this.ensureWorkbook();
    let modified = 0;
    const errors: { topicId: string; error: string }[] = [];

    for (const spec of specs) {
      const topic = findTopic(wb.content, spec.topicId);
      if (!topic) {
        errors.push({ topicId: spec.topicId, error: 'Topic non trovato' });
        continue;
      }
      try {
        const fontPx = spec.fontSizePx ?? fontSizePx(topic);
        const emPx = fontPx ? fontPx * 1.25 : 23.33;
        const { outcome, png } = await applyEquation(topic, spec.latex, {
          emPx,
          color: spec.color,
        });
        wb.archive.resources.set(outcome.resource, png);
        modified++;
      } catch (err: any) {
        errors.push({ topicId: spec.topicId, error: err.message || String(err) });
      }
    }

    if (modified > 0) {
      wb.pushHistory();
    }

    return {
      modified,
      totalLatex: specs.length,
      errors,
    };
  }

  public removeEquation(topicId: string, title?: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    removeEquation(topic, title);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicTitle(topicId: string, title: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    setTitle(topic, title);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicNotes(topicId: string, text: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    setNotes(topic, text);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicNotesDisplay(topicId: string, display?: 'icon' | 'block' | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    setNotesDisplay(topic, display);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicLabels(topicId: string, labels: string[]): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    setLabels(topic, labels);
    wb.pushHistory();
    return wb.toDto();
  }

  public toggleTopicMarker(topicId: string, markerId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    toggleMarker(topic, markerId);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicHref(topicId: string, href?: string | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    setHref(topic, href);
    wb.pushHistory();
    return wb.toDto();
  }

  public addTopic(parentId: string, title: string): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const parent = findTopic(wb.content, parentId);
    if (!parent) throw new Error(`Parent topic ${parentId} non trovato`);

    const newId = addChild(parent, title);
    wb.pushHistory();
    return { dto: wb.toDto(), newId };
  }

  public removeTopic(topicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const removed = removeTopic(wb.content, topicId);
    if (!removed) {
      throw new Error(`Impossibile rimuovere il topic ${topicId} (o è la radice)`);
    }
    wb.pushHistory();
    return wb.toDto();
  }

  public moveTopic(topicId: string, targetId: string, placement: MovePlacement): WorkbookDto {
    const wb = this.ensureWorkbook();
    moveTopic(wb.content, topicId, targetId, placement);
    wb.pushHistory();
    return wb.toDto();
  }

  public undo(): WorkbookDto {
    const wb = this.ensureWorkbook();
    wb.undo();
    return wb.toDto();
  }

  public redo(): WorkbookDto {
    const wb = this.ensureWorkbook();
    wb.redo();
    return wb.toDto();
  }

  public addTopicRelationship(end1Id: string, end2Id: string, title?: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const sheetIdx = sheetIndexOf(wb.content, end1Id);
    if (sheetIdx === -1) throw new Error(`Topic ${end1Id} non trovato`);
    const sheet = wb.content[sheetIdx];

    addRelationship(sheet, end1Id, end2Id, title);
    wb.pushHistory();
    return wb.toDto();
  }

  public removeTopicRelationship(relationshipId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    for (const sheet of wb.content) {
      if (removeRelationship(sheet, relationshipId)) {
        wb.pushHistory();
        return wb.toDto();
      }
    }
    throw new Error(`Relazione ${relationshipId} non trovata`);
  }

  public addTopicBoundary(topicId: string, start: number, end: number, title?: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    addBoundary(topic, start, end, title);
    wb.pushHistory();
    return wb.toDto();
  }

  public removeTopicBoundary(topicId: string, boundaryId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    if (!removeBoundary(topic, boundaryId)) {
      throw new Error(`Boundary ${boundaryId} non trovato`);
    }
    wb.pushHistory();
    return wb.toDto();
  }

  public addTopicSummary(topicId: string, start: number, end: number, title: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    addSummary(topic, start, end, title);
    wb.pushHistory();
    return wb.toDto();
  }

  public removeTopicSummary(topicId: string, summaryTopicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    if (!removeSummary(topic, summaryTopicId)) {
      throw new Error(`Summary ${summaryTopicId} non trovato`);
    }
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicColor(topicId: string, color?: string | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    setFillColor(topic, color);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicTask(topicId: string, task: TaskData): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    writeTask(topic, task);
    wb.pushHistory();
    return wb.toDto();
  }

  public clearTopicTask(topicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    clearTask(topic);
    wb.pushHistory();
    return wb.toDto();
  }

  public attachFileToTopic(topicId: string, fileName: string, fileBytes: Uint8Array): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    const ext = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '.bin';
    const attachmentPath = `attachments/${newTopicId()}${ext}`;

    wb.archive.entries.set(attachmentPath, fileBytes);
    setHref(topic, `xap:${attachmentPath}`);
    wb.pushHistory();
    return wb.toDto();
  }

  public export(format: 'markdown' | 'opml' | 'outline'): string {
    const wb = this.ensureWorkbook();
    switch (format) {
      case 'markdown':
        return toMarkdown(wb.content);
      case 'opml':
        return toOPML(wb.content, this.mapTitle() || 'Mappa');
      case 'outline':
        return toOutline(wb.content);
      default:
        throw new Error(`Formato sconosciuto: ${format}`);
    }
  }

  /**
   * Esporta l'equazione del topic selezionato come SVG o PNG, senza toccare
   * l'archivio. Il PNG usa lo stesso rasterizzatore del salvataggio.
   */
  public async exportEquation(
    topicId: string,
    format: 'svg' | 'png'
  ): Promise<{ bytes: Uint8Array; mime: string; extension: string }> {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    const latex = topicLatex(topic);
    if (!latex) throw new Error('Il blocco selezionato non contiene un\'equazione');

    const fontPx = fontSizePx(topic);
    const emPx = fontPx ? fontPx * 1.25 : 23.33;
    const render = renderLatexToSvg(latex, emPx);
    if (render.error) throw new Error(`LaTeX non valido: ${render.error}`);

    if (format === 'svg') {
      return {
        bytes: new TextEncoder().encode(render.svg),
        mime: 'image/svg+xml',
        extension: 'svg',
      };
    }

    const png = await svgToPng(render.svg, render.width, render.height, 3.0, '#000000');
    return { bytes: png, mime: 'image/png', extension: 'png' };
  }

  public outlineText(): string | null {
    if (!this.currentWorkbook) return null;
    return toOutline(this.currentWorkbook.content);
  }

  public mapLayout(sheetIndex: number = 0, collapsed: Set<string> = new Set()): Layout | null {
    if (!this.currentWorkbook) return null;
    const dto = this.currentWorkbook.toDto();
    const sheet = dto.sheets[sheetIndex];
    if (!sheet) return null;
    return layoutSheets([sheet], collapsed);
  }

  public async importOutline(
    format: 'markdown' | 'opml' | string,
    text: string,
    options: { asNewSheet?: boolean } = {}
  ): Promise<WorkbookDto> {
    const wb = this.ensureWorkbook();
    const importedSheet = await importToSheet(format, text, async (t, latex) => {
      const { outcome, png } = await applyEquation(t, latex);
      wb.archive.resources.set(outcome.resource, png);
    });

    if (options.asNewSheet || wb.content.length === 0) {
      wb.content.push(importedSheet);
    } else {
      // Inserisci come figlio della radice del primo sheet
      const root = wb.content[0].rootTopic;
      if (root && importedSheet.rootTopic) {
        if (!root.children) root.children = {};
        if (!root.children.attached) root.children.attached = [];
        root.children.attached.push(importedSheet.rootTopic);
      } else {
        wb.content[0] = importedSheet;
      }
    }

    wb.pushHistory();
    return wb.toDto();
  }

  public async mergeWorkbook(otherBytes: Uint8Array): Promise<MergeResultDto> {
    const wb = this.ensureWorkbook();
    const otherArchive = await readArchive(otherBytes);
    const otherContentBytes = otherArchive.entries.get('content.json');
    if (!otherContentBytes) throw new Error('content.json assente nel file da unire');

    const otherSheets: Sheet[] = JSON.parse(new TextDecoder().decode(otherContentBytes));
    if (otherSheets.length === 0) throw new Error('Il file da unire non contiene fogli');

    // Riassegna gli id per evitare collisioni tra file indipendenti.
    remapIds(otherSheets);
    const addedTopics = countTopics(otherSheets);

    let addedResources = 0;
    for (const [name, bytes] of otherArchive.resources) {
      if (!wb.archive.resources.has(name)) {
        wb.archive.resources.set(name, bytes);
        addedResources++;
      }
    }

    const addedSheets = otherSheets.length;
    for (const s of otherSheets) {
      wb.content.push(s);
    }

    wb.pushHistory();
    return {
      addedSheets,
      addedTopics,
      totalSheets: wb.content.length,
      addedResources,
    };
  }

  public async splitTopic(topicId: string): Promise<Uint8Array> {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new Error(`Topic ${topicId} non trovato`);

    // Raccoglie tutte le risorse referenziate dal sotto-albero
    const refs = new Set<string>();
    walkTopic(topic, (t) => {
      if (t.image?.src?.startsWith('xap:resources/')) {
        refs.add(t.image.src.slice(14));
      }
    });

    const newArchive: RawArchive = {
      entries: new Map(),
      resources: new Map(),
    };

    for (const ref of refs) {
      const resPath = `resources/${ref}`;
      const bytes = wb.archive.resources.get(resPath);
      if (bytes) {
        newArchive.resources.set(resPath, bytes);
      }
    }

    const newSheet: Sheet = {
      id: newTopicId(),
      class: 'sheet',
      title: topicTitle(topic) || 'Mappa Estratta',
      rootTopic: JSON.parse(JSON.stringify(topic)),
    };

    const manifestObj = refreshManifest({}, newArchive.resources.keys(), true);
    newArchive.entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifestObj)));
    newArchive.entries.set('content.json', new TextEncoder().encode(JSON.stringify([newSheet])));
    newArchive.entries.set(
      'metadata.json',
      new TextEncoder().encode(JSON.stringify({ creator: { name: 'XMap Studio', version: '2.0' } }))
    );

    return await buildArchiveBytes(newArchive);
  }

  /**
   * Prepara i byte finali con content.json serializzato, manifest aggiornato e thumbnail rimossa.
   * Esegue la validazione in memoria prima della scrittura.
   */
  public async prepareArchiveBytes(): Promise<{ bytes: Uint8Array; validation: ValidationReport }> {
    const wb = this.ensureWorkbook();

    // Rimuove thumbnail obsoleta (Regola 9)
    wb.archive.entries.delete('Thumbnails/thumbnail.png');

    // Aggiorna manifest con tutte le risorse attuali e dropThumbnail
    const updatedManifest = refreshManifest(wb.manifest, wb.archive.resources.keys(), true);
    wb.manifest = updatedManifest;

    wb.archive.entries.set(
      'manifest.json',
      new TextEncoder().encode(JSON.stringify(updatedManifest))
    );
    wb.archive.entries.set(
      'content.json',
      new TextEncoder().encode(JSON.stringify(wb.content))
    );

    const bytes = await buildArchiveBytes(wb.archive);
    const validation = await validateArchiveBytes(bytes);

    return { bytes, validation };
  }

  /**
   * Segna il workbook come salvato dopo che i byte sono stati scritti da un
   * adapter esterno (Electron IPC, File System Access API). Opzionalmente
   * aggiorna il percorso (Salva con nome).
   */
  public markSaved(path?: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    wb.markSaved(path);
    return wb.toDto();
  }

  public async save(force: boolean = false, desktopFs: boolean = false): Promise<SaveResultDto> {
    const wb = this.ensureWorkbook();

    if (!force) {
      const running = await xmindProcesses();
      if (running.length > 0) {
        throw new Error(
          `XMind è in esecuzione in background (${running.join(', ')}). Chiudi XMind o forza il salvataggio.`
        );
      }
    }

    const { bytes, validation } = await this.prepareArchiveBytes();

    let backup: string | undefined;
    if (desktopFs && typeof process !== 'undefined' && process.versions?.node) {
      const report = await atomicWrite(wb.path, bytes, true);
      backup = report.backup;
    }

    wb.markSaved();

    return {
      path: wb.path,
      backup,
      bytes: bytes.length,
      validation,
    };
  }

  public async saveAs(
    newPath: string,
    force: boolean = false,
    desktopFs: boolean = false
  ): Promise<SaveResultDto> {
    const wb = this.ensureWorkbook();
    wb.path = newPath;
    wb.fileName = newPath.split('/').pop() || newPath;
    return await this.save(force, desktopFs);
  }
}
