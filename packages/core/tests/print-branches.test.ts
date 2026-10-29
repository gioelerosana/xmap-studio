import { describe, expect, it } from 'vitest';
import { MM_TO_PX, type PaperSize, type PrintPage, type PrintPlan, type WorldRect } from '../src/print/paginate.js';
import {
  BRANCH_HEADER_MM,
  MAX_CUSTOM_SIDE_MM,
  MIN_LEGIBLE_SCALE,
  paginateByBranches,
  paginateToMapSize,
  type BranchPrintOptions,
} from '../src/print/branches.js';
import type { Layout, LayoutEdge, LayoutNode, LayoutSummary } from '../src/layout/types.js';

const NODE_W = 180;
const NODE_H = 36;
const ROOT_GAP = 60;
const BRANCH_GAP = 60;
const LEAF_STEP = 48;
const BRANCH_X = 220;
const LEAF_X = 440;
const ROOT_INDEX = 0;
const DEPTH_ROOT = 0;
const DEPTH_BRANCH = 1;
const DEPTH_LEAF = 2;
const ROOT_TITLE = 'Progetto di prova';

const MARGIN_MM = 10;
const MARGIN_SIDES = 2;
const A4_W_MM = 210;
const OVERSIZED_MARGIN_MM = 150;
const PRECISION = 6;
const TOLERANCE_MM = 1e-6;

const SHORT_BRANCH_LEAVES = 2;
const LONG_BRANCH_COUNT = 12;
const LONG_BRANCH_LEAVES = 3;
const TALL_BRANCH_LEAVES = 40;

const LOW_BRANCHES = [SHORT_BRANCH_LEAVES, SHORT_BRANCH_LEAVES];
const LONG_BRANCHES = Array.from({ length: LONG_BRANCH_COUNT }, () => LONG_BRANCH_LEAVES);
const TALL_BRANCHES = [TALL_BRANCH_LEAVES, SHORT_BRANCH_LEAVES];

const WIDE_BOUNDS_W = 3000;
const LEGIBILITY_TEST_W = 1300;
const OVERSIZED_W = 1400;
const SHORT_MAP_H = 500;
const LIMITED_SCALE = 0.5;
const BOUNDS_X_OFFSET = 100;

const SMALL_W_PX = 960;
const SMALL_H_PX = 480;
const HUGE_W_PX = 100000;
const HUGE_H_PX = 50000;
const HUGE_MARGIN_MM = 10;

const SUMMARY_FROM_LEAF = 10;
const SUMMARY_TO_LEAF = 25;
const SUMMARY_BRACE_GAP = 10;
const SUMMARY_TOPIC_GAP = 30;
const SUMMARY_BRACE_X = LEAF_X + NODE_W + SUMMARY_BRACE_GAP;
const SUMMARY_TOPIC_X = SUMMARY_BRACE_X + SUMMARY_TOPIC_GAP;

const portrait: BranchPrintOptions = { paper: 'A4', orientation: 'portrait', marginMm: MARGIN_MM };

interface MindMap {
  layout: Layout;
  /** Indici dei rami principali in `layout.nodes`. */
  branches: number[];
  /** Indici dei figli di ciascun ramo, nello stesso ordine di `branches`. */
  leaves: number[][];
}

interface Span {
  top: number;
  bottom: number;
}

function makeNode(id: string, title: string, x: number, y: number, depth: number, childCount: number): LayoutNode {
  return {
    id,
    title,
    displayTitle: title,
    x,
    y,
    w: NODE_W,
    h: NODE_H,
    kind: 'text',
    labels: [],
    markers: [],
    hasNotes: false,
    childCount,
    collapsed: false,
    group: 'attached',
    depth,
    sheetIndex: 0,
    childrenBelow: false,
  };
}

function withExtent(nodes: LayoutNode[], edges: LayoutEdge[], summaries: LayoutSummary[] = []): Layout {
  return {
    nodes,
    edges,
    summaries,
    relationships: [],
    width: Math.max(...nodes.map((n) => n.x + n.w)),
    height: Math.max(...nodes.map((n) => n.y + n.h)),
  };
}

