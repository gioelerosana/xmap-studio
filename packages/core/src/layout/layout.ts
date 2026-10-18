import { relationshipGeometry } from './relationship.js';
import { SheetDto, TopicView } from '../state/types.js';
import { renderLatexToSvg } from '../latex/mathjax.js';
import { splitInlineMath } from '../latex/inline.js';
import { parseRange } from '../model/utils.js';
import {
  BRANCH_COLORS,
  Layout,
  LayoutEdge,
  LayoutOpts,
  LayoutSummary,
  EdgeKind,
  LayoutRelationship,
  MapNode,
  MapSummary,
  NodeMetrics,
  SUMMARY_BRACE_W,
  TREE_RIGHT_STRUCTURE,
  trunkX,
} from './types.js';

export class EstimatedMetrics implements NodeMetrics {
  measure(node: MapNode): { w: number; h: number } {
    if (node.imageW !== undefined && node.imageH !== undefined) {
      const maxW = node.kind === 'equation' || node.latex ? 650.0 : 380.0;
      const scale = node.imageW > maxW ? maxW / node.imageW : 1.0;
      const fw = node.imageW * scale + 24.0;
      let fh = node.imageH * scale + 18.0;
      if (node.hasNotes || node.markers.length > 0 || node.labels.length > 0) {
        fh += 18.0;
      }
      return { w: Math.max(72.0, fw), h: Math.max(32.0, fh) };
    }

    const effectiveLatex = node.latex;
    if (effectiveLatex) {
      try {
        const rendered = renderLatexToSvg(effectiveLatex, 18);
        if (!rendered.error) {
          const fw = Math.max(rendered.width + 36.0, 96.0);
          let fh = Math.max(rendered.height + 22.0, 38.0);
          if (node.hasNotes || node.markers.length > 0 || node.labels.length > 0) {
            fh += 18.0;
          }
          return { w: Math.min(fw, 650.0), h: Math.max(32.0, fh) };
        }
      } catch {}
    }

    const text = node.displayTitle || node.title || '';
    const blockSize = node.textStyle?.fontSizePx ? node.textStyle.fontSizePx / 13.0 : 1.0;
    const blockBold = node.textStyle?.bold ?? false;
    const baseFontSizePx = node.textStyle?.fontSizePx ?? 13.0;

    let totalContentWidth = 0;
    let maxMathHeight = 0;
    let hasDisplayMath = false;

    if (node.titleRuns && node.titleRuns.map((r) => r.text).join('') === text) {
      for (const r of node.titleRuns) {
        const bold = r.bold ?? blockBold;
        const size = r.fontSizePx ? r.fontSizePx / 13.0 : blockSize;
        const runFontSizePx = r.fontSizePx ?? baseFontSizePx;
        const segments = splitInlineMath(r.text);
        for (const seg of segments) {
          if (seg.kind === 'text') {
            totalContentWidth += seg.value.length * (bold ? 1.08 : 1.0) * size * 8.5;
          } else {
            if (seg.display) hasDisplayMath = true;
            try {
              const rendered = renderLatexToSvg(seg.value, runFontSizePx, seg.display ?? false);
              if (!rendered.error) {
                totalContentWidth += rendered.width + 4.0;
                maxMathHeight = Math.max(maxMathHeight, rendered.height);
              } else {
                const rawLen = seg.value.length + (seg.display ? 4 : 2);
                totalContentWidth += rawLen * (bold ? 1.08 : 1.0) * size * 8.5;
              }
            } catch {
              const rawLen = seg.value.length + (seg.display ? 4 : 2);
              totalContentWidth += rawLen * (bold ? 1.08 : 1.0) * size * 8.5;
            }
          }
        }
      }
    } else {
      const segments = splitInlineMath(text);
      for (const seg of segments) {
        if (seg.kind === 'text') {
          totalContentWidth += seg.value.length * (blockBold ? 1.08 : 1.0) * blockSize * 8.5;
        } else {
          if (seg.display) hasDisplayMath = true;
          try {
            const rendered = renderLatexToSvg(seg.value, baseFontSizePx, seg.display ?? false);
            if (!rendered.error) {
              totalContentWidth += rendered.width + 4.0;
              maxMathHeight = Math.max(maxMathHeight, rendered.height);
            } else {
              const rawLen = seg.value.length + (seg.display ? 4 : 2);
              totalContentWidth += rawLen * (blockBold ? 1.08 : 1.0) * blockSize * 8.5;
            }
          } catch {
            const rawLen = seg.value.length + (seg.display ? 4 : 2);
            totalContentWidth += rawLen * (blockBold ? 1.08 : 1.0) * blockSize * 8.5;
          }
        }
      }
    }

    const maxW = node.customWidth ?? 360.0;
    let w = Math.min(Math.max(totalContentWidth + 44.0, 96.0), maxW);
    if (node.markers.length > 0) {
      w += node.markers.length * 20;
    }
    if (node.labels.length > 0) {
      w += node.labels.length * 32;
    }
    const usableW = Math.max(w - 28.0, 80.0);
    const lines = Math.max(Math.ceil(totalContentWidth / usableW), 1.0);
    const lineHeight = Math.max(20.0, maxMathHeight > 0 ? maxMathHeight + 4.0 : 20.0);
    let h = Math.max(lines * lineHeight + 16.0 + (hasDisplayMath ? 8.0 : 0.0), 36.0);
    if (node.hasNotes || node.markers.length > 0 || node.labels.length > 0) {
      h += 16.0;
    }
    return { w, h };
  }
}

