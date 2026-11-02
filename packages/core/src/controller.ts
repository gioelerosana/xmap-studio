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
  setTopicFolded,
  isTopicFolded,
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
import { setSheetTheme, ThemePatch } from './model/theme.js';
import { cloneSheet, createSheet, nextSheetTitle } from './model/sheets.js';
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
} from './model/utils.js';
import { applyEquation, removeEquation, TitleMode } from './latex/equation.js';
import { loadMathJax, renderLatexToSvg } from './latex/mathjax.js';
import { svgToPng } from './latex/raster.js';
import { clearTask, writeTask, TaskData } from './task/task.js';
import { isMarkerKnown } from './markers/catalog.js';
import { Manifest, refreshManifest, registerEntries } from './safety/manifest.js';
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

/** Corpo di riferimento (px) delle formule quando il blocco non ha una dimensione del testo. */
const DEFAULT_EM_PX = 23.33;
/** Rapporto tra la formula e la dimensione del testo del blocco. */
const FORMULA_TO_FONT_RATIO = 1.25;
/** Fattore di rasterizzazione del PNG esportato dall'equazione. */
const EQUATION_PNG_SCALE = 3;
const XAP_PREFIX = 'xap:';

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
    let clean = src.startsWith(XAP_PREFIX) ? src.slice(XAP_PREFIX.length) : src;
    if (clean.startsWith('/')) clean = clean.slice(1);

    const { resources, entries } = this.currentWorkbook.archive;
    return resources.get(clean) ?? entries.get(clean) ?? null;
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
    const name = fileName || (resolvedPath ? fileNameFromPath(resolvedPath) : '') || 'workbook.xmind';

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

  /** Anteprima sincrona: richiede MathJax caricato (`loadMathJax`). */
  public preview(latex: string, emPx: number = DEFAULT_EM_PX) {
    return renderLatexToSvg(latex, emPx);
  }

  private ensureWorkbook(): OpenWorkbook {
    if (!this.currentWorkbook) {
      throw new XmapError(CODE_NO_WORKBOOK, 'Nessun workbook aperto');
    }
    return this.currentWorkbook;
  }

  private requireTopic(wb: OpenWorkbook, topicId: string): Topic {
    const topic = findTopic(wb.content, topicId);
    if (!topic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Topic ${topicId} non trovato`);
    return topic;
  }

  private requireParentTopic(wb: OpenWorkbook, parentId: string): Topic {
    const parent = findTopic(wb.content, parentId);
    if (!parent) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Parent topic ${parentId} non trovato`);
    return parent;
  }

  private requireSheet(wb: OpenWorkbook, sheetIndex: number): Sheet {
    const sheet = wb.content[sheetIndex];
    if (!sheet) throw new XmapError(CODE_INVALID_INPUT, `Foglio ${sheetIndex + 1} non trovato`);
    return sheet;
  }

  private requireSiblingRange(wb: OpenWorkbook, topicIds: string[]): SiblingRange {
    const range = siblingRange(wb.content, topicIds);
    if (!range) {
      throw new XmapError(CODE_INVALID_INPUT, 'I blocchi selezionati non sono validi per creare un sommario.');
    }
    return range;
  }

  /**
   * Modifica il blocco e registra un passo di cronologia. Le verifiche che possono
   * fallire vanno fatte dentro `edit` prima di mutare il blocco: se lanciano, nessun passo viene registrato.
   */
  private editTopic(topicId: string, edit: (topic: Topic, wb: OpenWorkbook) => void): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = this.requireTopic(wb, topicId);
    edit(topic, wb);
    return this.commit(wb);
  }

  private commit(wb: OpenWorkbook): WorkbookDto {
    wb.pushHistory();
    return wb.toDto();
  }

  /** Registra la creazione di `newId` in un passo di cronologia e ne ricorda il blocco per fondere la rinomina successiva. */
  private commitCreation(wb: OpenWorkbook, newId: string): WorkbookDto {
    wb.pushHistory();
    this.lastCreated = { id: newId, wb, pos: wb.pos };
    return wb.toDto();
  }

  /**
   * Chiude una modifica del titolo: con `mergeWithPrevious`, se l'ultimo passo è la
   * creazione dello stesso blocco, ne sostituisce lo snapshot invece di aggiungerne uno.
   */
  private commitTitleChange(
    wb: OpenWorkbook,
    topicId: string,
    mergeWithPrevious: boolean | undefined
  ): WorkbookDto {
    const lc = this.lastCreated;
    if (mergeWithPrevious && lc && lc.id === topicId && lc.wb === wb && lc.pos === wb.pos) {
      wb.replaceHistoryTop();
      return wb.toDto();
    }
    return this.commit(wb);
  }

  /** Registra i byte nell'archivio e nel manifest; restituisce il nome canonico della risorsa. */
  private storeImageResource(wb: OpenWorkbook, bytes: Uint8Array, mimeType: string): string {
    const resourceName = computeImageResourceName(bytes, mimeType);
    wb.archive.resources.set(resourceName, bytes);
    refreshManifest(wb.manifest, [resourceName], false);
    return resourceName;
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

  public async apply(
    topicId: string,
    latex: string,
    options: {
      titleMode?: TitleMode;
      fontSizePx?: number;
      color?: string;
      /** Fattore di ingrandimento della formula rispetto alla dimensione del testo (1 = normale). */
      scale?: number;
    } = {}
  ): Promise<WorkbookDto> {
    const wb = this.ensureWorkbook();
    const topic = this.requireTopic(wb, topicId);

    const fontPx = options.fontSizePx ?? fontSizePx(topic);
    const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 1;
    const emPx = emPxForFontSize(fontPx) * scale;

    const { outcome, png } = await applyEquation(topic, latex, {
      emPx,
      titleMode: options.titleMode,
      color: options.color,
    });

    // Durante il rendering (asincrono) un undo, un'eliminazione o un'altra mappa
    // aperta possono aver staccato il blocco: la formula finirebbe su un oggetto
    // non più nella mappa, in silenzio.
    if (this.currentWorkbook !== wb || findTopic(wb.content, topicId) !== topic) {
      throw new XmapError(CODE_TOPIC_NOT_FOUND, 'La mappa è cambiata mentre si preparava la formula: riprova.');
    }
    wb.archive.resources.set(outcome.resource, png);
    return this.commit(wb);
  }

  public async applyBatch(specs: BatchSpec[]): Promise<BatchResultDto> {
    const wb = this.ensureWorkbook();
    if (specs.length === 0) throw new XmapError(CODE_INVALID_INPUT, 'Nessuna equazione da applicare.');

    const startContent = wb.content;
    const startRevision = wb.currentRevision();
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
        const emPx = emPxForFontSize(spec.fontSizePx ?? fontSizePx(topic));
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
    // La copia di lavoro sostituisce il contenuto vivo: se nel frattempo la mappa
    // è cambiata, quelle modifiche andrebbero perse.
    if (this.currentWorkbook !== wb || wb.content !== startContent || wb.currentRevision() !== startRevision) {
      throw new XmapError(CODE_INVALID_INPUT, 'La mappa è cambiata mentre si applicavano le formule: riprova.');
    }

    wb.content = working;
    pendingResources.forEach(([name, bytes]) => wb.archive.resources.set(name, bytes));
    wb.pushHistory();

    return {
      modified: specs.length,
      totalLatex: specs.length,
      errors,
    };
  }

  public removeEquation(topicId: string, title?: string): WorkbookDto {
    return this.editTopic(topicId, (topic) => removeEquation(topic, title));
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
    const topic = this.requireTopic(wb, topicId);

    if (topic.title === title && topic.titleUnedited === undefined) return wb.toDto();
    setTitle(topic, title);
    return this.commitTitleChange(wb, topicId, opts?.mergeWithPrevious);
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
    const topic = this.requireTopic(wb, topicId);

    const prevTitle = topic.title;
    const prevAttributed = JSON.stringify(topic.attributedTitle);
    const prevUnedited = topic.titleUnedited;

    setTitleRuns(topic, runs);

    const nextTitle = topic.title;
    const nextAttributed = JSON.stringify(topic.attributedTitle);

    if (prevTitle === nextTitle && prevAttributed === nextAttributed && prevUnedited === undefined) {
      return wb.toDto();
    }
    return this.commitTitleChange(wb, topicId, opts?.mergeWithPrevious);
  }

  /** Grassetto, corsivo, sottolineato, barrato, colore e dimensione del blocco intero. */
  public setTopicTextStyle(topicId: string, patch: TextStylePatch): WorkbookDto {
    return this.editTopic(topicId, (topic) => setTextStyle(topic, patch));
  }

  public setTopicNotes(topicId: string, text: string): WorkbookDto {
    return this.editTopic(topicId, (topic) => setNotes(topic, text));
  }

  /** Sposta un topic libero (gruppo `detached`); `pos` è relativa al centro della radice. */
  public setTopicPosition(topicId: string, pos: { x: number; y: number }): WorkbookDto {
    return this.editTopic(topicId, (topic, wb) => {
      if (!isDetachedTopic(wb.content, topicId)) {
        throw new XmapError(CODE_MOVE, 'Solo i topic liberi possono essere posizionati.');
      }
      setTopicPosition(topic, pos);
    });
  }

  /**
   * Imposta o rimuove la larghezza manuale del blocco (`customWidth`).
   * Passando `null` rimuove la larghezza manuale tornando all'adattamento automatico.
   */
  public setTopicCustomWidth(topicId: string, width: number | null): WorkbookDto {
    return this.editTopic(topicId, (topic) => setTopicCustomWidth(topic, width));
  }

  /**
   * Imposta le dimensioni in pixel dell'immagine associata al blocco,
   * preservando tutte le altre proprietà di `image`.
   */
  public setTopicImageSize(
    topicId: string,
    size: { width: number; height: number }
  ): WorkbookDto {
    return this.editTopic(topicId, (topic) => setTopicImageSize(topic, size));
  }

  public setTopicNotesDisplay(topicId: string, display?: 'icon' | 'block' | null): WorkbookDto {
    return this.editTopic(topicId, (topic) => setNotesDisplay(topic, topic.notes ? display : null));
  }

  public setTopicLabels(topicId: string, labels: string[]): WorkbookDto {
    return this.editTopic(topicId, (topic) => setLabels(topic, labels));
  }

  public toggleTopicMarker(topicId: string, markerId: string): WorkbookDto {
    return this.editTopic(topicId, (topic) => {
      const id = markerId.trim();
      // Id marker: solo lettere ASCII, cifre, "_" e "-". Accetta "star_1", rifiuta "star 1".
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new XmapError(CODE_INVALID_INPUT, 'Id marker non valido.');
      }
      const alreadyPresent = topic.markers?.some((marker) => marker.markerId === id) ?? false;
      if (!alreadyPresent && !isMarkerKnown(id)) {
        throw new XmapError(CODE_INVALID_INPUT, `Marker sconosciuto: ${id}`);
      }
      toggleMarker(topic, id);
    });
  }

  public setTopicHref(topicId: string, href?: string | null): WorkbookDto {
    return this.editTopic(topicId, (topic) => setHref(topic, href));
  }

  public addTopic(parentId: string, title: string): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const parent = this.requireParentTopic(wb, parentId);

    const newId = addChild(parent, title);
    // Il figlio nuovo deve vedersi: un ramo chiuso si apre nello stesso passo di undo.
    setTopicFolded(parent, false);
    return { dto: this.commitCreation(wb, newId), newId };
  }

  /**
   * Piega o apre un ramo (`branch: "folded"`). È una modifica del file come le
   * altre: un passo di undo proprio e il file risulta modificato. Fonderla con il
   * passo precedente riscriverebbe lo snapshot d'apertura e renderebbe la piega
   * impossibile da annullare.
   */
  public setTopicFolded(topicId: string, folded: boolean): WorkbookDto {
    const wb = this.ensureWorkbook();
    const topic = this.requireTopic(wb, topicId);

    if (isTopicFolded(topic) === folded) return wb.toDto();
    setTopicFolded(topic, folded);
    return this.commit(wb);
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
    this.requireTopic(wb, topicId);
    if (isRootTopic(wb.content, topicId)) {
      return this.addTopic(topicId, title);
    }
    const newId = insertSibling(wb.content, topicId, title, where);
    return { dto: this.commitCreation(wb, newId), newId };
  }

  /**
   * Copia un topic (e il suo intero sottoalbero) serializzandolo come payload JSON
   * con marcatore { xmapStudioClipboard: 1, topic }.
   */
  public copyTopic(topicId: string): string {
    const wb = this.ensureWorkbook();
    const topic = this.requireTopic(wb, topicId);

    const resources = encodeAssets(wb.archive.resources, subtreeResourceNames(topic));
    const attachmentNames = new Set<string>();
    collectAttachmentRefs(topic, attachmentNames);
    const attachments = encodeAssets(wb.archive.entries, attachmentNames);

    const payload: XmapClipboardPayload = {
      xmapStudioClipboard: XMAP_CLIPBOARD_VERSION,
      topic,
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      ...(Object.keys(attachments).length > 0 ? { attachments } : {}),
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

    const data = parseClipboardPayload(payload);
    this.importClipboardResources(wb, data);
    this.importClipboardAttachments(wb, data);

    const cloned = cloneTopicSubtree(data.topic);
    appendAttachedChild(parent, cloned);
    setTopicFolded(parent, false);
    const newId = cloned.id!;
    return { dto: this.commitCreation(wb, newId), newId };
  }

  /** Le risorse mancanti (blocco copiato da un altro file) si aggiungono all'archivio, altrimenti la validazione prima del salvataggio fallirebbe. */
  private importClipboardResources(wb: OpenWorkbook, data: XmapClipboardPayload): void {
    if (!data.resources || typeof data.resources !== 'object') return;
    const added: string[] = [];
    Object.entries(data.resources).forEach(([name, b64]) => {
      if (!name.startsWith('resources/') || typeof b64 !== 'string') return;
      if (wb.archive.resources.has(name)) return;
      try {
        wb.archive.resources.set(name, base64ToBytes(b64));
        added.push(name);
      } catch {
        throw new XmapError(CODE_INVALID_INPUT, 'Dati negli appunti non validi: immagine danneggiata.');
      }
    });
    if (added.length > 0) refreshManifest(wb.manifest, added, false);
  }

  private importClipboardAttachments(wb: OpenWorkbook, data: XmapClipboardPayload): void {
    if (!data.attachments || typeof data.attachments !== 'object') return;
    const added: string[] = [];
    Object.entries(data.attachments).forEach(([name, b64]) => {
      if (!name.startsWith('attachments/') || name.includes('..') || typeof b64 !== 'string') return;
      if (wb.archive.entries.has(name)) return;
      try {
        wb.archive.entries.set(name, base64ToBytes(b64));
        added.push(name);
      } catch {
        throw new XmapError(CODE_INVALID_INPUT, 'Dati negli appunti non validi: allegato danneggiato.');
      }
    });
    if (added.length > 0) registerEntries(wb.manifest, added);
  }

  /**
   * Duplica un blocco (e il suo sottoalbero), inserendo la copia come blocco fratello subito dopo.
   * Lancia un errore comprensibile se chiamato sulla radice (non ha fratelli).
   * Un unico passo di cronologia undo.
   */
  public duplicateTopic(topicId: string): { dto: WorkbookDto; newId: string } {
    const wb = this.ensureWorkbook();
    const topic = this.requireTopic(wb, topicId);

    if (isRootTopic(wb.content, topicId)) {
      throw new XmapError(CODE_MOVE, "La radice non può essere duplicata come blocco fratello.");
    }

    const newId = insertSiblingTopic(wb.content, topicId, cloneTopicSubtree(topic), "after");
    return { dto: this.commitCreation(wb, newId), newId };
  }

  public removeTopic(topicId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const removed = removeTopic(wb.content, topicId);
    if (!removed) {
      throw new XmapError(CODE_TOPIC_NOT_FOUND, `Impossibile rimuovere il topic ${topicId} (o è la radice)`);
    }
    return this.commit(wb);
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
    return { dto: this.commit(wb), childIds };
  }

  public moveTopic(topicId: string, targetId: string, placement: MovePlacement): WorkbookDto {
    const wb = this.ensureWorkbook();
    moveTopic(wb.content, topicId, targetId, placement);
    return this.commit(wb);
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

    addRelationship(wb.content[sheetIdx], end1Id, end2Id, title);
    return this.commit(wb);
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
    const sheet = wb.content.find((s) => s.relationships?.some((r) => r.id === relationshipId));
    if (!sheet) throw new XmapError(CODE_INVALID_INPUT, `Relazione ${relationshipId} non trovata`);

    points.forEach((point, i) => {
      if (point !== undefined) setRelationshipControlPoint(sheet, relationshipId, i as 0 | 1, point);
    });
    return this.commit(wb);
  }

  public setRelationshipShape(relationshipId: string, shape: RelationshipShape): WorkbookDto {
    const wb = this.ensureWorkbook();
    const applied = wb.content.some((sheet) => setRelationshipShape(sheet, relationshipId, shape));
    if (!applied) throw new XmapError(CODE_INVALID_INPUT, `Relazione ${relationshipId} non trovata`);
    return this.commit(wb);
  }

  public removeTopicRelationship(relationshipId: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const removed = wb.content.some((sheet) => removeRelationship(sheet, relationshipId));
    if (!removed) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Relazione ${relationshipId} non trovata`);
    return this.commit(wb);
  }

  public addTopicBoundary(
    topicId: string,
    start?: number,
    end?: number,
    title?: string
  ): WorkbookDto {
    return this.editTopic(topicId, (topic) => {
      const range = resolveChildRange(topic, start, end);
      addBoundary(topic, range.start, range.end, title);
    });
  }

  public removeTopicBoundary(topicId: string, boundaryId: string): WorkbookDto {
    return this.editTopic(topicId, (topic) => {
      if (!removeBoundary(topic, boundaryId)) {
        throw new XmapError(CODE_TOPIC_NOT_FOUND, `Boundary ${boundaryId} non trovato`);
      }
    });
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
    const topic = this.requireTopic(wb, topicId);

    const range = resolveChildRange(topic, start, end);
    const summaryTopicId = addSummary(topic, range.start, range.end, title);
    return { dto: this.commitCreation(wb, summaryTopicId), summaryTopicId };
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
    const range = this.requireSiblingRange(wb, topicIds);
    return this.addTopicSummary(range.parentId, range.start, range.end, title);
  }

  /**
   * Crea un sommario sui blocchi fratelli selezionati e ne fa il topic di sommario un'immagine,
   * come un blocco-immagine. Un solo passo di undo. Lancia un errore se la selezione non è valida.
   */
  public addSummaryImageForSiblings(
    topicIds: string[],
    bytes: Uint8Array,
    mimeType: string,
    size: { width: number; height: number }
  ): { dto: WorkbookDto; summaryTopicId: string } {
    const wb = this.ensureWorkbook();
    const range = this.requireSiblingRange(wb, topicIds);
    if (bytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, "L'immagine è vuota.");

    const parent = this.requireParentTopic(wb, range.parentId);
    const resourceName = this.storeImageResource(wb, bytes, mimeType);
    const summaryTopicId = addSummary(parent, range.start, range.end, '');
    const summaryTopic = parent.children?.summary?.find((t) => t.id === summaryTopicId);
    if (!summaryTopic) throw new XmapError(CODE_TOPIC_NOT_FOUND, `Summary ${summaryTopicId} non trovato`);
    setTopicImage(summaryTopic, resourceName, size);

    return { dto: this.commitCreation(wb, summaryTopicId), summaryTopicId };
  }

  public removeTopicSummary(topicId: string, summaryTopicId: string): WorkbookDto {
    return this.editTopic(topicId, (topic) => {
      if (!removeSummary(topic, summaryTopicId)) {
        throw new XmapError(CODE_TOPIC_NOT_FOUND, `Summary ${summaryTopicId} non trovato`);
      }
    });
  }

  /**
   * Modifica il tema del foglio `sheetIndex` (editor dei temi). Un passo di
   * annullamento solo se qualcosa cambia; un valore non valido lascia il foglio
   * com'era.
   */
  public setSheetTheme(sheetIndex: number, patch: ThemePatch): WorkbookDto {
    const wb = this.ensureWorkbook();
    const sheet = wb.content[sheetIndex];
    if (!sheet) throw new XmapError(CODE_INVALID_INPUT, `Foglio ${sheetIndex + 1} non trovato`);

    try {
      if (setSheetTheme(sheet, patch)) wb.pushHistory();
    } catch (e) {
      throw new XmapError(CODE_INVALID_INPUT, e instanceof Error ? e.message : String(e));
    }
    return wb.toDto();
  }

  /** Aggiunge un foglio vuoto in fondo (o in `atIndex`). Senza titolo: "Foglio N". */
  public addSheet(title?: string, atIndex?: number): WorkbookDto {
    const wb = this.ensureWorkbook();
    const sheet = createSheet(title?.trim() || nextSheetTitle(wb.content));
    const at = atIndex === undefined ? wb.content.length : Math.max(0, Math.min(atIndex, wb.content.length));
    wb.content.splice(at, 0, sheet);
    return this.commit(wb);
  }

  /** Rinomina la linguetta del foglio (`sheet.title`). Titolo vuoto non valido; invariato = nessun passo di annullamento. */
  public renameSheet(sheetIndex: number, title: string): WorkbookDto {
    const wb = this.ensureWorkbook();
    const sheet = this.requireSheet(wb, sheetIndex);
    const next = title.trim();
    if (!next) throw new XmapError(CODE_INVALID_INPUT, 'Il titolo del foglio non può essere vuoto');
    if (sheet.title !== next) {
      sheet.title = next;
      wb.pushHistory();
    }
    return wb.toDto();
  }

  /** Duplica il foglio subito dopo l'originale, con id nuovi. */
  public duplicateSheet(sheetIndex: number): WorkbookDto {
    const wb = this.ensureWorkbook();
    const sheet = this.requireSheet(wb, sheetIndex);
    const base = sheet.title || `Foglio ${sheetIndex + 1}`;
    wb.content.splice(sheetIndex + 1, 0, cloneSheet(sheet, `${base} (copia)`));
    return this.commit(wb);
  }

  /** Elimina un foglio (annullabile). L'ultimo foglio rimasto non si elimina. */
  public deleteSheet(sheetIndex: number): WorkbookDto {
    const wb = this.ensureWorkbook();
    this.requireSheet(wb, sheetIndex);
    if (wb.content.length <= 1) throw new XmapError(CODE_INVALID_INPUT, 'Una mappa deve avere almeno un foglio');
    wb.content.splice(sheetIndex, 1);
    return this.commit(wb);
  }

  /** Sposta il foglio da `from` a `to` (posizione finale). */
  public moveSheet(from: number, to: number): WorkbookDto {
    const wb = this.ensureWorkbook();
    this.requireSheet(wb, from);
    this.requireSheet(wb, to);
    if (from !== to) {
      const [sheet] = wb.content.splice(from, 1);
      if (sheet) wb.content.splice(to, 0, sheet);
      wb.pushHistory();
    }
    return wb.toDto();
  }

  public setTopicColor(topicId: string, color?: string | null): WorkbookDto {
    return this.editTopic(topicId, (topic) => setFillColor(topic, color));
  }

  public setTopicTask(topicId: string, task: TaskData): WorkbookDto {
    return this.editTopic(topicId, (topic) => writeTask(topic, task));
  }

  public clearTopicTask(topicId: string): WorkbookDto {
    return this.editTopic(topicId, (topic) => clearTask(topic));
  }

  public attachFileToTopic(topicId: string, fileName: string, fileBytes: Uint8Array): WorkbookDto {
    return this.editTopic(topicId, (topic, wb) => {
      if (fileBytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, 'Il file da allegare è vuoto.');
      const attachmentPath = `attachments/${newTopicId()}.bin`;

      wb.archive.entries.set(attachmentPath, fileBytes);
      setHref(topic, `xap:${attachmentPath}`);
      if (!topicTitle(topic).trim()) setTitle(topic, fileName.trim() || 'allegato');
    });
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
    const parent = this.requireParentTopic(wb, parentId);
    if (bytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, "L'immagine è vuota.");

    const resourceName = this.storeImageResource(wb, bytes, mimeType);

    const { newId } = addImageChild(parent, resourceName, size, opts);
    setTopicFolded(parent, false);
    return { dto: this.commitCreation(wb, newId), newId };
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
    return this.editTopic(topicId, (topic, wb) => {
      if (bytes.length === 0) throw new XmapError(CODE_INVALID_INPUT, "L'immagine è vuota.");
      const resourceName = this.storeImageResource(wb, bytes, mimeType);
      setTopicImage(topic, resourceName, size);
    });
  }

  /**
   * Testo della mappa in un formato aperto. `scope` restringe cosa si esporta:
   * un solo foglio (`sheetIndex`) o un ramo (`topicId`, che diventa la radice);
   * senza `scope` si esportano tutti i fogli. Non modifica mai il documento.
   */
  public export(
    format: 'markdown' | 'opml' | 'outline',
    scope: { sheetIndex?: number; topicId?: string } = {},
  ): string {
    const wb = this.ensureWorkbook();
    const sheets = this.sheetsForExport(wb, scope);
    switch (format) {
      case 'markdown':
        return toMarkdown(sheets);
      case 'opml':
        return toOPML(sheets, this.mapTitle() || 'Mappa');
      case 'outline':
        return toOutline(sheets);
      default:
        throw new XmapError(CODE_FORMAT, `Formato sconosciuto: ${format}`);
    }
  }

  private sheetsForExport(wb: OpenWorkbook, scope: { sheetIndex?: number; topicId?: string }): Sheet[] {
    if (scope.topicId !== undefined) {
      const topic = this.requireTopic(wb, scope.topicId);
      // Lettura sola: il ramo fa da radice di un foglio fittizio, senza copiarlo.
      return [{ id: 'export-branch', class: 'sheet', title: topicTitle(topic), rootTopic: topic } as Sheet];
    }
    if (scope.sheetIndex !== undefined) {
      const sheet = wb.content[scope.sheetIndex];
      if (!sheet) throw new XmapError(CODE_VALIDATION, `Foglio ${scope.sheetIndex} non trovato`);
      return [sheet];
    }
    return wb.content;
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
    const topic = this.requireTopic(wb, topicId);

    const latex = topicLatex(topic);
    if (!latex) throw new XmapError(CODE_LATEX, 'Il blocco selezionato non contiene un\'equazione');

    const emPx = emPxForFontSize(fontSizePx(topic));
    await loadMathJax();
    const render = renderLatexToSvg(latex, emPx);
    if (render.error) throw new XmapError(CODE_LATEX, `LaTeX non valido: ${render.error}`);

    if (format === 'svg') {
      return {
        bytes: new TextEncoder().encode(render.svg),
        mime: 'image/svg+xml',
        extension: 'svg',
      };
    }

    const png = await svgToPng(render.svg, render.width, render.height, EQUATION_PNG_SCALE, '#000000');
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
    const sheet = this.currentWorkbook.sheetDto(sheetIndex);
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
      appendAttachedChild(root, importedSheet.rootTopic);
    }

    return this.commit(wb);
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
    attachmentRefs.forEach((sourcePath) => {
      const bytes = otherArchive.entries.get(sourcePath);
      if (!bytes) throw new XmapError(CODE_VALIDATION, `Allegato referenziato ma assente: ${sourcePath}`);

      const existing = wb.archive.entries.get(sourcePath);
      if (!existing || bytesEqual(existing, bytes)) {
        attachmentRemap.set(sourcePath, sourcePath);
        if (!existing) attachmentsToCopy.push([sourcePath, bytes]);
        return;
      }

      // Estensione finale del file: ".png" in "resources/abc.png", nessuna con 16 caratteri dopo il punto.
      const extension = sourcePath.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] ?? '.bin';
      const destinationPath = `attachments/${newTopicId()}${extension}`;
      attachmentRemap.set(sourcePath, destinationPath);
      attachmentsToCopy.push([destinationPath, bytes]);
    });
    remapAttachmentRefs(otherSheets, attachmentRemap);

    let addedResources = 0;
    otherArchive.resources.forEach((bytes, name) => {
      if (!wb.archive.resources.has(name)) {
        wb.archive.resources.set(name, bytes);
        addedResources++;
      }
    });

    const addedSheets = otherSheets.length;
    otherSheets.forEach((s) => wb.content.push(s));
    attachmentsToCopy.forEach(([name, bytes]) => wb.archive.entries.set(name, bytes));

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
    const topic = this.requireTopic(wb, topicId);

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
    resourceRefs.forEach((ref) => {
      const resPath = `resources/${ref}`;
      const bytes = wb.archive.resources.get(resPath);
      if (!bytes) throw new XmapError(CODE_VALIDATION, `Risorsa referenziata ma assente: ${resPath}`);
      newArchive.resources.set(resPath, bytes);
    });

    const attachmentRefs = new Set<string>();
    collectAttachmentRefs(standalone, attachmentRefs);
    attachmentRefs.forEach((attachment) => {
      const bytes = wb.archive.entries.get(attachment);
      if (!bytes) throw new XmapError(CODE_VALIDATION, `Allegato referenziato ma assente: ${attachment}`);
      newArchive.entries.set(attachment, bytes);
    });

    newArchive.entries.set('manifest.json', encodeJson(refreshArchiveManifest({}, newArchive)));
    newArchive.entries.set('content.json', encodeJson([standalone]));
    newArchive.entries.set(
      'metadata.json',
      encodeJson({ creator: { name: 'XMap Studio', version: '2.0' } })
    );

    const bytes = await buildArchiveBytes(newArchive);
    await validateArchiveBytes(bytes);
    return bytes;
  }

  /**
   * Prepara i byte finali con content.json serializzato, manifest aggiornato e thumbnail rimossa.
   * Esegue la validazione in memoria prima della scrittura.
   */
  public async prepareArchiveBytes(): Promise<{
    bytes: Uint8Array;
    validation: ValidationReport;
    /** Revisione serializzata nei byte: va passata a `markSaved` a scrittura avvenuta. */
    revision: number;
  }> {
    const wb = this.ensureWorkbook();
    const revision = wb.currentRevision();

    // Si lavora su una copia: se la validazione fallisce il workbook vivo
    // resta intatto (i byte delle entry sono condivisi, mai modificati).
    const archive: RawArchive = {
      entries: new Map(wb.archive.entries),
      resources: new Map(wb.archive.resources),
    };

    // Rimuove thumbnail obsoleta (Regola 9)
    archive.entries.delete('Thumbnails/thumbnail.png');

    // Il manifest viene mutato: lo si clona in profondità per non toccare quello del workbook.
    const manifest = refreshArchiveManifest(
      JSON.parse(JSON.stringify(wb.manifest ?? {})) as Record<string, unknown>,
      archive
    );

    archive.entries.set('manifest.json', encodeJson(manifest));
    archive.entries.set('content.json', encodeJson(wb.content));

    const bytes = await buildArchiveBytes(archive);
    const validation = await validateArchiveBytes(bytes);

    return { bytes, validation, revision };
  }

  /**
   * Hash SHA-256 atteso del file su disco: il salvataggio lo confronta per rilevare
   * modifiche esterne prima di riscrivere il file aperto.
   */
  public expectedFileHash(): string {
    return this.ensureWorkbook().originalHash;
  }

  /**
   * Segna il workbook come salvato dopo che i byte sono stati scritti da un
   * adapter esterno (Electron IPC, File System Access API). Opzionalmente
   * aggiorna il percorso (Salva con nome).
   */
  public markSaved(path?: string, contentHash?: string, revision?: number): WorkbookDto {
    const wb = this.ensureWorkbook();
    wb.markSaved(path, contentHash, revision);
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

    const { bytes, revision } = await this.prepareArchiveBytes();
    // Il controllo di conflitto vale solo se si riscrive il file che abbiamo aperto.
    const expectedHash = target === wb.path ? wb.originalHash : undefined;
    const report = await platform.atomicWrite(target, bytes, { makeBackup: true, expectedHash });

    // Rilegge e rivalida ciò che è finito su disco prima di dichiararlo salvato.
    const writtenBytes = await platform.readFile(target);
    const validation = await validateArchiveBytes(writtenBytes);
    const contentHash = await sha256HexAsync(writtenBytes);
    wb.markSaved(target, contentHash, revision);

    return {
      path: target,
      backup: report.backup,
      bytes: bytes.length,
      validation,
    };
  }

  public async saveAs(newPath: string, force: boolean = false): Promise<SaveResultDto> {
    return await this.save(force, newPath);
  }
}

/** Dimensione in px della formula: 1,25 volte la dimensione del testo del blocco, o il valore di riferimento. */
function emPxForFontSize(fontPx: number | undefined): number {
  return fontPx ? fontPx * FORMULA_TO_FONT_RATIO : DEFAULT_EM_PX;
}

function isRootTopic(content: Sheet[], topicId: string): boolean {
  return content.some((sheet) => sheet.rootTopic?.id === topicId);
}

/** Legge un payload degli appunti (testo JSON o oggetto già letto) e ne verifica la forma. */
function parseClipboardPayload(payload: string | XmapClipboardPayload): XmapClipboardPayload {
  let data: XmapClipboardPayload;
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload) as XmapClipboardPayload;
    } catch {
      throw new XmapError(CODE_INVALID_INPUT, 'Dati negli appunti non validi: formato JSON non valido.');
    }
  } else {
    data = payload;
  }

  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.xmapStudioClipboard !== 'number' ||
    !data.topic ||
    typeof data.topic !== 'object'
  ) {
    throw new XmapError(CODE_INVALID_INPUT, 'Dati negli appunti non validi: blocco XMap Studio non riconosciuto.');
  }
  return data;
}

/** Aggiunge `child` ai figli `attached` di `parent`, creando i contenitori mancanti. */
function appendAttachedChild(parent: Topic, child: Topic): void {
  if (!parent.children) parent.children = {};
  if (!parent.children.attached) parent.children.attached = [];
  parent.children.attached.push(child);
}

/** Codifica in base64 i file di `store` elencati in `names`; quelli assenti vengono omessi. */
function encodeAssets(store: Map<string, Uint8Array>, names: Iterable<string>): Record<string, string> {
  return Object.fromEntries(
    Array.from(names).flatMap((name) => {
      const bytes = store.get(name);
      return bytes ? [[name, bytesToBase64(bytes)] as const] : [];
    })
  );
}

/** Ultimo segmento di un percorso, con "/" e "\" come separatori. */
function fileNameFromPath(filePath: string): string | undefined {
  return filePath.split(/[\\/]/).pop();
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Aggiorna `manifest` con le risorse e gli allegati di `archive`. Il manifest viene mutato: va passato un oggetto proprio. */
function refreshArchiveManifest(manifest: Record<string, unknown>, archive: RawArchive): Manifest {
  const updated = refreshManifest(manifest, archive.resources.keys(), true);
  registerEntries(
    updated,
    Array.from(archive.entries.keys()).filter((name) => name.startsWith('attachments/'))
  );
  return updated;
}

/** Intervallo di figli `[start, end]` (indici inclusi) di `topic`; senza estremi copre tutti i figli. */
function resolveChildRange(
  topic: Topic,
  start: number | undefined,
  end: number | undefined
): { start: number; end: number } {
  const childCount = topic.children?.attached?.length ?? 0;
  const rangeStart = start ?? 0;
  const rangeEnd = end ?? Math.max(0, childCount - 1);
  validateChildRange(rangeStart, rangeEnd, childCount);
  return { start: rangeStart, end: rangeEnd };
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
