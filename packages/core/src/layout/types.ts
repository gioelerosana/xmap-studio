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
  children: MapNode[];
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
}

export interface LayoutEdge {
  parent: number;
  child: number;
  group: string;
}

export interface LayoutRelationship {
  id: string;
  title?: string;
  from: number;
  to: number;
  accent?: string;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  relationships: LayoutRelationship[];
  width: number;
  height: number;
}

export interface NodeMetrics {
  measure(node: MapNode): { w: number; h: number };
}

export interface LayoutOpts {
  hGap: number;
  vGap: number;
  sheetGap: number;
}
