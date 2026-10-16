import { trunkX } from '@xmap/core';
import type { Layout, LayoutNode, Point } from '@xmap/core';

/** Dove inserire il blocco trascinato rispetto al bersaglio (stessi valori di `TopicTree`). */
export type DropPlacement = 'before' | 'after' | 'into';

/** Margine con cui si allarga il rettangolo di un blocco per l'hit-test (px mondo). */
export const DROP_PAD = 6;
/** Frazione dell'altezza (e minimo in px) delle fasce alta/bassa che significano before/after. */
const BAND_FRACTION = 0.3;
const BAND_MIN_PX = 12;
/** Raggio di ricerca del blocco "più vicino a sinistra" quando si è in spazio vuoto. */
const NEAR_MAX_DX = 260;
const NEAR_MAX_DY = 120;
const NEAR_DY_WEIGHT = 1.5;
/** Distanza orizzontale tipica genitore → figlio (come `hGap` del layout). */
const CHILD_GAP_X = 50;
const SIBLING_GAP_Y = 16;

/** Relazioni genitore/figli ricostruite dagli archi del layout (indici in `layout.nodes`). */
export interface DragIndex {
  parent: number[];
  /** Solo i figli `attached`, nell'ordine dei fratelli. */
  children: number[][];
  byId: Map<string, number>;
}

export function buildDragIndex(layout: Layout): DragIndex {
  const parent = layout.nodes.map(() => -1);
  const children = layout.nodes.map(() => [] as number[]);
  const byId = new Map<string, number>();
  layout.nodes.forEach((n, i) => byId.set(n.id, i));
  for (const edge of layout.edges) {
    parent[edge.child] = edge.parent;
    if (layout.nodes[edge.child]?.group === 'attached') children[edge.parent]?.push(edge.child);
  }
  return { parent, children, byId };
}

/** Un blocco si trascina se è un figlio `attached`: radice, floating e sommari restano fermi. */
export function isDraggable(layout: Layout, idx: DragIndex, i: number): boolean {
  const n = layout.nodes[i];
  return Boolean(n) && n.group === 'attached' && idx.parent[i] !== -1;
}

