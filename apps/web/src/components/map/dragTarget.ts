import { trunkX } from '@xmap/core';
import type { Layout, LayoutNode, Point } from '@xmap/core';

/** Dove inserire il blocco trascinato rispetto al bersaglio. */
export type DropPlacement = 'before' | 'after' | 'into';

/** Margine con cui si allarga il rettangolo di un blocco per l'hit-test (px mondo). */
export const DROP_PAD = 6;
/** Frazione dell'altezza (e minimo in px) delle fasce alta/bassa che significano before/after. */
const BAND_FRACTION = 0.3;
const BAND_MIN_PX = 12;
/** Raggio di ricerca del blocco "più vicino" (dal lato dei suoi figli) quando si è in spazio vuoto. */
const NEAR_MAX_DX = 260;
const NEAR_MAX_DY = 120;
const NEAR_DY_WEIGHT = 1.5;
/** Distanza orizzontale tipica genitore → figlio (come `hGap` del layout). */
const CHILD_GAP_X = 50;
const SIBLING_GAP_Y = 16;
/** Larghezza massima dell'anteprima del nuovo figlio. */
const PREVIEW_MAX_W = 220;

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
  /** `to` è il bordo interno dell'anteprima: sinistro a destra, destro sul lato sinistro. */
  | { kind: 'child'; from: Point; to: Point; w: number; h: number; side: 'left' | 'right' };

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
    const toLeft = target.side === 'left';
    const from: Point = below
      ? { x: trunkX(target), y: target.y + target.h }
      : { x: toLeft ? target.x : target.x + target.w, y: target.y + target.h / 2 };
    // Sul lato sinistro la colonna dei figli è allineata a destra: `to` è il suo bordo destro.
    const to: Point = last
      ? { x: toLeft ? last.x + last.w : last.x, y: last.y + last.h + SIBLING_GAP_Y + source.h / 2 }
      : below
      ? { x: trunkX(target) + 24, y: target.y + target.h + SIBLING_GAP_Y + source.h / 2 }
      : toLeft
      ? { x: target.x - CHILD_GAP_X, y: target.y + target.h / 2 }
      : { x: target.x + target.w + CHILD_GAP_X, y: target.y + target.h / 2 };
    return {
      targetId: target.id,
      targetIndex,
      placement,
      indicator: { kind: 'child', from, to, w: Math.min(source.w, PREVIEW_MAX_W), h: source.h, side: toLeft ? 'left' : 'right' },
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
 * Dati di un trascinamento che non dipendono dal puntatore, calcolati una volta all'inizio del
 * gesto (`prepareDrop`): a ogni frame `computeDropTargetIn` scorre solo array già filtrati,
 * senza allocazioni.
 */
export interface DropContext {
  layout: Layout;
  idx: DragIndex;
  sourceIndex: number;
  excluded: Set<number>;
  /** Blocchi del foglio della sorgente, in ordine di `layout.nodes` (anche quelli esclusi). */
  sheetNodes: number[];
  /** Come `sheetNodes`, senza il sotto-albero trascinato: candidati dell'hit-test. */
  hitNodes: number[];
  /** Spazi tra fratelli consecutivi, quattro valori ciascuno: `left, right, top, bottom`. */
  gapRects: Float64Array;
  /** Fratello successivo di ogni spazio: bersaglio `before`. */
  gapTargets: number[];
  hasLeftBranches: boolean;
}

export function prepareDrop(layout: Layout, idx: DragIndex, sourceIndex: number, excluded: Set<number>): DropContext {
  const nodes = layout.nodes;
  const sheet = nodes[sourceIndex]?.sheetIndex;
  const sheetNodes: number[] = [];
  const hitNodes: number[] = [];
  let hasLeftBranches = false;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].sheetIndex !== sheet) continue;
    sheetNodes.push(i);
    if (!excluded.has(i)) hitNodes.push(i);
    if (nodes[i].side === 'left') hasLeftBranches = true;
  }
  const rects: number[] = [];
  const gapTargets: number[] = [];
  for (const list of idx.children) {
    const sibs = list.filter((c) => !excluded.has(c) && nodes[c].sheetIndex === sheet);
    for (let k = 0; k + 1 < sibs.length; k++) {
      const a = nodes[sibs[k]];
      const b = nodes[sibs[k + 1]];
      rects.push(Math.min(a.x, b.x) - DROP_PAD, Math.max(a.x + a.w, b.x + b.w) + DROP_PAD, a.y + a.h, b.y);
      gapTargets.push(sibs[k + 1]);
    }
  }
  return {
    layout,
    idx,
    sourceIndex,
    excluded,
    sheetNodes,
    hitNodes,
    gapRects: Float64Array.from(rects),
    gapTargets,
    hasLeftBranches,
  };
}

