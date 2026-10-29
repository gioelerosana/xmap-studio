/**
 * Impaginazione "per rami" e "come la mappa" (stampa / PDF).
 *
 * - `paginateByBranches`: la mappa si adatta alla larghezza del foglio e si
 *   spezza in pagine solo tra un ramo e l'altro (mai in mezzo a un blocco), così
 *   una mappa lunga resta leggibile e con un senso logico. Ogni pagina porta una
 *   fascia di intestazione col titolo e il ramo da cui riparte.
 * - `paginateToMapSize`: una sola pagina grande quanto la mappa.
 *
 * Logica pura, come `paginate`: lavora sul `Layout` in coordinate del mondo.
 */
import type { Layout, LayoutNode } from '../layout/types.js';
import {
  MM_TO_PX,
  PAPER_SIZES_MM,
  type PaperSize,
  type PrintOrientation,
  type PrintPage,
  type PrintPageHeader,
  type PrintPlan,
  type WorldRect,
} from './paginate.js';

/** Altezza (mm) della fascia di intestazione delle pagine nell'impaginazione per rami. */
export const BRANCH_HEADER_MM = 9;

/** Lato massimo (mm) di una pagina "come la mappa": oltre, i PDF dei visualizzatori diventano inaffidabili. */
export const MAX_CUSTOM_SIDE_MM = 5000;

/** Sotto questa scala il testo stampato scende sotto circa 8 pt: la UI avvisa. */
export const MIN_LEGIBLE_SCALE = 0.55;

/** Quota minima di pagina da riempire prima di preferire un taglio a un livello più profondo. */
const MIN_FILL = 0.5;

const EPSILON = 1e-6;

export interface BranchPrintOptions {
  paper: PaperSize;
  orientation: PrintOrientation;
  /** Margine su ogni lato, in mm. */
  marginMm: number;
  /** Tetto alla scala (default 1: la mappa non si ingrandisce). */
  maxScale?: number;
}

interface CutCandidate {
  /** Ordinata (mondo) del taglio, nello spazio vuoto tra due rami fratelli. */
  y: number;
  /** Livello dei fratelli separati dal taglio: 1 = rami principali. */
  depth: number;
}

interface NodeTree {
  parentOf: number[];
  childrenOf: number[][];
  /** Estensione verticale del blocco e dei suoi discendenti. */
  extent: { y0: number; y1: number }[];
}

function buildNodeTree(layout: Layout): NodeTree {
  const count = layout.nodes.length;
  const parentOf: number[] = new Array<number>(count).fill(-1);
  const childrenOf: number[][] = Array.from({ length: count }, () => []);
  for (const edge of layout.edges) {
    if (!layout.nodes[edge.parent] || !layout.nodes[edge.child]) continue;
    parentOf[edge.child] = edge.parent;
    childrenOf[edge.parent]?.push(edge.child);
  }

  const extent = layout.nodes.map((n) => ({ y0: n.y, y1: n.y + n.h }));
  const byDepthDesc = layout.nodes
    .map((n, i) => ({ i, depth: n.depth }))
    .sort((a, b) => b.depth - a.depth);
  for (const { i } of byDepthDesc) {
    const parent = parentOf[i] ?? -1;
    const own = extent[i];
    const up = extent[parent];
    if (parent < 0 || !own || !up) continue;
    up.y0 = Math.min(up.y0, own.y0);
    up.y1 = Math.max(up.y1, own.y1);
  }
  return { parentOf, childrenOf, extent };
}

/** Il taglio a `y` attraversa un blocco? Allora spezzerebbe un blocco a metà. */
function crossesNode(nodes: LayoutNode[], y: number): boolean {
  return nodes.some((n) => n.y + EPSILON < y && y < n.y + n.h - EPSILON);
}

function collectCandidates(layout: Layout, tree: NodeTree): CutCandidate[] {
  const out: CutCandidate[] = [];
  const addGaps = (siblings: number[], depth: number) => {
    const sorted = siblings
      .map((i) => tree.extent[i])
      .filter((e): e is { y0: number; y1: number } => Boolean(e))
      .sort((a, b) => a.y0 - b.y0);
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1];
      const next = sorted[k];
      if (!prev || !next || prev.y1 >= next.y0) continue;
      const y = (prev.y1 + next.y0) / 2;
      if (!crossesNode(layout.nodes, y)) out.push({ y, depth });
    }
  };

  const roots = layout.nodes.map((_, i) => i).filter((i) => (tree.parentOf[i] ?? -1) < 0);
  addGaps(roots, 0);
  tree.childrenOf.forEach((kids, parent) => {
    const node = layout.nodes[parent];
    if (node) addGaps(kids, node.depth + 1);
  });
  return out;
}