/** Il blocco `i` e tutti i suoi discendenti visibili. */
export function subtreeOf(layout: Layout, i: number): Set<number> {
  const out = new Set<number>([i]);
  // Gli archi includono anche i sommari: si seguono tutti i figli, non solo gli `attached`.
  const all = new Map<number, number[]>();
  for (const edge of layout.edges) {
    const list = all.get(edge.parent);
    if (list) list.push(edge.child);
    else all.set(edge.parent, [edge.child]);
  }
  const stack = [i];
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    for (const c of all.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

export type DropIndicator =
  /** Linea di inserimento tra fratelli. */
  | { kind: 'line'; x1: number; x2: number; y: number }
  /** Anteprima del connettore e del posto del nuovo ultimo figlio. */
  | { kind: 'child'; from: Point; to: Point; w: number; h: number };

export interface DropTarget {
  targetId: string;
  targetIndex: number;
  placement: DropPlacement;
  indicator: DropIndicator;
}

function inside(n: LayoutNode, p: Point, pad: number): boolean {
  return p.x >= n.x - pad && p.x <= n.x + n.w + pad && p.y >= n.y - pad && p.y <= n.y + n.h + pad;
}

function canBeTargetInto(layout: Layout, idx: DragIndex, i: number): boolean {
  return layout.nodes[i].group === 'attached' || idx.parent[i] === -1;
}

function canBeSibling(layout: Layout, idx: DragIndex, i: number): boolean {
  return layout.nodes[i].group === 'attached' && idx.parent[i] !== -1;
}

function makeTarget(
  layout: Layout,
  idx: DragIndex,
  sourceIndex: number,
  targetIndex: number,
  placement: DropPlacement
): DropTarget | null {
  const nodes = layout.nodes;
  const target = nodes[targetIndex];
  const source = nodes[sourceIndex];
  if (placement === 'into') {
    if (!canBeTargetInto(layout, idx, targetIndex)) return null;
    const kids = idx.children[targetIndex].filter((c) => c !== sourceIndex);
    // Già ultimo figlio del bersaglio: lo spostamento non cambierebbe nulla.
    const all = idx.children[targetIndex];
    if (all[all.length - 1] === sourceIndex) return null;
    const last = kids.length > 0 ? nodes[kids[kids.length - 1]] : undefined;
    const below = target.childrenBelow;
    const from: Point = below
      ? { x: trunkX(target), y: target.y + target.h }
      : { x: target.x + target.w, y: target.y + target.h / 2 };
    const to: Point = last
      ? { x: last.x, y: last.y + last.h + SIBLING_GAP_Y + source.h / 2 }
      : below
      ? { x: trunkX(target) + 24, y: target.y + target.h + SIBLING_GAP_Y + source.h / 2 }
      : { x: target.x + target.w + CHILD_GAP_X, y: target.y + target.h / 2 };
    return {
      targetId: target.id,
      targetIndex,
      placement,
      indicator: { kind: 'child', from, to, w: Math.min(source.w, 220), h: source.h },
    };
  }

  if (!canBeSibling(layout, idx, targetIndex)) return null;
  const parent = idx.parent[targetIndex];
  const all = idx.children[parent];
  const pos = all.indexOf(targetIndex);
  if (pos < 0) return null;
  // Il blocco è già dove verrebbe inserito.
  if (placement === 'before' && all[pos - 1] === sourceIndex) return null;
  if (placement === 'after' && all[pos + 1] === sourceIndex) return null;

  const sibs = all.filter((c) => c !== sourceIndex);
  const spos = sibs.indexOf(targetIndex);
  const neighbour = placement === 'before' ? nodes[sibs[spos - 1]] : nodes[sibs[spos + 1]];
  const y =
    placement === 'before'
      ? neighbour
        ? (neighbour.y + neighbour.h + target.y) / 2
        : target.y - SIBLING_GAP_Y / 2
      : neighbour
      ? (target.y + target.h + neighbour.y) / 2
      : target.y + target.h + SIBLING_GAP_Y / 2;
  let x1 = Infinity;
  let x2 = -Infinity;
  for (const s of sibs) {
    x1 = Math.min(x1, nodes[s].x);
    x2 = Math.max(x2, nodes[s].x + nodes[s].w);
  }
  return { targetId: target.id, targetIndex, placement, indicator: { kind: 'line', x1, x2, y } };
}

/**
 * Bersaglio di rilascio per un blocco trascinato, dato il puntatore in coordinate mondo.
 * `excluded` è il sotto-albero trascinato (sé stesso e i discendenti): mai bersaglio.
 *
 * - sopra un blocco: fascia alta/bassa nella metà sinistra → before/after, altrimenti into;
 * - tra due fratelli → before sul secondo;
 * - in spazio vuoto → into sul blocco più vicino a sinistra entro una distanza ragionevole.
 */
export function computeDropTarget(
  layout: Layout,
  idx: DragIndex,
  sourceIndex: number,
  p: Point,
  excluded: Set<number>
): DropTarget | null {
  const nodes = layout.nodes;
  const source = nodes[sourceIndex];
  if (!source) return null;

  for (const i of excluded) {
    if (nodes[i] && inside(nodes[i], p, DROP_PAD)) return null;
  }

  let hit = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (excluded.has(i) || nodes[i].sheetIndex !== source.sheetIndex) continue;
    if (inside(nodes[i], p, DROP_PAD)) {
      hit = i;
      break;
    }
  }
  if (hit >= 0) {
    const n = nodes[hit];
    const band = Math.min(Math.max(n.h * BAND_FRACTION, BAND_MIN_PX), n.h * 0.45);
    const leftHalf = p.x < n.x + n.w / 2;
    if (canBeSibling(layout, idx, hit) && leftHalf) {
      if (p.y < n.y + band) return makeTarget(layout, idx, sourceIndex, hit, 'before');
      if (p.y > n.y + n.h - band) return makeTarget(layout, idx, sourceIndex, hit, 'after');
    }
    return makeTarget(layout, idx, sourceIndex, hit, 'into');
  }

  // Spazio vuoto tra due fratelli consecutivi della stessa colonna.
  for (const list of idx.children) {
    const sibs = list.filter((c) => c !== sourceIndex && nodes[c].sheetIndex === source.sheetIndex);
    for (let k = 0; k + 1 < sibs.length; k++) {
      const a = nodes[sibs[k]];
      const b = nodes[sibs[k + 1]];
      const left = Math.min(a.x, b.x) - DROP_PAD;
      const right = Math.max(a.x + a.w, b.x + b.w) + DROP_PAD;
      if (p.x >= left && p.x <= right && p.y > a.y + a.h && p.y < b.y) {
        return makeTarget(layout, idx, sourceIndex, sibs[k + 1], 'before');
      }
    }
  }

  // Blocco più vicino a sinistra: se è il sotto-albero trascinato, nessun bersaglio.
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.sheetIndex !== source.sheetIndex) continue;
    const dx = p.x - (n.x + n.w);
    const dy = p.y < n.y ? n.y - p.y : p.y > n.y + n.h ? p.y - n.y - n.h : 0;
    if (dx < -DROP_PAD || dx > NEAR_MAX_DX || dy > NEAR_MAX_DY) continue;
    const score = dx + NEAR_DY_WEIGHT * dy;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0 || excluded.has(best)) return null;
  return makeTarget(layout, idx, sourceIndex, best, 'into');
}
