import type { Point, RelationshipStyle, TextStyle, TitleRun } from '../state/types.js';

export const DEFAULT_NODE_W = 180.0;
export const DEFAULT_NODE_H = 36.0;

export const BRANCH_COLORS: string[] = [
  '#E65D5D',
  '#E9863F',
  '#C99A12',
  '#79A83B',
  '#1599B5',
  '#7953A9',
];

/** Struttura XMind della Tree Chart verso destra: radice in alto, tronco verticale. */
export const TREE_RIGHT_STRUCTURE = 'org.xmind.ui.tree.right';

/** Larghezza della graffa di un sommario (px logici). */
export const SUMMARY_BRACE_W = 14.0;

/** Distanza massima del tronco della Tree Chart dal bordo sinistro della radice. */
export const TREE_TRUNK_INSET = 36.0;

export interface MapNode {
  id: string;
  title: string;
  displayTitle: string;
  kind: 'equation' | 'image' | 'text' | string;
  latex?: string;
  fillColor?: string;
  accent?: string;
  imageSrc?: string;
  imageW?: number;
  imageH?: number;
  labels: string[];
  markers: string[];
  hasNotes: boolean;
  notes: string;
  childCount: number;
  group: string;
  depth: number;
  parentId?: string;
  sheetIndex: number;
  position?: { x: number; y: number };
  customWidth?: number;
  structureClass?: string;
  textStyle?: TextStyle;
  titleRuns?: TitleRun[];
  /** Figli disposti in colonna (`attached`, `callout`). */
  children: MapNode[];
  /** Sommari: topic del gruppo `summary` agganciati a una graffa, fuori dalla colonna. */
  summaries: MapSummary[];
}

/**
 * Un sommario XMind: la graffa abbraccia i figli `start..=end` (indici in
 * `children` del genitore) e il topic di sommario sta alla sua destra.
 */
export interface MapSummary {
  start: number;
  end: number;
  node: MapNode;
}

export interface LayoutNode {
  id: string;
  title: string;
  displayTitle: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  latex?: string;
  fill?: string;
  accent?: string;
  imageSrc?: string;
  imageW?: number;
  imageH?: number;
  labels: string[];
  markers: string[];
  hasNotes: boolean;
  childCount: number;
  collapsed: boolean;
  group: string;
  depth: number;
  sheetIndex: number;
  position?: { x: number; y: number };
  customWidth?: number;
  /**
   * Vero per la radice di una Tree Chart: i figli scendono lungo un tronco
   * verticale in `trunkX(node)` e l'indicatore di collasso sta sotto il blocco.
   */
  childrenBelow: boolean;
  textStyle?: TextStyle;
  titleRuns?: TitleRun[];
}

/** Forma del connettore: gomito dal lato destro (Logic Chart) o dal tronco (Tree Chart). */
export type EdgeKind = 'logic' | 'tree';

export interface LayoutEdge {
  parent: number;
  child: number;
  group: string;
  kind: EdgeKind;
}

/** Graffa di un sommario: verticale in `x` da `y1` a `y2`, punta verso il nodo `topic`. */
export interface LayoutSummary {
  x: number;
  y1: number;
  y2: number;
  topic: number;
  accent?: string;
}

/** Ascissa del tronco verticale di una Tree Chart (vale per `childrenBelow`). */
export function trunkX(node: Pick<LayoutNode, 'x' | 'w'>): number {
  return node.x + Math.min(node.w / 2, TREE_TRUNK_INSET);
}

export interface LayoutRelationship {
  id: string;
  title?: string;
  from: number;
  to: number;
  accent?: string;
  style: RelationshipStyle;
  controlPoints?: [Point | undefined, Point | undefined];
  /** Geometria già calcolata (`relationshipGeometry`), in coordinate mondo. */
  geometry: RelationshipGeometry;
}

/**
 * Geometria di una relazione: tracciato SVG, punti di estremità, punti di
 * controllo assoluti (maniglie trascinabili) e posizione dell'etichetta.
 */
export interface RelationshipGeometry {
  /** Attributo `d` del path SVG. */
  d: string;
  start: Point;
  end: Point;
  /** Maniglie in coordinate mondo: [lato end1, lato end2]. */
  handles: [Point, Point];
  /** Direzione (radianti) della tangente uscente alle estremità, per le frecce. */
  startAngle: number;
  endAngle: number;
  label: Point;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  summaries: LayoutSummary[];
  relationships: LayoutRelationship[];
  width: number;
  height: number;
}

export interface NodeMetrics {
  measure(node: MapNode): { w: number; h: number };
}

/** Disposizione della radice: Tree Chart (radice in alto, tronco verticale) o Logic Chart. */
export type MapStructure = 'tree' | 'logic';

export interface LayoutOpts {
  hGap: number;
  vGap: number;
  sheetGap: number;
  /**
   * Forza la disposizione della radice solo in visualizzazione; se assente vale
   * la `structureClass` del file. Non modifica mai `content.json`.
   */
  structure?: MapStructure;
}
