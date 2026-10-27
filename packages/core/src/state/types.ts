import { ValidationReport } from '../safety/validate.js';

/**
 * Stile di testo di un blocco o di un frammento di titolo, letto da
 * `style.properties` (`fo:font-weight`, `fo:font-style`, `fo:text-decoration`,
 * `fo:color`, `fo:font-size`). Campi assenti = valore del tema.
 */
export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** Colore CSS (`#RRGGBB` o `#RRGGBBAA`). */
  color?: string;
  /** Dimensione in px (da `fo:font-size`, es. `14pt`). */
  fontSizePx?: number;
}

/** Frammento di titolo con stile proprio (da `attributedTitle` di XMind). */
export interface TitleRun extends TextStyle {
  text: string;
}

/** Forma XMind di una relazione (`shape-class` senza il prefisso `org.xmind.relationshipShape.`). */
export type RelationshipShape = 'curved' | 'straight' | 'angled' | 'zigzag';

export type LinePattern = 'solid' | 'dash' | 'dot' | 'dash-dot';

/** Punta di freccia (`arrow-*-class` senza il prefisso `org.xmind.arrowShape.`). */
export type ArrowShape = 'none' | 'triangle' | 'spearhead' | 'dot' | 'square' | 'diamond' | 'attached';

/** Stile risolto di una relazione: proprietà della relazione sopra quelle di `theme.relationship`. */
export interface RelationshipStyle {
  shape: RelationshipShape;
  linePattern: LinePattern;
  lineWidth: number;
  /** Colore CSS; assente = colore neutro della vista. */
  lineColor?: string;
  arrowBegin: ArrowShape;
  arrowEnd: ArrowShape;
}

/** Punto di controllo XMind, relativo al centro del blocco di estremità. */
export interface Point {
  x: number;
  y: number;
}

export interface RelationshipView {
  id: string;
  end1Id: string;
  end2Id: string;
  title: string;
  style: RelationshipStyle;
  /** `controlPoints["0"]` (lato end1) e `["1"]` (lato end2), se presenti nel file. */
  controlPoints?: [Point | undefined, Point | undefined];
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
  /** Struttura XMind dichiarata (`structureClass`), es. `org.xmind.ui.tree.right`. */
  structureClass?: string;
  /** Stile del blocco intero (`style.properties`). */
  textStyle?: TextStyle;
  /** Titolo a frammenti (`attributedTitle`), solo se coerente con `title`. */
  titleRuns?: TitleRun[];
}

export interface SheetDto {
  index: number;
  id?: string;
  title: string;
  topics: TopicView[];
  relationships: RelationshipView[];
  /** Tema del foglio (`sheet.theme`), letto da `readSheetTheme`. */
  theme?: SheetTheme;
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

/** Livello di stile del tema: `centralTopic`, `mainTopic`, `subTopic` di `sheet.theme`. */
export type ThemeLevel = 'central' | 'main' | 'sub';

/** Forma del blocco (`shape-class` senza il prefisso `org.xmind.topicShape.`), tra quelle disegnate dall'app. */
export type TopicShape = 'roundedRect' | 'rect' | 'ellipse' | 'underline';

/** Linea dei rami verso i figli (`line-class` senza il prefisso `org.xmind.branchConnection.`). */
export type BranchLine = 'curve' | 'straight' | 'elbow' | 'roundedElbow';

/**
 * Stile di un livello letto dal tema del foglio. Campi assenti = valore
 * `inherited`, sconosciuto o mancante: la vista usa il proprio default.
 */
export interface ThemeLevelStyle {
  /** Riempimento pieno (`svg:fill` esadecimale con `fill-pattern` diverso da `none`). */
  fill?: string;
  /** Colore del testo (`fo:color`). */
  textColor?: string;
  fontFamily?: string;
  /** Dimensione in pt (`fo:font-size`). */
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  shape?: TopicShape;
  /** Linea verso i figli. */
  line?: BranchLine;
  /** Spessore della linea verso i figli, in pt. */
  lineWidthPt?: number;
}

/** Tema del foglio, nella parte che l'app sa disegnare e modificare. */
export interface SheetTheme {
  /** Colori dei rami principali (`map.multi-line-colors`), in ordine. */
  branchColors?: string[];
  /** Sfondo della mappa (`map.svg:fill`). */
  background?: string;
  levels: Record<ThemeLevel, ThemeLevelStyle>;
}
