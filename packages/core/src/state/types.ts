import { ValidationReport } from '../safety/validate.js';

export interface RelationshipView {
  id: string;
  end1Id: string;
  end2Id: string;
  title: string;
}

export interface BoundaryView {
  id: string;
  range: string;
}

export interface SummaryView {
  id: string;
  range: string;
}

export interface TaskView {
  priority?: number;
  progress?: number;
  startDate?: string;
  dueDate?: string;
}

export interface TopicView {
  id: string;
  sheetIndex: number;
  parentId?: string;
  depth: number;
  group: string;
  title: string;
  displayTitle: string;
  kind: 'equation' | 'image' | 'text';
  latex?: string;
  /** Titolo che sembra LaTeX ma non è un'equazione: solo suggerimento per la UI. */
  latexSuggestion?: string;
  imageSrc?: string;
  imageW?: number;
  imageH?: number;
  notes: string;
  notesDisplay?: string;
  labels: string[];
  markers: string[];
  href?: string;
  path: string[];
  childCount: number;
  boundaries: BoundaryView[];
  summaries: SummaryView[];
  task?: TaskView;
  position?: { x: number; y: number };
  customWidth?: number;
  fillColor?: string;
}

export interface SheetDto {
  index: number;
  id?: string;
  title: string;
  topics: TopicView[];
  relationships: RelationshipView[];
}

export interface WorkbookDto {
  /** Percorso su disco; `null` per mappe nuove o aperte senza percorso (browser). */
  path: string | null;
  fileName: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  sheets: SheetDto[];
  xmindRunning: string[];
}

export interface BatchSpec {
  topicId: string;
  latex: string;
  titleMode?: import('../latex/equation.js').TitleMode;
  fontSizePx?: number;
  color?: string;
}

export interface BatchResultDto {
  modified: number;
  totalLatex: number;
  errors: { topicId: string; error: string }[];
}

export interface SaveResultDto {
  path: string;
  backup?: string;
  bytes: number;
  validation: ValidationReport;
}

export interface MergeResultDto {
  addedSheets: number;
  addedTopics: number;
  totalSheets: number;
  addedResources: number;
}