/** Radice in alto, un ramo principale per voce di `leavesPerBranch` con quei figli in colonna; rami impilati in verticale. */
function buildMindMap(leavesPerBranch: number[]): MindMap {
  const nodes: LayoutNode[] = [makeNode('radice', ROOT_TITLE, 0, 0, DEPTH_ROOT, leavesPerBranch.length)];
  const edges: LayoutEdge[] = [];
  const branches: number[] = [];
  const leaves: number[][] = [];
  let top = NODE_H + ROOT_GAP;

  leavesPerBranch.forEach((count, b) => {
    const branchIndex = nodes.length;
    nodes.push(makeNode(`ramo-${b + 1}`, `Ramo ${b + 1}`, BRANCH_X, top, DEPTH_BRANCH, count));
    edges.push({ parent: ROOT_INDEX, child: branchIndex, group: 'attached', kind: 'tree' });

    const childIndexes = Array.from({ length: count }, (_, l) => branchIndex + 1 + l);
    childIndexes.forEach((leafIndex, l) => {
      nodes.push(makeNode(`ramo-${b + 1}-${l + 1}`, `Ramo ${b + 1}.${l + 1}`, LEAF_X, top + l * LEAF_STEP, DEPTH_LEAF, 0));
      edges.push({ parent: branchIndex, child: leafIndex, group: 'attached', kind: 'tree' });
    });
    branches.push(branchIndex);
    leaves.push(childIndexes);

    const columnH = count > 0 ? (count - 1) * LEAF_STEP + NODE_H : NODE_H;
    top += Math.max(NODE_H, columnH) + BRANCH_GAP;
  });

  return { layout: withExtent(nodes, edges), branches, leaves };
}

function boundsOf(layout: Layout, w: number = layout.width): WorldRect {
  return { x: 0, y: 0, w, h: layout.height };
}

function nodeAt(layout: Layout, index: number): LayoutNode {
  const node = layout.nodes[index];
  if (!node) throw new Error(`nodo ${index} assente nel layout di test`);
  return node;
}

function leafNodes(map: MindMap, branch: number): LayoutNode[] {
  return (map.leaves[branch] ?? []).map((i) => nodeAt(map.layout, i));
}

function branchSpans(map: MindMap): Span[] {
  return map.branches.map((b, k) => spanOf([nodeAt(map.layout, b), ...leafNodes(map, k)]));
}

function pageAt(plan: PrintPlan, index: number): PrintPage {
  const page = plan.pages[index];
  if (!page) throw new Error(`pagina ${index} assente nel piano di test`);
  return page;
}

function spanOf(nodes: LayoutNode[]): Span {
  return {
    top: Math.min(...nodes.map((n) => n.y)),
    bottom: Math.max(...nodes.map((n) => n.y + n.h)),
  };
}

/** Il punto `y` cade nello spazio vuoto tra due fratelli, non dentro a uno dei due? */
function isInGapBetween(y: number, spans: Span[]): boolean {
  const sorted = [...spans].sort((a, b) => a.top - b.top);
  return sorted.some((span, k) => {
    const next = sorted[k + 1];
    return next !== undefined && span.bottom < y && y < next.top;
  });
}

function expectContiguousCover(plan: PrintPlan, bounds: WorldRect): void {
  expect(pageAt(plan, 0).world.y).toBeCloseTo(bounds.y, PRECISION);
  const last = pageAt(plan, plan.pages.length - 1);
  expect(last.world.y + last.world.h).toBeCloseTo(bounds.y + bounds.h, PRECISION);
  plan.pages.slice(1).forEach((page, i) => {
    const prev = pageAt(plan, i);
    expect(page.world.y).toBeCloseTo(prev.world.y + prev.world.h, PRECISION);
  });
}

function expectNoCutThroughNode(plan: PrintPlan, layout: Layout): void {
  const cuts = plan.pages.flatMap((page, i) => [
    ...(i > 0 ? [page.world.y] : []),
    ...(i < plan.pages.length - 1 ? [page.world.y + page.world.h] : []),
  ]);
  cuts.forEach((y) => {
    const crossing = layout.nodes.filter((n) => n.y < y && y < n.y + n.h).map((n) => n.id);
    expect(crossing, `il taglio a y=${y} spezza un blocco`).toEqual([]);
  });
}