export const DEFAULT_LAYOUT_OPTS: LayoutOpts = {
  hGap: 50.0,
  vGap: 16.0,
  sheetGap: 80.0,
};

export function buildSheetTrees(sheet: SheetDto): { trees: MapNode[]; floating: MapNode[] } {
  const childrenMap = new Map<string, TopicView[]>();
  const roots: TopicView[] = [];
  const floating: TopicView[] = [];

  for (const t of sheet.topics) {
    if (t.group === 'detached') {
      floating.push(t);
    } else if (t.parentId) {
      const list = childrenMap.get(t.parentId) || [];
      list.push(t);
      childrenMap.set(t.parentId, list);
    } else {
      roots.push(t);
    }
  }

  if (roots.length === 0 && sheet.topics.length > 0) {
    roots.push(sheet.topics[0]);
  }

  const trees = roots.map((r) => buildNodeRecursive(r, childrenMap));
  const floatingNodes = floating.map((f) => buildNodeRecursive(f, childrenMap));

  return { trees, floating: floatingNodes };
}

type Size = { w: number; h: number };
type Sizes = Map<string, Size>;

/** Distanza fra la colonna dei figli di una Tree Chart e il tronco. */
const TREE_STUB = 30.0;
/** Spazio fra il blocco radice e il primo ramo di una Tree Chart. */
const TREE_TOP_GAP = 26.0;
const SUMMARY_GAP_BEFORE = 16.0;
const SUMMARY_GAP_AFTER = 22.0;
/** Distanza orizzontale fra il bordo destro dei figli raccolti e il topic di sommario. */
const SUMMARY_OFFSET = SUMMARY_GAP_BEFORE + SUMMARY_BRACE_W + SUMMARY_GAP_AFTER;

function isTreeRight(structureClass?: string): boolean {
  return structureClass === TREE_RIGHT_STRUCTURE;
}