/** Ordinate di inizio pagina (la prima è `bounds.y`) più la fine della mappa. */
function chooseCuts(candidates: CutCandidate[], layout: Layout, bounds: WorldRect, pageWorldH: number): number[] {
  const end = bounds.y + bounds.h;
  const depths = [...new Set(candidates.map((c) => c.depth))].sort((a, b) => a - b);
  const starts: number[] = [bounds.y];

  let y = bounds.y;
  while (end > y + pageWorldH + EPSILON) {
    const limit = y + pageWorldH;
    const inPage = candidates.filter((c) => c.y > y + EPSILON && c.y <= limit + EPSILON);
    let cut: number | undefined;

    for (const depth of depths) {
      const good = inPage.filter((c) => c.depth <= depth && c.y >= y + pageWorldH * MIN_FILL);
      if (good.length > 0) {
        cut = Math.max(...good.map((c) => c.y));
        break;
      }
    }
    if (cut === undefined && inPage.length > 0) cut = Math.max(...inPage.map((c) => c.y));

    if (cut === undefined) {
      // Nessuno spazio tra blocchi: taglio duro, ma mai in mezzo a un blocco se si può evitare.
      cut = limit;
      for (const n of layout.nodes) {
        if (n.y + EPSILON < cut && cut < n.y + n.h - EPSILON && n.y > y + EPSILON) cut = n.y;
      }
    }
    starts.push(cut);
    y = cut;
  }
  starts.push(end);
  return starts;
}

function nodeTitle(node: LayoutNode): string {
  return (node.displayTitle || node.title || '').trim() || (node.kind === 'equation' ? 'Formula' : 'Senza titolo');
}

function pageHeader(layout: Layout, tree: NodeTree, pageTop: number, isFirst: boolean): PrintPageHeader {
  const root = layout.nodes.find((n) => n.depth === 0);
  const title = root ? nodeTitle(root) : '';
  if (isFirst) return { title, trail: [], continued: false };

  let firstIdx = -1;
  layout.nodes.forEach((n, i) => {
    if (n.y + EPSILON < pageTop) return;
    const best = layout.nodes[firstIdx];
    if (!best || n.y < best.y) firstIdx = i;
  });

  const trail: string[] = [];
  let up = tree.parentOf[firstIdx] ?? -1;
  while (up >= 0) {
    const ancestor = layout.nodes[up];
    if (!ancestor || ancestor.depth === 0) break;
    trail.unshift(nodeTitle(ancestor));
    up = tree.parentOf[up] ?? -1;
  }
  return { title, trail, continued: trail.length > 0 };
}

function buildBranchPlan(
  layout: Layout,
  bounds: WorldRect,
  opts: BranchPrintOptions,
  orientation: 'portrait' | 'landscape',
  headerMm: number,
  tree: NodeTree,
  candidates: CutCandidate[],
): PrintPlan {
  const paper = PAPER_SIZES_MM[opts.paper];
  const pageWidthMm = orientation === 'portrait' ? paper.w : paper.h;
  const pageHeightMm = orientation === 'portrait' ? paper.h : paper.w;
  const contentWMm = pageWidthMm - 2 * opts.marginMm;
  const contentHMm = pageHeightMm - 2 * opts.marginMm - headerMm;
  if (contentWMm <= 0 || contentHMm <= 0) {
    throw new Error('I margini superano o eguagliano le dimensioni del foglio: area utile non positiva.');
  }
  const contentWidthPx = contentWMm * MM_TO_PX;
  const contentHeightPx = contentHMm * MM_TO_PX;

  const scale = Math.min(contentWidthPx / bounds.w, opts.maxScale ?? 1);
  const worldW = contentWidthPx / scale;
  const starts = chooseCuts(candidates, layout, bounds, contentHeightPx / scale);

  const pages: PrintPage[] = [];
  for (let i = 0; i + 1 < starts.length; i++) {
    const top = starts[i] ?? bounds.y;
    const bottom = starts[i + 1] ?? bounds.y + bounds.h;
    pages.push({
      index: i,
      row: i,
      col: 0,
      world: { x: bounds.x, y: top, w: worldW, h: bottom - top },
      header: headerMm > 0 ? pageHeader(layout, tree, top, i === 0) : undefined,
    });
  }

  return {
    paper: opts.paper,
    orientation,
    pageWidthMm,
    pageHeightMm,
    marginMm: opts.marginMm,
    headerMm,
    contentWidthPx,
    contentHeightPx,
    scale,
    rows: pages.length,
    cols: 1,
    pages,
  };
}

