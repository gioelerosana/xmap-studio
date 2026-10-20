import {
  AddImageTopicOptions,
  addImageChild,
  computeImageResourceName,
  setTopicImage,
} from './model/image.js';
import {
  CODE_FORMAT,
  CODE_INVALID_INPUT,
  CODE_IO,
  CODE_LATEX,
  CODE_MOVE,
  CODE_NO_PATH,
  CODE_NO_WORKBOOK,
  CODE_TOPIC_NOT_FOUND,
  CODE_VALIDATION,
  CODE_XMIND_RUNNING,
  XmapError,
} from './errors.js';
import { buildArchiveBytes, readArchive, sha256HexAsync } from './archive/archive.js';
import { RawArchive } from './archive/types.js';
import type { Platform } from './platform.js';
import {
  base64ToBytes,
  bytesToBase64,
  cloneTopicSubtree,
  subtreeResourceNames,
  XMAP_CLIPBOARD_VERSION,
  XmapClipboardPayload,
} from './model/clone.js';
import {
  addChild,
  insertSibling,
  insertSiblingTopic,
  addRelationship,
  addSummary,
  addBoundary,
  MovePlacement,
  moveTopic,
  removeBoundary,
  removeRelationship,
  removeSummary,
  removeTopic,
  removeTopicKeepChildren,
  setHref,
  setLabels,
  setNotes,
  setTopicPosition,
  setTopicCustomWidth,
  setTopicImageSize,
  isDetachedTopic,
  setNotesDisplay,
  setTitle,
  toggleMarker,
  siblingRange,
  SiblingRange,
} from './model/edit.js';
import { Sheet, Topic } from './model/types.js';
import { setTitleRuns, setTextStyle, TextStylePatch } from './model/style.js';
import { setRelationshipControlPoint, setRelationshipShape } from './model/relationship.js';
import {
  countTopics,
  collectAttachmentRefs,
  collectResourceRefs,
  findTopic,
  fontSizePx,
  newTopicId,
  remapIds,
  remapAttachmentRefs,
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
import { isMarkerKnown } from './markers/catalog.js';
import { refreshManifest, registerEntries } from './safety/manifest.js';
import { validateArchiveBytes, ValidationReport } from './safety/validate.js';
import { toMarkdown } from './exporters/markdown.js';
import { toOPML } from './exporters/opml.js';
import { toOutline } from './exporters/outline.js';
import { importToSheet } from './exporters/import.js';
import { Layout, MapStructure } from './layout/types.js';
import { DEFAULT_LAYOUT_OPTS, layoutSheets } from './layout/layout.js';
import {
  BatchResultDto,
  BatchSpec,
  MergeResultDto,
  Point,
  RelationshipShape,
  SaveResultDto,
  TitleRun,
  WorkbookDto,
} from './state/types.js';
import { cloneSheets, OpenWorkbook } from './state/workbook.js';

export class AppController {
  private currentWorkbook: OpenWorkbook | null = null;
  /** Ultimo blocco creato e posizione di cronologia in cui è nato (per fondere creazione e rinomina). */
  private lastCreated: { id: string; wb: OpenWorkbook; pos: number } | null = null;

  /**
   * `platform` abilita lettura/scrittura su disco e il rilevamento di XMind;
   * senza (es. nel browser) il salvataggio passa da `prepareArchiveBytes()`.
   */
  constructor(private readonly platform?: Platform) {}

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
    path?: string | null,
    fileName?: string
  ): Promise<WorkbookDto> {
    const archive = await readArchive(data);
    const contentBytes = archive.entries.get('content.json');
    if (!contentBytes) {
      throw new XmapError(CODE_FORMAT, 'content.json assente');
    }
    const contentStr = new TextDecoder('utf-8').decode(contentBytes);
    const parsedContent: unknown = JSON.parse(contentStr);
    if (!Array.isArray(parsedContent)) {
      throw new XmapError(CODE_FORMAT, 'content.json non è un array di fogli');
    }
    const content = parsedContent as Sheet[];

    let manifest: Record<string, unknown> = {};
    const manifestBytes = archive.entries.get('manifest.json');
    if (manifestBytes) {
      try {
        manifest = JSON.parse(new TextDecoder('utf-8').decode(manifestBytes));
      } catch {
        manifest = { 'file-entries': {} };
      }
    }

    const running = this.platform ? await this.platform.xmindProcesses() : [];
    // Senza percorso il workbook non ha una destinazione su disco: il primo
    // salvataggio deve passare da "Salva con nome".
    const resolvedPath = path ?? null;
    const name =
      fileName || (resolvedPath ? resolvedPath.split(/[\\/]/).pop() : '') || 'workbook.xmind';

    const originalHash = await sha256HexAsync(data instanceof Uint8Array ? data : new Uint8Array(data));
    this.currentWorkbook = new OpenWorkbook(
      resolvedPath,
      name,
      archive,
      content,
      manifest,
      running,
      originalHash
    );
    return this.currentWorkbook.toDto();
  }

  public async openPath(filePath: string): Promise<WorkbookDto> {
    const platform = this.requirePlatform();
    const resolved = platform.resolvePath ? platform.resolvePath(filePath) : filePath;
    const bytes = await platform.readFile(resolved);
    return await this.open(bytes, resolved);
  }

  public preview(latex: string, emPx: number = 23.33) {
    return renderLatexToSvg(latex, emPx);
  }

  private ensureWorkbook(): OpenWorkbook {
    if (!this.currentWorkbook) {
      throw new XmapError(CODE_NO_WORKBOOK, 'Nessun workbook aperto');
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
      throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);
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
    if (specs.length === 0) throw new XmapError(CODE_INVALID_INPUT, 'Nessuna equazione da applicare.');

    const working = cloneSheets(wb.content);
    const pendingResources: Array<[string, Uint8Array]> = [];
    const errors: { topicId: string; error: string }[] = [];

    for (const spec of specs) {
      const topic = findTopic(working, spec.topicId);
      if (!topic) {
        errors.push({ topicId: spec.topicId, error: 'Topic non trovato' });
        break;
      }
      try {
        const fontPx = spec.fontSizePx ?? fontSizePx(topic);
        const emPx = fontPx ? fontPx * 1.25 : 23.33;
        const { outcome, png } = await applyEquation(topic, spec.latex, {
          emPx,
          titleMode: spec.titleMode,
          color: spec.color,
        });
        pendingResources.push([outcome.resource, png]);
      } catch (err: unknown) {
        errors.push({
          topicId: spec.topicId,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    if (errors.length > 0) {
      return { modified: 0, totalLatex: specs.length, errors };
    }

    wb.content = working;
    for (const [name, bytes] of pendingResources) wb.archive.resources.set(name, bytes);
    wb.pushHistory();

    return {
      modified: specs.length,
      totalLatex: specs.length,
      errors,
    };
  }

  public removeEquation(topicId: string, title?: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    removeEquation(topic, title);
    wb.pushHistory();
    return wb.toDto();
  }

  /**
   * Imposta il titolo; senza cambiamenti non registra un passo di cronologia.
   * Con `mergeWithPrevious` e solo se l'ultimo passo è la creazione di quel topic
   * (`addTopic`/`addSiblingTopic`), sostituisce l'ultimo snapshot: creazione e
   * rinomina si annullano con un solo undo.
   */
  public setTopicTitle(
    topicId: string,
    title: string,
    opts?: { mergeWithPrevious?: boolean }
  ): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    if (topic.title === title && topic.titleUnedited === undefined) return wb.toDto();
    setTitle(topic, title);
    const lc = this.lastCreated;
    if (opts?.mergeWithPrevious && lc && lc.id === topicId && lc.wb === wb && lc.pos === wb.pos) {
      wb.replaceHistoryTop();
    } else {
      wb.pushHistory();
    }
    return wb.toDto();
  }

  /**
   * Imposta il titolo con formattazione parziale (`attributedTitle`).
   * Stessa semantica di cronologia di `setTopicTitle`: senza cambiamenti
   * non registra un passo; con `mergeWithPrevious` sostituisce l'ultimo snapshot
   * se era la creazione del blocco.
   */
  public setTopicTitleRuns(
    topicId: string,
    runs: TitleRun[],
    opts?: { mergeWithPrevious?: boolean }
  ): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    const prevTitle = topic.title;
    const prevAttributed = JSON.stringify(topic.attributedTitle);
    const prevUnedited = topic.titleUnedited;

    setTitleRuns(topic, runs);

    const nextTitle = topic.title;
    const nextAttributed = JSON.stringify(topic.attributedTitle);

    if (prevTitle === nextTitle && prevAttributed === nextAttributed && prevUnedited === undefined) {
      return wb.toDto();
    }

    const lc = this.lastCreated;
    if (opts?.mergeWithPrevious && lc && lc.id === topicId && lc.wb === wb && lc.pos === wb.pos) {
      wb.replaceHistoryTop();
    } else {
      wb.pushHistory();
    }
    return wb.toDto();
  }

  /** Grassetto, corsivo, sottolineato, barrato, colore e dimensione del blocco intero. */
  public setTopicTextStyle(topicId: string, patch: TextStylePatch): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setTextStyle(topic, patch);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicNotes(topicId: string, text: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setNotes(topic, text);
    wb.pushHistory();
    return wb.toDto();
  }

  /** Sposta un topic libero (gruppo `detached`); `pos` è relativa al centro della radice. */
  public setTopicPosition(topicId: string, pos: { x: number; y: number }): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);
    if (!isDetachedTopic(wb.content, topicId)) {
      throw new XmapError(CODE_MOVE, 'Solo i topic liberi possono essere posizionati.');
    }

    setTopicPosition(topic, pos);
    wb.pushHistory();
    return wb.toDto();
  }
  /**
   * Imposta o rimuove la larghezza manuale del blocco (`customWidth`).
   * Passando `null` rimuove la larghezza manuale tornando all'adattamento automatico.
   */
  public setTopicCustomWidth(topicId: string, width: number | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setTopicCustomWidth(topic, width);
    wb.pushHistory();
    return wb.toDto();
  }

  /**
   * Imposta le dimensioni in pixel dell'immagine associata al blocco,
   * preservando tutte le altre proprietà di `image`.
   */
  public setTopicImageSize(
    topicId: string,
    size: { width: number; height: number }
  ): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setTopicImageSize(topic, size);
    wb.pushHistory();
    return wb.toDto();
  }


  public setTopicNotesDisplay(topicId: string, display?: 'icon' | 'block' | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setNotesDisplay(topic, topic.notes ? display : null);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicLabels(topicId: string, labels: string[]): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setLabels(topic, labels);
    wb.pushHistory();
    return wb.toDto();
  }

  public toggleTopicMarker(topicId: string, markerId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    const id = markerId.trim();
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new XmapError(CODE_INVALID_INPUT, 'Id marker non valido.');
    }
    const alreadyPresent = topic.markers?.some((marker) => marker.markerId === id) ?? false;
    if (!alreadyPresent && !isMarkerKnown(id)) {
      throw new XmapError(CODE_INVALID_INPUT, `Marker sconosciuto: ${id}`);
    }

    toggleMarker(topic, id);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicHref(topicId: string, href?: string | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setHref(topic, href);
    wb.pushHistory();
    return wb.toDto();
  }

  public addTopic(parentId: string, title: string): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const parent = findTopic(wb.content, parentId);
    if (!parent) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Parent topic ${parentId} non trovato`);

    const newId = addChild(parent, title);
    wb.pushHistory();
    this.lastCreated = { id: newId, wb, pos: wb.pos };
    return { dto: wb.toDto(), newId };
  }

  /**
   * Nuovo fratello di `topicId` (dopo o prima). Sulla radice, che non ha fratelli,
   * ripiega su un nuovo figlio. Un solo passo di cronologia.
   */
  public addSiblingTopic(
    topicId: string,
    title: string,
    where: 'after' | 'before' = 'after'
  ): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);
    if (wb.content.some((s) => s.rootTopic?.id === topicId)) {
      return this.addTopic(topicId, title);
    }
    const newId = insertSibling(wb.content, topicId, title, where);
    wb.pushHistory();
    this.lastCreated = { id: newId, wb, pos: wb.pos };
    return { dto: wb.toDto(), newId };
  }

  /**
   * Copia un topic (e il suo intero sottoalbero) serializzandolo come payload JSON
   * con marcatore { xmapStudioClipboard: 1, topic }.
   */
  public copyTopic(topicId: string): string {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);
    const resources: Record<string, string> = {};
    for (const name of subtreeResourceNames(topic)) {
      const bytes = wb.archive.resources.get(name);
      if (bytes) resources[name] = bytesToBase64(bytes);
    }
    const payload: XmapClipboardPayload = {
      xmapStudioClipboard: XMAP_CLIPBOARD_VERSION,
      topic,
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
    };
    return JSON.stringify(payload);
  }

  /**
   * Incolla un topic copiato come sotto-blocco del blocco `parentId`.
   * Rigenera tutti gli id del sottoalbero preservando le proprietà sconosciute e
   * la coerenza dei riferimenti interni (sommari, ecc.).
   * Le risorse referenziate (image.src xap:resources/…) restano valide perché incolli
   * nello stesso file; se il payload viene da un altro file e la risorsa manca,
   * conserva comunque il riferimento per non perdere dati.
   */
  public pasteTopic(
    parentId: string,
    payload: string | XmapClipboardPayload
  ): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const parent = findTopic(wb.content, parentId);
    if (!parent) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic genitore ${parentId} non trovato`);

    let data: XmapClipboardPayload;
    if (typeof payload === "string") {
      try {
        data = JSON.parse(payload) as XmapClipboardPayload;
      } catch {
        throw new XmapError(
          CODE_INVALID_INPUT,
          "Dati negli appunti non validi: formato JSON non valido."
        );
      }
    } else {
      data = payload;
    }

    if (
      !data ||
      typeof data !== "object" ||
      typeof data.xmapStudioClipboard !== "number" ||
      !data.topic ||
      typeof data.topic !== "object"
    ) {
      throw new XmapError(
        CODE_INVALID_INPUT,
        "Dati negli appunti non validi: blocco XMap Studio non riconosciuto."
      );
    }

    // Le risorse mancanti (blocco copiato da un altro file) si aggiungono all'archivio,
    // altrimenti la validazione prima del salvataggio fallirebbe.
    const added: string[] = [];
    if (data.resources && typeof data.resources === 'object') {
      for (const [name, b64] of Object.entries(data.resources)) {
        if (!name.startsWith('resources/') || typeof b64 !== 'string') continue;
        if (wb.archive.resources.has(name)) continue;
        try {
          wb.archive.resources.set(name, base64ToBytes(b64));
          added.push(name);
        } catch {
          throw new XmapError(CODE_INVALID_INPUT, 'Dati negli appunti non validi: immagine danneggiata.');
        }
      }
    }
    if (added.length > 0) refreshManifest(wb.manifest, added, false);

    const cloned = cloneTopicSubtree(data.topic);
    if (!parent.children) {
      parent.children = {};
    }
    if (!parent.children.attached) {
      parent.children.attached = [];
    }
    parent.children.attached.push(cloned);

    wb.pushHistory();
    this.lastCreated = { id: cloned.id!, wb, pos: wb.pos };
    return { dto: wb.toDto(), newId: cloned.id! };
  }

  /**
   * Duplica un blocco (e il suo sottoalbero), inserendo la copia come blocco fratello subito dopo.
   * Lancia un errore comprensibile se chiamato sulla radice (non ha fratelli).
   * Un unico passo di cronologia undo.
   */
  public duplicateTopic(topicId: string): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    if (wb.content.some((s) => s.rootTopic?.id === topicId)) {
      throw new XmapError(CODE_MOVE, "La radice non può essere duplicata come blocco fratello.");
    }

    const cloned = cloneTopicSubtree(topic);
    const newId = insertSiblingTopic(wb.content, topicId, cloned, "after");
    wb.pushHistory();
    this.lastCreated = { id: newId, wb, pos: wb.pos };
    return { dto: wb.toDto(), newId };
  }

  public removeTopic(topicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const removed = removeTopic(wb.content, topicId);
    if (!removed) {
      throw new XmapError(CODE_TOPIC_NOT_FOUND, `Impossibile rimuovere il topic ${topicId} (o è la radice)`);
    }
    wb.pushHistory();
    return wb.toDto();
  }

  /**
   * Rimuove solo il blocco e ricollega i suoi figli al genitore, nella sua posizione.
   * Un unico passo di cronologia undo. Restituisce gli id dei figli ricollegati.
   */
  public removeTopicKeepChildren(topicId: string): { dto: WorkbookDto; childIds: string[] } {
    const wb = this.ensureWorkbook();
    const childIds = removeTopicKeepChildren(wb.content, topicId);
    if (!childIds) {
      throw new XmapError(CODE_TOPIC_NOT_FOUND, `Impossibile rimuovere il topic ${topicId} (o è la radice)`);
    }
    wb.pushHistory();
    return { dto: wb.toDto(), childIds };
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
    if (sheetIdx === -1) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${end1Id} non trovato`);
    const end2SheetIdx = sheetIndexOf(wb.content, end2Id);
    if (end2SheetIdx === -1) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${end2Id} non trovato`);
    if (sheetIdx !== end2SheetIdx) {
      throw new XmapError(CODE_INVALID_INPUT, 'I blocchi non appartengono allo stesso foglio.');
    }
    const sheet = wb.content[sheetIdx];

    addRelationship(sheet, end1Id, end2Id, title);
    wb.pushHistory();
    return wb.toDto();
  }

  /**
   * Imposta i punti di controllo di una relazione in un solo passo di undo:
   * `undefined` = invariato, `null` = ripristina il default di XMind.
   */
  public setRelationshipControlPoints(
    relationshipId: string,
    points: [Point | null | undefined, Point | null | undefined]
  ): WorkbookDto {
    const wb = this.ensureWorkbook();
    for (const sheet of wb.content) {
      if (!sheet.relationships?.some((r) => r.id === relationshipId)) continue;
      points.forEach((point, i) => {
        if (point !== undefined) setRelationshipControlPoint(sheet, relationshipId, i as 0 | 1, point);
      });
      wb.pushHistory();
      return wb.toDto();
    }
    throw new XmapError(CODE_INVALID_INPUT, `Relazione ${relationshipId} non trovata`);
  }

  public setRelationshipShape(relationshipId: string, shape: RelationshipShape): WorkbookDto {
    const wb = this.ensureWorkbook();
    for (const sheet of wb.content) {
      if (setRelationshipShape(sheet, relationshipId, shape)) {
        wb.pushHistory();
        return wb.toDto();
      }
    }
    throw new XmapError(CODE_INVALID_INPUT, `Relazione ${relationshipId} non trovata`);
  }

  public removeTopicRelationship(relationshipId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    for (const sheet of wb.content) {
      if (removeRelationship(sheet, relationshipId)) {
        wb.pushHistory();
        return wb.toDto();
      }
    }
    throw new XmapError(CODE_TOPIC_NOT_FOUND, `Relazione ${relationshipId} non trovata`);
  }

  public addTopicBoundary(
    topicId: string,
    start?: number,
    end?: number,
    title?: string
  ): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    const childCount = topic.children?.attached?.length ?? 0;
    const rangeStart = start ?? 0;
    const rangeEnd = end ?? Math.max(0, childCount - 1);
    validateChildRange(rangeStart, rangeEnd, childCount);
    addBoundary(topic, rangeStart, rangeEnd, title);
    wb.pushHistory();
    return wb.toDto();
  }

  public removeTopicBoundary(topicId: string, boundaryId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    if (!removeBoundary(topic, boundaryId)) {
      throw new XmapError(CODE_TOPIC_NOT_FOUND, `Boundary ${boundaryId} non trovato`);
    }
    wb.pushHistory();
    return wb.toDto();
  }

  /**
   * Calcola l'intervallo di blocchi fratelli contigui per un elenco di ID.
   * Restituisce `null` se i blocchi non sono fratelli validi.
   */
  public siblingRange(ids: string[]): SiblingRange | null {
    if (!this.currentWorkbook) return null;
    return siblingRange(this.currentWorkbook.content, ids);
  }

  public addTopicSummary(
    topicId: string,
    start?: number,
    end?: number,
    title: string = 'Sommario'
  ): { dto: WorkbookDto; summaryTopicId: string } {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    const childCount = topic.children?.attached?.length ?? 0;
    const rangeStart = start ?? 0;
    const rangeEnd = end ?? Math.max(0, childCount - 1);
    validateChildRange(rangeStart, rangeEnd, childCount);
    const summaryTopicId = addSummary(topic, rangeStart, rangeEnd, title);
    wb.pushHistory();
    this.lastCreated = { id: summaryTopicId, wb, pos: wb.pos };
    return { dto: wb.toDto(), summaryTopicId };
  }

  /**
   * Crea un sommario su un intervallo di blocchi fratelli contigui (min..max indice).
   * Lancia un errore se i blocchi non sono fratelli validi.
   */
  public addSummaryForSiblings(
    topicIds: string[],
    title: string = 'Sommario'
  ): { dto: WorkbookDto; summaryTopicId: string } {
    const wb = this.ensureWorkbook();
    const range = siblingRange(wb.content, topicIds);
    if (!range) {
      throw new XmapError(CODE_INVALID_INPUT, 'I blocchi selezionati non sono validi per creare un sommario.');
    }
    return this.addTopicSummary(range.parentId, range.start, range.end, title);
  }

  public removeTopicSummary(topicId: string, summaryTopicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    if (!removeSummary(topic, summaryTopicId)) {
      throw new XmapError(CODE_TOPIC_NOT_FOUND, `Summary ${summaryTopicId} non trovato`);
    }
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicColor(topicId: string, color?: string | null): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    setFillColor(topic, color);
    wb.pushHistory();
    return wb.toDto();
  }

  public setTopicTask(topicId: string, task: TaskData): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    writeTask(topic, task);
    wb.pushHistory();
    return wb.toDto();
  }

  public clearTopicTask(topicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    clearTask(topic);
    wb.pushHistory();
    return wb.toDto();
  }

  public attachFileToTopic(topicId: string, fileName: string, fileBytes: Uint8Array): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    if (fileBytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, 'Il file da allegare è vuoto.');
    const attachmentPath = `attachments/${newTopicId()}.bin`;

    wb.archive.entries.set(attachmentPath, fileBytes);
    setHref(topic, `xap:${attachmentPath}`);
    if (!topicTitle(topic).trim()) setTitle(topic, fileName.trim() || 'allegato');
    wb.pushHistory();
    return wb.toDto();
  }

  /**
   * Crea un nuovo sotto-blocco (titolo vuoto, come fanno le immagini in XMind) con l'immagine,
   * aggiunge la risorsa all'archivio (deduplicata per hash SHA-256), la registra nel manifest,
   * genera un solo passo di undo e restituisce { dto, newId }.
   */
  public addImageTopic(
    parentId: string,
    bytes: Uint8Array,
    mimeType: string,
    size: { width: number; height: number },
    opts?: AddImageTopicOptions
  ): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const parent = findTopic(wb.content, parentId);
    if (!parent) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Parent topic ${parentId} non trovato`);
    if (bytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, "L'immagine è vuota.");

    const resourceName = computeImageResourceName(bytes, mimeType);
    wb.archive.resources.set(resourceName, bytes);
    refreshManifest(wb.manifest, [resourceName], false);

    const { newId } = addImageChild(parent, resourceName, size, opts);
    wb.pushHistory();
    this.lastCreated = { id: newId, wb, pos: wb.pos };
    return { dto: wb.toDto(), newId };
  }

  /**
   * Imposta o sostituisce l'immagine su un blocco esistente preservando le altre chiavi di `image`.
   * Aggiunge la risorsa all'archivio e al manifest con un solo passo di undo.
   */
  public setTopicImage(
    topicId: string,
    bytes: Uint8Array,
    mimeType: string,
    size: { width: number; height: number }
  ): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);
    if (bytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, "L'immagine è vuota.");

    const resourceName = computeImageResourceName(bytes, mimeType);
    wb.archive.resources.set(resourceName, bytes);
    refreshManifest(wb.manifest, [resourceName], false);

    setTopicImage(topic, resourceName, size);
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
        throw new XmapError(CODE_FORMAT, `Formato sconosciuto: ${format}`);
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
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    const latex = topicLatex(topic);
    if (!latex) throw new XmapError(CODE_LATEX, 'Il blocco selezionato non contiene un\'equazione');

    const fontPx = fontSizePx(topic);
    const emPx = fontPx ? fontPx * 1.25 : 23.33;
    const render = renderLatexToSvg(latex, emPx);
    if (render.error) throw new XmapError(CODE_LATEX, `LaTeX non valido: ${render.error}`);

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

  public mapLayout(
    sheetIndex: number = 0,
    collapsed: Set<string> = new Set(),
    structure?: MapStructure
  ): Layout | null {
    if (!this.currentWorkbook) return null;
    const dto = this.currentWorkbook.toDto();
    const sheet = dto.sheets[sheetIndex];
    if (!sheet) return null;
    return layoutSheets([sheet], collapsed, undefined, { ...DEFAULT_LAYOUT_OPTS, structure });
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

    const asNewSheet = options.asNewSheet ?? true;
    const root = wb.content[0]?.rootTopic;
    if (asNewSheet || !root || !importedSheet.rootTopic) {
      // Mai sovrascrivere il primo foglio: se non c'è una radice a cui
      // agganciare l'import, lo si aggiunge come foglio nuovo.
      wb.content.push(importedSheet);
    } else {
      // Inserisci come figlio della radice del primo sheet
      if (!root.children) root.children = {};
      if (!root.children.attached) root.children.attached = [];
      root.children.attached.push(importedSheet.rootTopic);
    }

    wb.pushHistory();
    return wb.toDto();
  }

  public async mergeWorkbook(otherBytes: Uint8Array): Promise<MergeResultDto> {
    const wb = this.ensureWorkbook();
    await validateArchiveBytes(otherBytes);
    const otherArchive = await readArchive(otherBytes);
    const otherContentBytes = otherArchive.entries.get('content.json');
    if (!otherContentBytes) throw new XmapError(CODE_FORMAT, 'content.json assente nel file da unire');

    const otherSheets: Sheet[] = JSON.parse(new TextDecoder().decode(otherContentBytes));
    if (otherSheets.length === 0) throw new XmapError(CODE_FORMAT, 'Il file da unire non contiene fogli');

    // Riassegna gli id per evitare collisioni tra file indipendenti.
    remapIds(otherSheets);
    const addedTopics = countTopics(otherSheets);

    const attachmentRefs = new Set<string>();
    collectAttachmentRefs(otherSheets, attachmentRefs);
    const attachmentRemap = new Map<string, string>();
    const attachmentsToCopy: Array<[string, Uint8Array]> = [];
    for (const sourcePath of attachmentRefs) {
      const bytes = otherArchive.entries.get(sourcePath);
      if (!bytes) throw new XmapError(CODE_VALIDATION, `Allegato referenziato ma assente: ${sourcePath}`);

      const existing = wb.archive.entries.get(sourcePath);
      if (!existing || bytesEqual(existing, bytes)) {
        attachmentRemap.set(sourcePath, sourcePath);
        if (!existing) attachmentsToCopy.push([sourcePath, bytes]);
        continue;
      }

      const extension = sourcePath.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] ?? '.bin';
      const destinationPath = `attachments/${newTopicId()}${extension}`;
      attachmentRemap.set(sourcePath, destinationPath);
      attachmentsToCopy.push([destinationPath, bytes]);
    }
    remapAttachmentRefs(otherSheets, attachmentRemap);

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
    for (const [name, bytes] of attachmentsToCopy) {
      wb.archive.entries.set(name, bytes);
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
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);

    const root = JSON.parse(JSON.stringify(topic)) as Topic;

    const newArchive: RawArchive = {
      entries: new Map(),
      resources: new Map(),
    };

    const standalone: Sheet = {
      id: newTopicId(),
      class: 'sheet',
      title: topicTitle(topic) || 'Mappa Estratta',
      revisionId: newTopicId(),
      rootTopic: root,
    };
    remapIds([standalone]);

    const resourceRefs = new Set<string>();
    collectResourceRefs(standalone, resourceRefs);
    for (const ref of resourceRefs) {
      const resPath = `resources/${ref}`;
      const bytes = wb.archive.resources.get(resPath);
      if (!bytes) throw new XmapError(CODE_VALIDATION, `Risorsa referenziata ma assente: ${resPath}`);
      newArchive.resources.set(resPath, bytes);
    }

    const attachmentRefs = new Set<string>();
    collectAttachmentRefs(standalone, attachmentRefs);
    for (const attachment of attachmentRefs) {
      const bytes = wb.archive.entries.get(attachment);
      if (!bytes) throw new XmapError(CODE_VALIDATION, `Allegato referenziato ma assente: ${attachment}`);
      newArchive.entries.set(attachment, bytes);
    }

    const manifestObj = refreshManifest({}, newArchive.resources.keys(), true);
    registerEntries(
      manifestObj,
      Array.from(newArchive.entries.keys()).filter((name) => name.startsWith('attachments/'))
    );
    newArchive.entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifestObj)));
    newArchive.entries.set('content.json', new TextEncoder().encode(JSON.stringify([standalone])));
    newArchive.entries.set(
      'metadata.json',
      new TextEncoder().encode(JSON.stringify({ creator: { name: 'XMap Studio', version: '2.0' } }))
    );

    const bytes = await buildArchiveBytes(newArchive);
    await validateArchiveBytes(bytes);
    return bytes;
  }

  /**
   * Prepara i byte finali con content.json serializzato, manifest aggiornato e thumbnail rimossa.
   * Esegue la validazione in memoria prima della scrittura.
   */
  public async prepareArchiveBytes(): Promise<{ bytes: Uint8Array; validation: ValidationReport }> {
    const wb = this.ensureWorkbook();

    // Si lavora su una copia: se la validazione fallisce il workbook vivo
    // resta intatto (i byte delle entry sono condivisi, mai modificati).
    const archive: RawArchive = {
      entries: new Map(wb.archive.entries),
      resources: new Map(wb.archive.resources),
    };

    // Rimuove thumbnail obsoleta (Regola 9)
    archive.entries.delete('Thumbnails/thumbnail.png');

    // refreshManifest/registerEntries mutano il loro input: clone profondo.
    const manifest = refreshManifest(
      JSON.parse(JSON.stringify(wb.manifest ?? {})) as Record<string, unknown>,
      archive.resources.keys(),
      true
    );
    registerEntries(
      manifest,
      Array.from(archive.entries.keys()).filter((name) => name.startsWith('attachments/'))
    );

    archive.entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    archive.entries.set('content.json', new TextEncoder().encode(JSON.stringify(wb.content)));

    const bytes = await buildArchiveBytes(archive);
    const validation = await validateArchiveBytes(bytes);

    return { bytes, validation };
  }

  /**
   * Segna il workbook come salvato dopo che i byte sono stati scritti da un
   * adapter esterno (Electron IPC, File System Access API). Opzionalmente
   * aggiorna il percorso (Salva con nome).
   */
  public expectedFileHash(): string {
    return this.ensureWorkbook().originalHash;
  }

  public markSaved(path?: string, contentHash?: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    wb.markSaved(path, contentHash);
    return wb.toDto();
  }

  public async save(force: boolean = false, targetPath?: string): Promise<SaveResultDto> {
    const wb = this.ensureWorkbook();
    const platform = this.requirePlatform();
    const target = targetPath ?? wb.path;
    if (!target) {
      throw new XmapError(CODE_NO_PATH, 'La mappa non ha ancora un file: usa "Salva con nome".');
    }

    if (!force) {
      const running = await platform.xmindProcesses();
      if (running.length > 0) {
        throw new XmapError(
          CODE_XMIND_RUNNING,
          `XMind è in esecuzione in background (${running.join(', ')}). Chiudi XMind o forza il salvataggio.`,
          { processes: running }
        );
      }
    }

    const { bytes } = await this.prepareArchiveBytes();
    // Il controllo di conflitto vale solo se si riscrive il file che abbiamo aperto.
    const expectedHash = target === wb.path ? wb.originalHash : undefined;
    const report = await platform.atomicWrite(target, bytes, { makeBackup: true, expectedHash });

    // Rilegge e rivalida ciò che è finito su disco prima di dichiararlo salvato.
    const writtenBytes = await platform.readFile(target);
    const validation = await validateArchiveBytes(writtenBytes);
    const contentHash = await sha256HexAsync(writtenBytes);
    wb.markSaved(target, contentHash);

    return {
      path: target,
      backup: report.backup,
      bytes: bytes.length,
      validation,
    };
  }

  public async saveAs(newPath: string, force: boolean = false): Promise<SaveResultDto> {
    this.ensureWorkbook();
    return await this.save(force, newPath);
  }

  private requirePlatform(): Platform {
    if (!this.platform) {
      throw new XmapError(
        CODE_IO,
        'Accesso al disco non disponibile in questo ambiente: usa prepareArchiveBytes() e l’adapter di filesystem.'
      );
    }
    return this.platform;
  }
}

function validateChildRange(start: number, end: number, childCount: number): void {
  if (
    childCount === 0 ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= childCount
  ) {
    throw new XmapError(CODE_INVALID_INPUT, 'Intervallo non valido per i sotto-blocchi collegati.');
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