function buildNodeRecursive(
  topic: TopicView,
  childrenMap: Map<string, TopicView[]>,
  branchAccent?: string
): MapNode {
  const explicitFill = topic.fillColor;
  // Il fill appartiene solo al topic che lo dichiara; ciò che si eredita è
  // l'accento del ramo, usato da connettori e decorazioni.
  const accent = explicitFill || branchAccent;

  const rawChildren = childrenMap.get(topic.id) || [];
  const children: MapNode[] = [];
  const summaryTopics: MapNode[] = [];
  rawChildren.forEach((c, i) => {
    const childBranch =
      topic.depth === 0 && !c.fillColor ? BRANCH_COLORS[i % BRANCH_COLORS.length] : accent;
    const node = buildNodeRecursive(c, childrenMap, childBranch);
    if (c.group === 'summary') {
      summaryTopics.push(node);
    } else {
      children.push(node);
    }
  });

  // Senza descrittore valido il sommario abbraccia l'intera colonna.
  const last = Math.max(children.length - 1, 0);
  const summaries: MapSummary[] = summaryTopics.map((node) => {
    const parsed = parseRange(topic.summaries.find((s) => s.id === node.id)?.range);
    const [start, end] = parsed ? [Math.min(parsed[0], last), Math.min(parsed[1], last)] : [0, last];
    return { start, end, node };
  });

  const effectiveLatex = topic.latex;

  return {
    id: topic.id,
    title: topic.title,
    displayTitle: topic.displayTitle,
    kind: effectiveLatex ? 'equation' : topic.kind,
    latex: effectiveLatex,
    fillColor: explicitFill,
    accent,
    imageSrc: topic.imageSrc,
    imageW: topic.imageW,
    imageH: topic.imageH,
    labels: topic.labels,
    markers: topic.markers,
    hasNotes: topic.notes.length > 0,
    notes: topic.notes,
    childCount: Math.max(topic.childCount, children.length + summaries.length),
    group: topic.group,
    depth: topic.depth,
    parentId: topic.parentId,
    sheetIndex: topic.sheetIndex,
    position: topic.position,
    customWidth: topic.customWidth,
    structureClass: topic.structureClass,
    textStyle: topic.textStyle,
    titleRuns: topic.titleRuns,
    children,
    summaries,
  };
}

