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
/** Posizione sentinella: lo stato su disco non è più nella cronologia. */
const UNREACHABLE = -1;

export class OpenWorkbook {
  public path: string | null;
  public fileName: string;
  public archive: RawArchive;
  public content: Sheet[];
  public manifest: Record<string, unknown>;
  public history: Sheet[][];
  public pos: number;
  public savedPos: number;
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
    this.content = cloneSheets(content);
    this.manifest = manifest;
    this.history = [cloneSheets(content)];
    this.pos = 0;
    this.savedPos = 0;
    this.xmindRunning = xmindRunning;
    this.originalHash = originalHash;
  }

  public isDirty(): boolean {
    return this.pos !== this.savedPos;
  }

  public canUndo(): boolean {
    return this.pos > 0;
  }

  public canRedo(): boolean {
    return this.pos + 1 < this.history.length;
  }

  public pushHistory(): void {
    // Troncamento se siamo tornati indietro: se lo stato salvato stava nel
    // ramo redo scartato, non è più raggiungibile e nessuna posizione futura
    // può coincidere con il disco.
    if (this.pos + 1 < this.history.length) {
      this.history.splice(this.pos + 1);
      if (this.savedPos > this.pos) this.savedPos = UNREACHABLE;
    }
    this.history.push(cloneSheets(this.content));
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
      // Se lo stato salvato esce dalla cronologia diventa irraggiungibile.
      this.savedPos = this.savedPos > 0 ? this.savedPos - 1 : UNREACHABLE;
    }
    this.pos = this.history.length - 1;
  }

  /** Sostituisce l'ultimo snapshot con lo stato corrente (fonde due modifiche in un solo passo di undo). */
  public replaceHistoryTop(): void {
    if (this.pos !== this.history.length - 1) {
      this.pushHistory();
      return;
    }
    this.history[this.pos] = cloneSheets(this.content);
  }

  public undo(): void {
    if (this.canUndo()) {
      this.pos--;
      this.content = cloneSheets(this.history[this.pos]);
    }
  }

  public redo(): void {
    if (this.canRedo()) {
      this.pos++;
      this.content = cloneSheets(this.history[this.pos]);
    }
  }

  public markSaved(newPath?: string, newHash?: string): void {
    if (!newHash) throw new XmapError(CODE_INVALID_INPUT, 'Hash del file salvato mancante.');
    if (newPath) {
      this.path = newPath;
      this.fileName = newPath.split(/[\\/]/).pop() || newPath;
    }
    this.originalHash = newHash;
    this.savedPos = this.pos;
  }

  public toDto(): WorkbookDto {
    const sheetsDto: SheetDto[] = this.content.map((sheet, index) => {
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
    });

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