/**
 * Bersaglio di rilascio per un blocco trascinato, dato il puntatore in coordinate mondo.
 * `excluded` è il sotto-albero trascinato (sé stesso e i discendenti): mai bersaglio.
 *
 * - sopra un blocco: fascia alta/bassa nella metà sinistra → before/after, altrimenti into;
 * - tra due fratelli → before sul secondo;
 * - in spazio vuoto → into sul blocco più vicino dal lato dei suoi figli (a sinistra del puntatore
 *   sui rami destri, a destra sui rami sinistri) entro una distanza ragionevole.
 *
 * Durante un trascinamento si usa `computeDropTargetIn` sul contesto di `prepareDrop`.
 */
export function computeDropTarget(
  layout: Layout,
  idx: DragIndex,
  sourceIndex: number,
  p: Point,
  excluded: Set<number>
): DropTarget | null {
  return computeDropTargetIn(prepareDrop(layout, idx, sourceIndex, excluded), p);
}

/** Come `computeDropTarget`, sul contesto precalcolato di un trascinamento. */
export function computeDropTargetIn(ctx: DropContext, p: Point): DropTarget | null {
  const { layout, idx, sourceIndex, excluded } = ctx;
  const nodes = layout.nodes;
  if (!nodes[sourceIndex]) return null;

  for (const i of excluded) {
    if (nodes[i] && inside(nodes[i], p, DROP_PAD)) return null;
  }

  let hit = -1;
  for (const i of ctx.hitNodes) {
    if (inside(nodes[i], p, DROP_PAD)) {
      hit = i;
      break;
    }
  }
  if (hit >= 0) {
    const n = nodes[hit];
    const band = Math.min(Math.max(n.h * BAND_FRACTION, BAND_MIN_PX), n.h * 0.45);
    // Il lato dei figli è quello verso cui il blocco si aggancia: la metà opposta dà before/after.
    const siblingHalf = n.side === 'left' ? p.x >= n.x + n.w / 2 : p.x < n.x + n.w / 2;
    if (canBeSibling(layout, idx, hit) && siblingHalf) {
      if (p.y < n.y + band) return makeTarget(layout, idx, sourceIndex, hit, 'before');
      if (p.y > n.y + n.h - band) return makeTarget(layout, idx, sourceIndex, hit, 'after');
    }
    return makeTarget(layout, idx, sourceIndex, hit, 'into');
  }

  // Spazio vuoto tra due fratelli consecutivi della stessa colonna; mai tra i figli del
  // sotto-albero trascinato (il blocco finirebbe dentro sé stesso).
  const g = ctx.gapRects;
  for (let k = 0; k < ctx.gapTargets.length; k++) {
    const o = k * 4;
    if (p.x >= g[o] && p.x <= g[o + 1] && p.y > g[o + 2] && p.y < g[o + 3]) {
      return makeTarget(layout, idx, sourceIndex, ctx.gapTargets[k], 'before');
    }
  }

  // Blocco più vicino dal lato dei suoi figli: a sinistra del puntatore sui rami destri, a destra
  // sui rami sinistri (lì i figli crescono verso sinistra), da entrambi i lati per la radice
  // della mappa mentale.
  // Se è il sotto-albero trascinato, nessun bersaglio.
  let best = -1;
  let bestScore = Infinity;
  for (const i of ctx.sheetNodes) {
    const n = nodes[i];
    const distRight = p.x - (n.x + n.w);
    const distLeft = n.x - p.x;
    const isMindMapRoot = ctx.hasLeftBranches && idx.parent[i] === -1 && !n.floating && !n.childrenBelow;
    const dx = n.side === 'left' ? distLeft : isMindMapRoot ? Math.max(distLeft, distRight) : distRight;
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
