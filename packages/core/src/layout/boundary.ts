import type { BoundaryView, SheetDto, TopicView } from '../state/types.js';
import type { Layout, LayoutNode } from './types.js';

/** Margine (px logici) tra i blocchi racchiusi e il bordo della cornice. */
export const BOUNDARY_PADDING = 8.0;

/** Fascia in alto della cornice riservata al titolo, aggiunta solo se la cornice ha un titolo. */
export const BOUNDARY_TITLE_BAND = 18.0;

/**
 * Cornice XMind in coordinate del layout (mondo). Racchiude i blocchi visibili
 * del ramo coperto: il sottoalbero dei figli nel range, o tutto il ramo per `master`.
 */
export interface BoundaryFrame {
  id: string;
  topicId: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Riempimento dal file (`svg:fill`), se presente. */
  fillColor?: string;
  /** Colore del bordo dal file (`line-color`), se presente. */
  lineColor?: string;
  /** Colore del ramo del blocco proprietario: ripiego quando il file non dichiara colori. */
  accent?: string;
}

/** Figli `attached` coperti da una cornice, indici inclusivi. */
interface ChildRange {
  start: number;
  end: number;
}

/** Figli di ciascun blocco, esclusi i liberi (`detached`), nell'ordine del foglio. */
type ChildIndex = ReadonlyMap<string, TopicView[]>;

/** Blocchi visibili indicizzati per foglio e id: i collassati non compaiono nel layout. */
type NodeIndex = ReadonlyMap<string, LayoutNode>;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Accetta `"(0,2)"` (indici inclusivi); rifiuta `"0,2"`, `"(a,b)"` e `"(2,1)"`
 * (inizio dopo fine, il controllo è in `parseBoundaryRange`).
 * Prova: https://regex101.com/?regex=%5E%5C((%5Cd%2B),(%5Cd%2B)%5C)%24&testString=(0%2C2)%0A0%2C2%0A(a%2Cb)
 */
const CHILD_RANGE_PATTERN = /^\((\d+),(\d+)\)$/;

/** Margine sommato sui due lati della cornice (sinistra + destra, alto + basso). */
const TOTAL_PADDING = BOUNDARY_PADDING + BOUNDARY_PADDING;

/**
 * Calcola le cornici di tutte le cornici dei fogli dati, a partire dal layout già
 * calcolato. Usa solo le coordinate dei blocchi del layout: vale per qualunque
 * lato del ramo. Le cornici senza blocchi visibili (ramo chiuso) non vengono emesse.
 */
export function layoutBoundaries(layout: Layout, sheets: readonly SheetDto[]): BoundaryFrame[] {
  const nodes = indexNodes(layout.nodes);
  return sheets.flatMap((sheet) => {
    const children = indexChildren(sheet.topics);
    return sheet.topics.flatMap((topic) =>
      topic.boundaries.flatMap((boundary) => {
        const frame = boundaryFrame(boundary, topic, children, nodes);
        return frame ? [frame] : [];
      })
    );
  });
}

function nodeKey(sheetIndex: number, topicId: string): string {
  return `${sheetIndex}\u0000${topicId}`;
}

function indexNodes(nodes: readonly LayoutNode[]): NodeIndex {
  return new Map(nodes.map((node) => [nodeKey(node.sheetIndex, node.id), node]));
}

function indexChildren(topics: readonly TopicView[]): ChildIndex {
  const index = new Map<string, TopicView[]>();
  for (const topic of topics) {
    if (!topic.parentId || topic.group === 'detached') continue;
    const siblings = index.get(topic.parentId);
    if (siblings) {
      siblings.push(topic);
    } else {
      index.set(topic.parentId, [topic]);
    }
  }
  return index;
}

function boundaryFrame(
  boundary: BoundaryView,
  owner: TopicView,
  children: ChildIndex,
  nodes: NodeIndex
): BoundaryFrame | undefined {
  const range = parseBoundaryRange(boundary.range);
  if (!range) return undefined;

  const members = range === 'master' ? [owner] : attachedMembers(children.get(owner.id) ?? [], range);
  if (!members) return undefined;

  const visible = members.flatMap((member) => visibleBranch(member, children, nodes));
  if (visible.length === 0) return undefined;

  const box = boundsOf(visible);
  const titleBand = boundary.title ? BOUNDARY_TITLE_BAND : 0;
  const accent = nodes.get(nodeKey(owner.sheetIndex, owner.id))?.accent;
  return {
    id: boundary.id,
    topicId: owner.id,
    title: boundary.title,
    x: box.minX - BOUNDARY_PADDING,
    y: box.minY - BOUNDARY_PADDING - titleBand,
    w: box.maxX - box.minX + TOTAL_PADDING,
    h: box.maxY - box.minY + TOTAL_PADDING + titleBand,
    fillColor: boundary.fillColor,
    lineColor: boundary.lineColor,
    accent,
  };
}

/** `undefined` se il range non è valido o supera i figli `attached` del blocco. */
function parseBoundaryRange(range: string): ChildRange | 'master' | undefined {
  if (range === 'master') return 'master';
  const match = CHILD_RANGE_PATTERN.exec(range);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start <= end ? { start, end } : undefined;
}

function attachedMembers(owned: readonly TopicView[], range: ChildRange): TopicView[] | undefined {
  const attached = owned.filter((child) => child.group === 'attached');
  if (range.end >= attached.length) return undefined;
  return attached.slice(range.start, range.end + 1);
}

/**
 * Blocchi visibili del ramo che parte da `root`. Un blocco collassato non ha
 * nodi nel layout, quindi i suoi discendenti non vengono raccolti.
 */
function visibleBranch(root: TopicView, children: ChildIndex, nodes: NodeIndex): LayoutNode[] {
  const own = nodes.get(nodeKey(root.sheetIndex, root.id));
  const below = (children.get(root.id) ?? []).flatMap((child) => visibleBranch(child, children, nodes));
  return own ? [own, ...below] : below;
}

function boundsOf(nodes: readonly LayoutNode[]): Box {
  return nodes.reduce<Box>(
    (box, node) => ({
      minX: Math.min(box.minX, node.x),
      minY: Math.min(box.minY, node.y),
      maxX: Math.max(box.maxX, node.x + node.w),
      maxY: Math.max(box.maxY, node.y + node.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}