describe('paginateByBranches', () => {
  describe('mappa che sta su un foglio', () => {
    it('resta su una sola pagina senza intestazione e senza colonne extra', () => {
      const map = buildMindMap(LOW_BRANCHES);
      const plan = paginateByBranches(map.layout, boundsOf(map.layout), portrait);

      expect(plan.pages).toHaveLength(1);
      expect(plan.headerMm).toBe(0);
      expect(pageAt(plan, 0).header).toBeUndefined();
      expect(plan.cols).toBe(1);
      expect(plan.rows).toBe(1);
      // La mappa non si ingrandisce oltre la scala 1 (default di maxScale).
      expect(plan.scale).toBe(1);
    });
  });

  describe('mappa lunga', () => {
    it('si spezza in più pagine con intestazione alta BRANCH_HEADER_MM', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const plan = paginateByBranches(map.layout, boundsOf(map.layout), portrait);

      expect(plan.pages.length).toBeGreaterThan(1);
      expect(plan.headerMm).toBe(BRANCH_HEADER_MM);
    });

    it('ogni pagina riporta il titolo della radice e la prima non ha antenati', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const plan = paginateByBranches(map.layout, boundsOf(map.layout), portrait);

      plan.pages.forEach((page) => {
        expect(page.header?.title).toBe(ROOT_TITLE);
      });
      expect(pageAt(plan, 0).header).toEqual({ title: ROOT_TITLE, trail: [], continued: false });
    });

    it.each([
      ['mappa lunga', LONG_BRANCHES],
      ['ramo più alto di una pagina', TALL_BRANCHES],
      ['mappa bassa', LOW_BRANCHES],
    ])('nessun taglio attraversa un blocco (%s) e le pagine coprono la mappa in modo contiguo', (_, branches) => {
      const map = buildMindMap(branches);
      const bounds = boundsOf(map.layout);
      const plan = paginateByBranches(map.layout, bounds, portrait);

      expectNoCutThroughNode(plan, map.layout);
      expectContiguousCover(plan, bounds);
    });

    it('il primo taglio cade nello spazio tra due rami principali, non dentro un ramo', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const plan = paginateByBranches(map.layout, boundsOf(map.layout), portrait);

      const firstCut = pageAt(plan, 1).world.y;
      expect(isInGapBetween(firstCut, branchSpans(map))).toBe(true);
    });

    it('un ramo più alto della pagina viene spezzato tra i suoi figli, e la pagina successiva continua il ramo', () => {
      const map = buildMindMap(TALL_BRANCHES);
      const plan = paginateByBranches(map.layout, boundsOf(map.layout), portrait);

      const [firstBranch] = branchSpans(map);
      if (!firstBranch) throw new Error('il ramo di test non esiste');
      expect(firstBranch.bottom - firstBranch.top).toBeGreaterThan(plan.contentHeightPx / plan.scale);

      const continuation = pageAt(plan, 1);
      expect(continuation.header?.continued).toBe(true);
      expect(continuation.header?.trail).toEqual(['Ramo 1']);

      const leafSpans = leafNodes(map, 0).map((n) => spanOf([n]));
      expect(isInGapBetween(continuation.world.y, leafSpans)).toBe(true);
    });
  });

  describe('allineamento e larghezza', () => {
    it('il contenuto è allineato a sinistra su bounds.x e la larghezza mondo è area utile / scala', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const bounds: WorldRect = { x: BOUNDS_X_OFFSET, y: 0, w: map.layout.width, h: map.layout.height };
      const plan = paginateByBranches(map.layout, bounds, portrait);

      plan.pages.forEach((page) => {
        expect(page.world.x).toBe(bounds.x);
        expect(page.world.w).toBeCloseTo(plan.contentWidthPx / plan.scale, PRECISION);
      });
      expect(plan.contentWidthPx).toBeCloseTo((A4_W_MM - MARGIN_SIDES * MARGIN_MM) * MM_TO_PX, PRECISION);
    });

    it('con una mappa più larga del foglio la scala scende e la larghezza mondo resta pari ai bounds', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const bounds: WorldRect = { x: 0, y: 0, w: OVERSIZED_W, h: map.layout.height };
      const plan = paginateByBranches(map.layout, bounds, portrait);

      expect(plan.scale).toBeLessThan(1);
      expect(plan.scale).toBeCloseTo(plan.contentWidthPx / bounds.w, PRECISION);
      expect(pageAt(plan, 0).world.w).toBeCloseTo(bounds.w, PRECISION);
    });

    it('il tetto maxScale limita l’ingrandimento di una mappa piccola', () => {
      const map = buildMindMap(LOW_BRANCHES);
      const plan = paginateByBranches(map.layout, boundsOf(map.layout), { ...portrait, maxScale: LIMITED_SCALE });

      expect(plan.scale).toBe(LIMITED_SCALE);
    });
  });

  describe('orientamento auto', () => {
    it('sceglie il foglio con meno pagine anche se la sua scala è più piccola', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const bounds = boundsOf(map.layout, WIDE_BOUNDS_W);
      const forcedPortrait = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'portrait' });
      const forcedLandscape = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'landscape' });
      expect(forcedPortrait.pages.length).toBeLessThan(forcedLandscape.pages.length);
      expect(forcedPortrait.scale).toBeLessThan(forcedLandscape.scale);

      const auto = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'auto' });

      expect(auto.orientation).toBe('portrait');
      expect(auto.pages).toHaveLength(forcedPortrait.pages.length);
    });

    it('preferisce il foglio con testo leggibile anche se l’altro usa meno pagine', () => {
      const map = buildMindMap(LONG_BRANCHES);
      const bounds = boundsOf(map.layout, LEGIBILITY_TEST_W);
      const forcedPortrait = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'portrait' });
      const forcedLandscape = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'landscape' });
      expect(forcedPortrait.scale).toBeLessThan(MIN_LEGIBLE_SCALE);
      expect(forcedLandscape.scale).toBeGreaterThanOrEqual(MIN_LEGIBLE_SCALE);
      expect(forcedLandscape.pages.length).toBeGreaterThan(forcedPortrait.pages.length);

      const auto = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'auto' });

      expect(auto.orientation).toBe('landscape');
    });

    it('per una mappa alta sceglie la verticale e ottiene il numero minimo di pagine', () => {
      const map = buildMindMap(TALL_BRANCHES);
      const bounds = boundsOf(map.layout);
      const forcedPortrait = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'portrait' });
      const forcedLandscape = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'landscape' });

      const auto = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'auto' });

      expect(auto.orientation).toBe('portrait');
      expect(auto.pages).toHaveLength(Math.min(forcedPortrait.pages.length, forcedLandscape.pages.length));
    });

    it('a parità di pagine sceglie la scala maggiore', () => {
      const map = buildMindMap([SHORT_BRANCH_LEAVES]);
      const bounds: WorldRect = { x: 0, y: 0, w: WIDE_BOUNDS_W, h: SHORT_MAP_H };
      const forcedPortrait = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'portrait' });
      const forcedLandscape = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'landscape' });
      expect(forcedPortrait.pages).toHaveLength(forcedLandscape.pages.length);
      expect(forcedLandscape.scale).toBeGreaterThan(forcedPortrait.scale);

      const auto = paginateByBranches(map.layout, bounds, { ...portrait, orientation: 'auto' });

      expect(auto.orientation).toBe('landscape');
    });
  });

  describe('errori per input non validi', () => {
    const map = buildMindMap(LOW_BRANCHES);
    const bounds = boundsOf(map.layout);

    it('lancia errore per un riquadro degenere (larghezza o altezza non positive o non finite)', () => {
      expect(() => paginateByBranches(map.layout, { ...bounds, w: 0 }, portrait)).toThrow('Dimensioni del riquadro');
      expect(() => paginateByBranches(map.layout, { ...bounds, h: -SMALL_H_PX }, portrait)).toThrow('Dimensioni del riquadro');
      expect(() => paginateByBranches(map.layout, { ...bounds, w: NaN }, portrait)).toThrow('Dimensioni del riquadro');
    });

    it('lancia errore per un margine negativo o non finito', () => {
      expect(() => paginateByBranches(map.layout, bounds, { ...portrait, marginMm: -1 })).toThrow('Il margine non può essere negativo');
      expect(() => paginateByBranches(map.layout, bounds, { ...portrait, marginMm: Infinity })).toThrow('Il margine non può essere negativo');
    });

    it('lancia errore quando i margini azzerano l’area utile', () => {
      expect(() => paginateByBranches(map.layout, bounds, { ...portrait, marginMm: OVERSIZED_MARGIN_MM })).toThrow('I margini superano');
    });

    it('lancia errore per un formato carta sconosciuto', () => {
      const unknownPaper = 'A5' as PaperSize;
      expect(() => paginateByBranches(map.layout, bounds, { ...portrait, paper: unknownPaper })).toThrow('Formato carta non supportato');
    });

    it('lancia errore per un maxScale non positivo', () => {
      expect(() => paginateByBranches(map.layout, bounds, { ...portrait, maxScale: 0 })).toThrow('maxScale');
    });
  });

  it('il taglio non attraversa la graffa di un sommario', () => {
    const map = buildMindMap([TALL_BRANCH_LEAVES, SHORT_BRANCH_LEAVES]);
    const brace = spanOf(leafNodes(map, 0).slice(SUMMARY_FROM_LEAF, SUMMARY_TO_LEAF + 1));
    const topic = makeNode('sommario', 'Sintesi', SUMMARY_TOPIC_X, brace.top, DEPTH_LEAF, 0);
    const summary: LayoutSummary = { x: SUMMARY_BRACE_X, y1: brace.top, y2: brace.bottom, topic: map.layout.nodes.length };
    const layout = withExtent([...map.layout.nodes, topic], map.layout.edges, [summary]);

    const plan = paginateByBranches(layout, boundsOf(layout), portrait);

    const cuts = plan.pages.slice(1).map((page) => page.world.y);
    expect(cuts.filter((y) => brace.top < y && y < brace.bottom)).toEqual([]);
  });
});