export function layoutSheets(
  sheets: SheetDto[],
  collapsed: Set<string> = new Set(),
  metrics: NodeMetrics = new EstimatedMetrics(),
  opts: LayoutOpts = DEFAULT_LAYOUT_OPTS
): Layout {
  const out: Layout = {
    nodes: [],
    edges: [],
    summaries: [],
    relationships: [],
    width: 0,
    height: 0,
  };

  const left = 20.0;
  let top = 20.0;

  for (const sheet of sheets) {
    const { trees, floating } = buildSheetTrees(sheet);
    const sheetFirstNode = out.nodes.length;

    for (const tree of trees) {
      const sizes: Sizes = new Map();
      computeSizes(tree, collapsed, metrics, opts, sizes);
      const ctx: PlaceCtx = { collapsed, metrics, opts, sizes };

      let totalH: number;
      const asTree = opts.structure ? opts.structure === 'tree' : isTreeRight(tree.structureClass);
      if (asTree) {
        totalH = placeTreeRoot(tree, left, top, ctx, out);
      } else {
        placeSubtree(tree, left, top, undefined, ctx, out);
        totalH = sizes.get(tree.id)?.h ?? 0.0;
      }
      top += totalH + opts.sheetGap;
    }

    // Posizionamento dei topic liberi (detached)
    if (floating.length > 0) {
      const maxTreeX = out.nodes.reduce((max, n) => Math.max(max, n.x + n.w), 20.0);
      let floatYCursor = 20.0;
      const rootNode = out.nodes[sheetFirstNode];
      const rootCenter = rootNode
        ? { x: rootNode.x + rootNode.w / 2.0, y: rootNode.y + rootNode.h / 2.0 }
        : undefined;

      for (const floatNode of floating) {
        const floatSizes: Sizes = new Map();
        computeSizes(floatNode, collapsed, metrics, opts, floatSizes);
        const fMeasure = metrics.measure(floatNode);
        const floatSubH = floatSizes.get(floatNode.id)?.h ?? fMeasure.h;

        // Cerca relationship associata
        const relatedTarget = sheet.relationships.find(
          (rel) => rel.end2Id === floatNode.id || rel.end1Id === floatNode.id
        );
        const targetNode = relatedTarget
          ? out.nodes.find(
              (n) =>
                n.id ===
                (relatedTarget.end2Id === floatNode.id
                  ? relatedTarget.end1Id
                  : relatedTarget.end2Id)
            )
          : undefined;

        const positioned = floatNode.position !== undefined && rootCenter !== undefined;
        let fx: number;
        let fy: number;

        if (floatNode.position && rootCenter) {
          // `position` è il centro del topic relativo al centro della radice (XMind).
          const m = fMeasure;
          fx = rootCenter.x + floatNode.position.x - m.w / 2.0;
          fy = rootCenter.y + floatNode.position.y - m.h / 2.0 - (floatSubH - m.h) / 2.0;
        } else if (targetNode) {
          fx = Math.max(maxTreeX + 80.0, targetNode.x + targetNode.w + 60.0);
          const idealY = targetNode.y + (targetNode.h - floatSubH) / 2.0;
          fy = Math.max(idealY, floatYCursor);
        } else {
          fx = maxTreeX + 80.0;
          fy = floatYCursor;
        }

        if (!positioned) floatYCursor = fy + floatSubH + opts.vGap;
        const floatIdx = placeSubtree(
          floatNode,
          fx,
          fy,
          undefined,
          { collapsed, metrics, opts, sizes: floatSizes },
          out
        );
        out.nodes[floatIdx].floating = true;
        if (rootCenter) out.nodes[floatIdx].floatOrigin = { ...rootCenter };
      }
    }
  }

  // I topic liberi possono cadere a sinistra/sopra la radice: riporta tutto in positivo.
  const minX = out.nodes.reduce((min, n) => Math.min(min, n.x), Infinity);
  const minY = out.nodes.reduce((min, n) => Math.min(min, n.y), Infinity);
  const dx = out.nodes.length > 0 && minX < left ? left - minX : 0;
  const dy = out.nodes.length > 0 && minY < 20.0 ? 20.0 - minY : 0;
  if (dx !== 0 || dy !== 0) {
    for (const n of out.nodes) {
      n.x += dx;
      n.y += dy;
      if (n.floatOrigin) n.floatOrigin = { x: n.floatOrigin.x + dx, y: n.floatOrigin.y + dy };
    }
    for (const sm of out.summaries) {
      sm.x += dx;
      sm.y1 += dy;
      sm.y2 += dy;
    }
  }

  // Risoluzione relationships dopo l'eventuale traslazione dei topic liberi.
  for (const sheet of sheets) {
    for (const rel of sheet.relationships) {
      const fromIdx = out.nodes.findIndex((n) => n.id === rel.end1Id);
      const toIdx = out.nodes.findIndex((n) => n.id === rel.end2Id);
      if (fromIdx === -1 || toIdx === -1) continue;
      const accent = out.nodes[fromIdx].accent || out.nodes[toIdx].accent;
      out.relationships.push({
        id: rel.id,
        title: rel.title ? rel.title : undefined,
        from: fromIdx,
        to: toIdx,
        accent,
        style: rel.style,
        controlPoints: rel.controlPoints,
        geometry: relationshipGeometry(out.nodes[fromIdx], out.nodes[toIdx], rel.style, rel.controlPoints),
      });
    }
  }

  if (out.nodes.length > 0) {
    const maxX = out.nodes.reduce((max, n) => Math.max(max, n.x + n.w), 0);
    const maxY = out.nodes.reduce((max, n) => Math.max(max, n.y + n.h), 0);
    out.width = maxX + 40.0;
    out.height = maxY + 40.0;
  }

  return out;
}

