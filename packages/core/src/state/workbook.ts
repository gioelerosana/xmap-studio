import { readControlPoints, resolveRelationshipStyle } from '../model/relationship.js';
import { readTextStyle, readTitleRuns } from '../model/style.js';
import { readSheetTheme } from '../model/theme.js';
import { CODE_INVALID_INPUT, XmapError } from '../errors.js';
import { RawArchive } from '../archive/types.js';
import { isTopicFolded } from '../model/edit.js';
import { Boundary, CHILD_GROUPS, Sheet, Topic } from '../model/types.js';
import {
  topicCustomWidth,
  topicFillColor,
  topicHref,
  topicIsPlainImage,
  topicLabels,
  topicLatex,
  topicMarkerIds,
  topicNotesText,
  topicPosition,
  topicTitle,
} from '../model/utils.js';
import {
  BoundaryView,
  RelationshipView,
  SheetDto,
  SummaryView,
  TaskView,
  TopicView,
  WorkbookDto,
} from './types.js';

const MAX_HISTORY = 200;
/**
 * Tetto della cronologia in caratteri (~64 MB per testo latino): con una mappa
 * grande 200 snapshot completi occuperebbero centinaia di MB, e su iPad/telefono
 * il sistema chiude la PWA. Si scartano i passi più vecchi, mai l'ultimo.
 */
const MAX_HISTORY_CHARS = 64 * 1024 * 1024;

export class OpenWorkbook {
  public path: string | null;
  public fileName: string;
  public archive: RawArchive;
  public content: Sheet[];
  public manifest: Record<string, unknown>;
  /**
   * Snapshot serializzati (JSON) del contenuto: una sola `JSON.stringify` per
   * modifica invece di stringify + parse, e molta meno memoria di un albero di oggetti.
   */
  public history: string[];
  /**
   * Revisione di ogni snapshot, unica per tutta la vita del workbook: lo stato
   * salvato si riconosce dalla revisione, non dalla posizione, che cambia con
   * troncamenti, scorrimento della cronologia e fusioni (`replaceHistoryTop`).
   */
  private revisions: number[];
  private nextRevision: number;
  /** Revisione scritta su disco; `null` se nessuno snapshot coincide più con il file. */
  private savedRevision: number | null;
  public pos: number;
  /** Somma delle lunghezze degli snapshot in `history`. */
  private historyChars: number;
  public xmindRunning: string[];
  public originalHash: string;

  constructor(
    path: string | null,
    fileName: string,
    archive: RawArchive,
    content: Sheet[],
    manifest: Record<string, unknown> = {},
    xmindRunning: string[] = [],
    originalHash: string = ''
  ) {
    this.path = path;
    this.fileName = fileName;
    this.archive = archive;
    const snapshot = JSON.stringify(content);
    this.content = JSON.parse(snapshot) as Sheet[];
    this.manifest = manifest;
    this.history = [snapshot];
    this.historyChars = snapshot.length;
    this.revisions = [0];
    this.nextRevision = 1;
    this.savedRevision = 0;
    this.pos = 0;
    this.xmindRunning = xmindRunning;
    this.originalHash = originalHash;
  }

  public isDirty(): boolean {
    return this.revisions[this.pos] !== this.savedRevision;
  }

  /** Revisione dello stato corrente: da passare a `markSaved` se nel frattempo si è continuato a modificare. */
  public currentRevision(): number {
    return this.revisions[this.pos];
  }

  public canUndo(): boolean {
    return this.pos > 0;
  }

  public canRedo(): boolean {
    return this.pos + 1 < this.history.length;
  }

  public pushHistory(): void {
    const snapshot = JSON.stringify(this.content);
    // Nessun cambiamento reale (es. stesso stile riapplicato): niente passo di
    // undo vuoto e la mappa non diventa "modificata".
    if (snapshot === this.history[this.pos]) return;
    // Troncamento se siamo tornati indietro: il ramo redo si scarta.
    if (this.pos + 1 < this.history.length) {
      for (const dropped of this.history.splice(this.pos + 1)) this.historyChars -= dropped.length;
      this.revisions.splice(this.pos + 1);
    }
    this.history.push(snapshot);
    this.historyChars += snapshot.length;
    this.revisions.push(this.nextRevision++);
    while (
      this.history.length > 1 &&
      (this.history.length > MAX_HISTORY || this.historyChars > MAX_HISTORY_CHARS)
    ) {
      this.historyChars -= this.history[0].length;
      this.history.shift();
      this.revisions.shift();
    }
    this.pos = this.history.length - 1;
  }

  /** Sostituisce l'ultimo snapshot con lo stato corrente (fonde due modifiche in un solo passo di undo). */
  public replaceHistoryTop(): void {
    if (this.pos !== this.history.length - 1) {
      this.pushHistory();
      return;
    }
    const snapshot = JSON.stringify(this.content);
    if (snapshot === this.history[this.pos]) return;
    this.historyChars += snapshot.length - this.history[this.pos].length;
    this.history[this.pos] = snapshot;
    // Contenuto nuovo, revisione nuova: se lo snapshot era quello salvato, ora non lo è più.
    this.revisions[this.pos] = this.nextRevision++;
  }

  public undo(): void {
    if (this.canUndo()) {
      this.pos--;
      this.content = JSON.parse(this.history[this.pos]) as Sheet[];
    }
  }

  public redo(): void {
    if (this.canRedo()) {
      this.pos++;
      this.content = JSON.parse(this.history[this.pos]) as Sheet[];
    }
  }