describe('paginateToMapSize', () => {
  it('una mappa piccola diventa una sola pagina custom grande quanto la mappa', () => {
    const bounds: WorldRect = { x: 0, y: 0, w: SMALL_W_PX, h: SMALL_H_PX };
    const plan = paginateToMapSize(bounds);

    expect(plan.paper).toBe('custom');
    expect(plan.pages).toHaveLength(1);
    expect(plan.scale).toBe(1);
    expect(plan.pageWidthMm).toBeCloseTo(SMALL_W_PX / MM_TO_PX, PRECISION);
    expect(plan.pageHeightMm).toBeCloseTo(SMALL_H_PX / MM_TO_PX, PRECISION);
    expect(plan.orientation).toBe('landscape');
    expect(pageAt(plan, 0).world).toEqual(bounds);
    expect(plan.headerMm).toBe(0);
  });

  it('aggiunge il margine su ogni lato alle dimensioni della pagina', () => {
    const bounds: WorldRect = { x: 0, y: 0, w: SMALL_W_PX, h: SMALL_H_PX };
    const plan = paginateToMapSize(bounds, { marginMm: MARGIN_MM });

    expect(plan.marginMm).toBe(MARGIN_MM);
    expect(plan.pageWidthMm).toBeCloseTo(SMALL_W_PX / MM_TO_PX + MARGIN_SIDES * MARGIN_MM, PRECISION);
    expect(plan.pageHeightMm).toBeCloseTo(SMALL_H_PX / MM_TO_PX + MARGIN_SIDES * MARGIN_MM, PRECISION);
  });

  it('una mappa più alta che larga produce una pagina verticale', () => {
    const plan = paginateToMapSize({ x: 0, y: 0, w: SMALL_H_PX, h: SMALL_W_PX });

    expect(plan.orientation).toBe('portrait');
  });

  it.each([
    ['larga', { x: 0, y: 0, w: HUGE_W_PX, h: HUGE_H_PX }],
    ['alta', { x: 0, y: 0, w: HUGE_H_PX, h: HUGE_W_PX }],
  ])('una mappa enorme (%s) viene ridotta e nessun lato supera MAX_CUSTOM_SIDE_MM', (_, bounds) => {
    const plan = paginateToMapSize(bounds);

    expect(plan.scale).toBeLessThan(1);
    expect(plan.pageWidthMm).toBeLessThanOrEqual(MAX_CUSTOM_SIDE_MM + TOLERANCE_MM);
    expect(plan.pageHeightMm).toBeLessThanOrEqual(MAX_CUSTOM_SIDE_MM + TOLERANCE_MM);
    expect(Math.max(plan.pageWidthMm, plan.pageHeightMm)).toBeCloseTo(MAX_CUSTOM_SIDE_MM, PRECISION);
  });

  it('il margine rientra nel limite di lato massimo', () => {
    const plan = paginateToMapSize({ x: 0, y: 0, w: HUGE_W_PX, h: HUGE_H_PX }, { marginMm: HUGE_MARGIN_MM });

    expect(plan.pageWidthMm).toBeLessThanOrEqual(MAX_CUSTOM_SIDE_MM + TOLERANCE_MM);
    expect(plan.pageHeightMm).toBeLessThanOrEqual(MAX_CUSTOM_SIDE_MM + TOLERANCE_MM);
  });

  it('lancia errore per bounds non validi o margine negativo', () => {
    expect(() => paginateToMapSize({ x: 0, y: 0, w: 0, h: SMALL_H_PX })).toThrow('Dimensioni del riquadro');
    expect(() => paginateToMapSize({ x: 0, y: 0, w: SMALL_W_PX, h: NaN })).toThrow('Dimensioni del riquadro');
    expect(() => paginateToMapSize({ x: 0, y: 0, w: SMALL_W_PX, h: SMALL_H_PX }, { marginMm: -MARGIN_MM })).toThrow(
      'Il margine non può essere negativo',
    );
  });

  it('lancia errore per un lato massimo non positivo', () => {
    expect(() => paginateToMapSize({ x: 0, y: 0, w: SMALL_W_PX, h: SMALL_H_PX }, { maxSideMm: 0 })).toThrow();
  });
});