function pushLayoutNode(
  out: Layout,
  node: MapNode,
  x: number,
  y: number,
  w: number,
  h: number,
  collapsed: boolean,
  childrenBelow: boolean
): number {
  const index = out.nodes.length;
  out.nodes.push({
    id: node.id,
    title: node.title,
    displayTitle: node.displayTitle,
    x,
    y,
    w,
    h,
    kind: node.kind,
    latex: node.latex,
    fill: node.fillColor,
    accent: node.accent,
    imageSrc: node.imageSrc,
    imageW: node.imageW,
    imageH: node.imageH,
    labels: node.labels,
    markers: node.markers,
    hasNotes: node.hasNotes,
    childCount: node.childCount,
    collapsed,
    group: node.group,
    depth: node.depth,
    sheetIndex: node.sheetIndex,
    position: node.position,
    customWidth: node.customWidth,
    textStyle: node.textStyle,
    titleRuns: node.titleRuns,
    childrenBelow,
  });
  return index;
}

/**
 * Colonna dei figli: offset verticale di ciascun figlio rispetto alla cima e
 * altezza totale. Se un sommario è più alto dei figli che raccoglie, la colonna
 * si allarga attorno all'intervallo così che non invada i fratelli vicini.
 */
interface Column {
  tops: number[];
  height: number;
}

function column(node: MapNode, sizes: Sizes, opts: LayoutOpts): Column {
  const n = node.children.length;
  const childH = (i: number): number => sizes.get(node.children[i].id)?.h ?? 0.0;
  const padBefore = new Array<number>(n).fill(0);
  const padAfter = new Array<number>(n).fill(0);

  for (const s of node.summaries) {
    if (s.end >= n) continue;
    let rangeH = opts.vGap * (s.end - s.start);
    for (let i = s.start; i <= s.end; i++) rangeH += childH(i);
    const sumH = sizes.get(s.node.id)?.h ?? 0.0;
    if (sumH > rangeH) {
      const extra = (sumH - rangeH) / 2.0;
      padBefore[s.start] = Math.max(padBefore[s.start], extra);
      padAfter[s.end] = Math.max(padAfter[s.end], extra);
    }
  }

  const tops: number[] = [];
  let cur = 0.0;
  for (let i = 0; i < n; i++) {
    if (i > 0) cur += opts.vGap;
    cur += padBefore[i];
    tops.push(cur);
    cur += childH(i) + padAfter[i];
  }
  return { tops, height: cur };
}

function maxWidth(nodes: MapNode[], sizes: Sizes): number {
  return nodes.reduce((max, c) => Math.max(max, sizes.get(c.id)?.w ?? 0.0), 0.0);
}

/** Larghezza occupata a destra della colonna dei figli, sommari compresi. */
function columnWidth(node: MapNode, sizes: Sizes): number {
  let width = maxWidth(node.children, sizes);
  for (const s of node.summaries) {
    const rangeW = maxWidth(node.children.slice(s.start, s.end + 1), sizes);
    const summaryW = sizes.get(s.node.id)?.w ?? 0.0;
    width = Math.max(width, rangeW + SUMMARY_OFFSET + summaryW);
  }
  return width;
}

function hasVisibleChildren(node: MapNode, collapsed: Set<string>): boolean {
  return !collapsed.has(node.id) && (node.children.length > 0 || node.summaries.length > 0);
}

/** Prima passata: dimensioni di ogni sotto-albero, sommari inclusi. */
function computeSizes(
  node: MapNode,
  collapsed: Set<string>,
  metrics: NodeMetrics,
  opts: LayoutOpts,
  sizes: Sizes
): Size {
  const self = metrics.measure(node);
  let size: Size = self;
  if (hasVisibleChildren(node, collapsed)) {
    for (const child of node.children) computeSizes(child, collapsed, metrics, opts, sizes);
    for (const s of node.summaries) computeSizes(s.node, collapsed, metrics, opts, sizes);
    const col = column(node, sizes, opts);
    size = {
      w: self.w + opts.hGap + columnWidth(node, sizes),
      h: Math.max(self.h, col.height),
    };
  }
  sizes.set(node.id, size);
  return size;
}