  /**
   * Segna come salvata la revisione `revision` (default: quella corrente). Chi
   * salva in modo asincrono passa la revisione dei byte scritti, così le
   * modifiche fatte durante la scrittura restano "non salvate".
   */
  public markSaved(newPath?: string, newHash?: string, revision?: number, newFileName?: string): void {
    if (!newHash) throw new XmapError(CODE_INVALID_INPUT, 'Hash del file salvato mancante.');
    if (newPath) {
      this.path = newPath;
      this.fileName = newPath.split(/[\\/]/).pop() || newPath;
    }
    // Senza percorso (browser, Nextcloud) il nome scelto in "Salva con nome" arriva a parte.
    if (newFileName) this.fileName = newFileName;
    this.originalHash = newHash;
    this.savedRevision = revision ?? this.currentRevision();
  }

  /** DTO di un solo foglio: per il layout della mappa non serve ricostruire gli altri. */
  public sheetDto(index: number): SheetDto | undefined {
    const sheet = this.content[index];
    return sheet ? buildSheetDto(sheet, index) : undefined;
  }

  public toDto(): WorkbookDto {
    const sheetsDto: SheetDto[] = this.content.map((sheet, index) => buildSheetDto(sheet, index));

    return {
      path: this.path,
      fileName: this.fileName,
      dirty: this.isDirty(),
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      sheets: sheetsDto,
      xmindRunning: this.xmindRunning,
    };
  }
}

function buildSheetDto(sheet: Sheet, index: number): SheetDto {
  const topics: TopicView[] = [];
  if (sheet.rootTopic) {
    collectTopicViews(sheet.rootTopic, index, undefined, 0, 'root', topics);
  }

  const relationships: RelationshipView[] = (sheet.relationships || []).map((rel) => ({
    id: rel.id || '',
    end1Id: rel.end1Id || '',
    end2Id: rel.end2Id || '',
    title: rel.title || '',
    style: resolveRelationshipStyle(sheet, rel),
    controlPoints: readControlPoints(rel),
  }));

  return {
    index,
    id: sheet.id,
    title: sheet.title || (sheet.rootTopic ? topicTitle(sheet.rootTopic) : '') || `Foglio ${index + 1}`,
    topics,
    relationships,
    theme: readSheetTheme(sheet),
  };
}

export function cloneSheets(sheets: Sheet[]): Sheet[] {
  return JSON.parse(JSON.stringify(sheets));
}

/** Oggetto JSON (non `null`): restringe `unknown` senza cast. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Legge una proprietà di `style.properties` solo se è una stringa. */
function styleString(style: unknown, key: string): string | undefined {
  if (!isRecord(style) || !isRecord(style.properties)) return undefined;
  const value = style.properties[key];
  return typeof value === 'string' ? value : undefined;
}

function boundaryView(boundary: Boundary): BoundaryView {
  const title = typeof boundary.title === 'string' ? boundary.title.trim() : '';
  return {
    id: boundary.id || '',
    range: boundary.range || '',
    title: title.length > 0 ? title : undefined,
    fillColor: styleString(boundary.style, 'svg:fill'),
    lineColor: styleString(boundary.style, 'line-color'),
  };
}

function collectTopicViews(
  topic: Topic,
  sheetIndex: number,
  parentId: string | undefined,
  depth: number,
  group: string,
  out: TopicView[]
): void {
  const id = topic.id || '';
  const title = topicTitle(topic);
  const latex = topicLatex(topic);
  const isEquation = latex !== undefined;
  const isPlainImage = topicIsPlainImage(topic);

  let kind: 'equation' | 'image' | 'text' = 'text';
  let displayTitle = title;
  if (isEquation) {
    kind = 'equation';
    displayTitle = `$${latex}$`;
  } else if (isPlainImage) {
    kind = 'image';
    displayTitle = title.length > 0 ? title : '[Immagine]';
  }

  let childCount = 0;
  if (topic.children) {
    for (const g of CHILD_GROUPS) {
      const list = topic.children[g];
      if (Array.isArray(list)) {
        childCount += list.length;
      }
    }
  }

  const boundaries: BoundaryView[] = (topic.boundaries || []).map(boundaryView);

  const summaries: SummaryView[] = (topic.summaries || []).map((s) => ({
    id: s.topicId || s.id || '',
    range: s.range || '',
  }));

  // TaskView
  let task: TaskView | undefined;
  const extTask = topic.extensions?.find((e) => e.provider === 'org.xmind.ui.task')?.content as
    | Record<string, unknown>
    | undefined;
  if (extTask) {
    task = {
      priority: typeof extTask.priority === 'number' ? extTask.priority : undefined,
      progress: typeof extTask.progress === 'number' ? extTask.progress : undefined,
      startDate: typeof extTask.startDate === 'string' ? extTask.startDate : undefined,
      dueDate: typeof extTask.dueDate === 'string' ? extTask.dueDate : undefined,
    };
  }

  const view: TopicView = {
    id,
    sheetIndex,
    parentId,
    depth,
    group,
    title,
    displayTitle,
    kind,
    latex,
    imageSrc: topic.image?.src,
    imageW: topic.image?.width,
    imageH: topic.image?.height,
    notes: topicNotesText(topic) || '',
    notesDisplay: topic.notesDisplay,
    labels: topicLabels(topic),
    markers: topicMarkerIds(topic),
    href: topicHref(topic),
    childCount,
    folded: isTopicFolded(topic),
    boundaries,
    summaries,
    task,
    position: topicPosition(topic),
    customWidth: topicCustomWidth(topic),
    fillColor: topicFillColor(topic),
    structureClass: topic.structureClass,
    textStyle: readTextStyle(topic),
    titleRuns: readTitleRuns(topic),
  };

  out.push(view);

  if (topic.children) {
    for (const g of CHILD_GROUPS) {
      const list = topic.children[g];
      if (Array.isArray(list)) {
        for (const child of list) {
          collectTopicViews(child, sheetIndex, id, depth + 1, g, out);
        }
      }
    }
  }
}
