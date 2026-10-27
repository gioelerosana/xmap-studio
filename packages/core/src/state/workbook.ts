import { readControlPoints, resolveRelationshipStyle } from '../model/relationship.js';
import { readTextStyle, readTitleRuns } from '../model/style.js';
import { readSheetTheme } from '../model/theme.js';
import { CODE_INVALID_INPUT, XmapError } from '../errors.js';
import { RawArchive } from '../archive/types.js';
import { CHILD_GROUPS, Sheet, Topic } from '../model/types.js';
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
  suggestedLatex,
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
      this.history.splice(this.pos + 1);
      this.revisions.splice(this.pos + 1);
    }
    this.history.push(snapshot);
    this.revisions.push(this.nextRevision++);
    if (this.history.length > MAX_HISTORY) {
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
  public markSaved(newPath?: string, newHash?: string, revision?: number): void {
    if (!newHash) throw new XmapError(CODE_INVALID_INPUT, 'Hash del file salvato mancante.');
    if (newPath) {
      this.path = newPath;
      this.fileName = newPath.split(/[\\/]/).pop() || newPath;
    }
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
    collectTopicViews(sheet.rootTopic, index, undefined, 0, 'root', [], topics);
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
    title: (sheet.rootTopic ? topicTitle(sheet.rootTopic) : '') || sheet.title || `Foglio ${index + 1}`,
    topics,
    relationships,
    theme: readSheetTheme(sheet),
  };
}

export function cloneSheets(sheets: Sheet[]): Sheet[] {
  return JSON.parse(JSON.stringify(sheets));
}

function collectTopicViews(
  topic: Topic,
  sheetIndex: number,
  parentId: string | undefined,
  depth: number,
  group: string,
  parentPath: string[],
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

  const currentPath = [...parentPath, displayTitle || '(senza titolo)'];

  let childCount = 0;
  if (topic.children) {
    for (const g of CHILD_GROUPS) {
      const list = topic.children[g];
      if (Array.isArray(list)) {
        childCount += list.length;
      }
    }
  }

  const boundaries: BoundaryView[] = (topic.boundaries || []).map((b) => ({
    id: b.id || '',
    range: b.range || '',
  }));

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
    latexSuggestion: suggestedLatex(topic),
    imageSrc: topic.image?.src,
    imageW: topic.image?.width,
    imageH: topic.image?.height,
    notes: topicNotesText(topic) || '',
    notesDisplay: topic.notesDisplay,
    labels: topicLabels(topic),
    markers: topicMarkerIds(topic),
    href: topicHref(topic),
    path: currentPath,
    childCount,
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
          collectTopicViews(child, sheetIndex, id, depth + 1, g, currentPath, out);
        }
      }
    }
  }
}