/** Parametri condivisi dalla seconda passata (posizionamento). */
interface PlaceCtx {
  collapsed: Set<string>;
  metrics: NodeMetrics;
  opts: LayoutOpts;
  sizes: Sizes;
}

/** Posiziona un sotto-albero nella fascia che inizia in (`left`, `top`). */
function placeSubtree(
  node: MapNode,
  left: number,
  top: number,
  parent: { index: number; kind: EdgeKind } | undefined,
  ctx: PlaceCtx,
  out: Layout
): number {
  const { w, h } = ctx.metrics.measure(node);
  const subH = ctx.sizes.get(node.id)?.h ?? h;

  // Il blocco è centrato verticalmente nella fascia del proprio sotto-albero.
  const index = pushLayoutNode(
    out,
    node,
    left,
    top + (subH - h) / 2.0,
    w,
    h,
    ctx.collapsed.has(node.id),
    false
  );

  if (parent) {
    out.edges.push({ parent: parent.index, child: index, group: node.group, kind: parent.kind });
  }

  if (hasVisibleChildren(node, ctx.collapsed)) {
    const col = column(node, ctx.sizes, ctx.opts);
    const colTop = top + (subH - col.height) / 2.0;
    placeChildren(node, index, left + w + ctx.opts.hGap, colTop, col, 'logic', ctx, out);
  }
  return index;
}

/**
 * Radice di una Tree Chart: blocco in alto, rami di primo livello in colonna
 * sotto di esso e spostati a destra del tronco. Ritorna l'altezza occupata.
 */
function placeTreeRoot(node: MapNode, left: number, top: number, ctx: PlaceCtx, out: Layout): number {
  const { w, h } = ctx.metrics.measure(node);
  const index = pushLayoutNode(out, node, left, top, w, h, ctx.collapsed.has(node.id), true);
  if (!hasVisibleChildren(node, ctx.collapsed)) return h;

  const col = column(node, ctx.sizes, ctx.opts);
  placeChildren(
    node,
    index,
    trunkX(out.nodes[index]) + TREE_STUB,
    top + h + TREE_TOP_GAP,
    col,
    'tree',
    ctx,
    out
  );
  return h + TREE_TOP_GAP + col.height;
}

/** Dispone la colonna dei figli e i sommari, con le graffe a destra dei figli raccolti. */
function placeChildren(
  node: MapNode,
  index: number,
  childX: number,
  colTop: number,
  col: Column,
  kind: EdgeKind,
  ctx: PlaceCtx,
  out: Layout
): void {
  node.children.forEach((child, i) => {
    placeSubtree(child, childX, colTop + col.tops[i], { index, kind }, ctx, out);
  });

  const heightOf = (c: MapNode): number => ctx.sizes.get(c.id)?.h ?? 0.0;
  for (const s of node.summaries) {
    if (s.end >= node.children.length) continue;
    const y1 = colTop + col.tops[s.start];
    const y2 = colTop + col.tops[s.end] + heightOf(node.children[s.end]);
    const rangeW = maxWidth(node.children.slice(s.start, s.end + 1), ctx.sizes);
    const braceX = childX + rangeW + SUMMARY_GAP_BEFORE;
    const sumTop = (y1 + y2) / 2.0 - heightOf(s.node) / 2.0;
    const topic = placeSubtree(
      s.node,
      braceX + SUMMARY_BRACE_W + SUMMARY_GAP_AFTER,
      sumTop,
      undefined,
      ctx,
      out
    );
    const summary: LayoutSummary = {
      x: braceX,
      y1,
      y2,
      topic,
      accent: s.node.accent ?? node.accent,
    };
    out.summaries.push(summary);
  }
}