function planForOrientation(
  layout: Layout,
  bounds: WorldRect,
  opts: BranchPrintOptions,
  orientation: 'portrait' | 'landscape',
  tree: NodeTree,
  candidates: CutCandidate[],
): PrintPlan {
  const withHeader = buildBranchPlan(layout, bounds, opts, orientation, BRANCH_HEADER_MM, tree, candidates);
  if (withHeader.pages.length > 1) return withHeader;
  // Una sola pagina: l'intestazione è inutile e toglie spazio alla mappa.
  return buildBranchPlan(layout, bounds, opts, orientation, 0, tree, candidates);
}

/**
 * Impagina `layout` adattandolo alla larghezza del foglio e andando a capo
 * pagina solo tra rami fratelli: prima tra i rami principali, poi, se un ramo
 * da solo supera la pagina, tra i suoi sotto-rami. Il contenuto resta allineato
 * a sinistra. Con `orientation: 'auto'` vince l'orientamento con meno pagine
 * (a parità, scala maggiore, poi verticale).
 */
export function paginateByBranches(layout: Layout, bounds: WorldRect, opts: BranchPrintOptions): PrintPlan {
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w <= 0 || bounds.h <= 0) {
    throw new Error('Dimensioni del riquadro della mappa non valide: larghezza e altezza devono essere positive e finite.');
  }
  if (!(opts.paper in PAPER_SIZES_MM)) throw new Error(`Formato carta non supportato: ${String(opts.paper)}.`);
  if (!Number.isFinite(opts.marginMm) || opts.marginMm < 0) throw new Error('Il margine non può essere negativo o non finito.');
  if (opts.maxScale !== undefined && (!Number.isFinite(opts.maxScale) || opts.maxScale <= 0)) {
    throw new Error('Il parametro maxScale deve essere un numero positivo e finito.');
  }

  const tree = buildNodeTree(layout);
  const candidates = collectCandidates(layout, tree);

  if (opts.orientation !== 'auto') {
    return planForOrientation(layout, bounds, opts, opts.orientation, tree, candidates);
  }
  const portrait = planForOrientation(layout, bounds, opts, 'portrait', tree, candidates);
  const landscape = planForOrientation(layout, bounds, opts, 'landscape', tree, candidates);
  if (landscape.pages.length !== portrait.pages.length) {
    return landscape.pages.length < portrait.pages.length ? landscape : portrait;
  }
  return landscape.scale > portrait.scale + EPSILON ? landscape : portrait;
}

export interface MapSizeOptions {
  /** Margine su ogni lato, in mm (default 0: il riquadro ha già il suo respiro). */
  marginMm?: number;
  /** Lato massimo della pagina in mm (default `MAX_CUSTOM_SIDE_MM`). */
  maxSideMm?: number;
}

/**
 * Una sola pagina grande quanto la mappa (scala 1, 96 dpi). Una mappa più
 * grande di `maxSideMm` viene ridotta per stare nel limite.
 */
export function paginateToMapSize(bounds: WorldRect, opts: MapSizeOptions = {}): PrintPlan {
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w <= 0 || bounds.h <= 0) {
    throw new Error('Dimensioni del riquadro della mappa non valide: larghezza e altezza devono essere positive e finite.');
  }
  const marginMm = opts.marginMm ?? 0;
  const maxSideMm = opts.maxSideMm ?? MAX_CUSTOM_SIDE_MM;
  if (!Number.isFinite(marginMm) || marginMm < 0) throw new Error('Il margine non può essere negativo o non finito.');

  const naturalWMm = bounds.w / MM_TO_PX + 2 * marginMm;
  const naturalHMm = bounds.h / MM_TO_PX + 2 * marginMm;
  const scale = Math.min(1, maxSideMm / naturalWMm, maxSideMm / naturalHMm);

  const contentWidthPx = bounds.w * scale;
  const contentHeightPx = bounds.h * scale;
  return {
    paper: 'custom',
    orientation: bounds.w > bounds.h ? 'landscape' : 'portrait',
    pageWidthMm: contentWidthPx / MM_TO_PX + 2 * marginMm,
    pageHeightMm: contentHeightPx / MM_TO_PX + 2 * marginMm,
    marginMm,
    headerMm: 0,
    contentWidthPx,
    contentHeightPx,
    scale,
    rows: 1,
    cols: 1,
    pages: [{ index: 0, row: 0, col: 0, world: { ...bounds } }],
  };
}
