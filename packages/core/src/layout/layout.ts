import { SheetDto, TopicView } from '../state/types.js';
import {
  BRANCH_COLORS,
  DEFAULT_NODE_H,
  DEFAULT_NODE_W,
  Layout,
  LayoutEdge,
  LayoutNode,
  LayoutOpts,
  LayoutRelationship,
  MapNode,
  NodeMetrics,
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

    const text = node.displayTitle || node.title || '';
    const chars = text.length;
    const maxW = node.customWidth ?? 400.0;
    let w = Math.min(Math.max(chars * 8.5 + 44.0, 90.0), maxW);
    if (node.markers.length > 0) {
      w += node.markers.length * 20;
    }
    if (node.labels.length > 0) {
      w += node.labels.length * 32;
    }
    const usableW = Math.max(w - 28.0, 80.0);
    const lines = Math.max(Math.ceil((chars * 8.5) / usableW), 1.0);
    let h = Math.max(lines * 18.0 + 16.0, 34.0);
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

function buildNodeRecursive(
  topic: TopicView,
  childrenMap: Map<string, TopicView[]>,
  branchAccent?: string
): MapNode {
  const explicitFill = topic.fillColor;
  const accent = explicitFill || branchAccent;

  const rawChildren = childrenMap.get(topic.id) || [];
  const children: MapNode[] = rawChildren.map((c, i) => {
    const childBranch =
      topic.depth === 0 && !c.fillColor
        ? BRANCH_COLORS[i % BRANCH_COLORS.length]
        : accent;
    return buildNodeRecursive(c, childrenMap, childBranch);
  });

  return {
    id: topic.id,
    title: topic.title,
    displayTitle: topic.displayTitle,
    kind: topic.kind,
    latex: topic.latex,
    fillColor: explicitFill,
    accent,
    imageSrc: topic.imageSrc,
    imageW: topic.imageW,
    imageH: topic.imageH,
    labels: topic.labels,
    markers: topic.markers,
    hasNotes: topic.notes.length > 0,
    notes: topic.notes,
    childCount: Math.max(topic.childCount, children.length),
    group: topic.group,
    depth: topic.depth,
    parentId: topic.parentId,
    sheetIndex: topic.sheetIndex,
    position: topic.position,
    customWidth: topic.customWidth,
    children,
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
    relationships: [],
    width: 0,
    height: 0,
  };

  let top = 20.0;

  for (const sheet of sheets) {
    const { trees, floating } = buildSheetTrees(sheet);

    for (const tree of trees) {
      const sizes = new Map<string, { w: number; h: number }>();
      computeSizes(tree, collapsed, metrics, opts, sizes);
      const rootMeasure = metrics.measure(tree);
      const rootCollapsed = collapsed.has(tree.id) || tree.children.length === 0;

      let childrenH = 0.0;
      if (!rootCollapsed) {
        tree.children.forEach((c, i) => {
          const ch = sizes.get(c.id)?.h ?? 0.0;
          childrenH += ch + (i > 0 ? opts.vGap : 0.0);
        });
      }

      const totalH = rootCollapsed ? rootMeasure.h : Math.max(rootMeasure.h, childrenH);
      const rootY = top + (totalH - rootMeasure.h) / 2.0;

      const rootIndex = pushLayoutNode(
        out,
        tree,
        20.0,
        rootY,
        rootMeasure.w,
        rootMeasure.h,
        collapsed.has(tree.id)
      );

      if (!rootCollapsed) {
        const childX = 20.0 + rootMeasure.w + opts.hGap;
        let cur = top + (totalH - childrenH) / 2.0;
        for (const child of tree.children) {
          const ch = sizes.get(child.id)?.h ?? 0.0;
          placeSubtree(
            child,
            childX,
            cur,
            rootIndex,
            collapsed,
            metrics,
            opts,
            sizes,
            out
          );
          cur += ch + opts.vGap;
        }
      }

      top += totalH + opts.sheetGap;
    }

    // Posizionamento dei topic liberi (detached)
    if (floating.length > 0) {
      const maxTreeX = out.nodes.reduce((max, n) => Math.max(max, n.x + n.w), 20.0);
      let floatYCursor = 20.0;

      for (const floatNode of floating) {
        const floatSizes = new Map<string, { w: number; h: number }>();
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

        let fx: number;
        let fy: number;

        if (targetNode) {
          fx = Math.max(maxTreeX + 80.0, targetNode.x + targetNode.w + 60.0);
          const idealY = targetNode.y + (targetNode.h - floatSubH) / 2.0;
          fy = Math.max(idealY, floatYCursor);
        } else if (floatNode.position) {
          fx = Math.max(floatNode.position.x, maxTreeX + 60.0);
          fy = Math.max(floatNode.position.y, 20.0);
        } else {
          fx = maxTreeX + 80.0;
          fy = floatYCursor;
        }

        floatYCursor = fy + floatSubH + opts.vGap;
        const isCollapsed = collapsed.has(floatNode.id);
        const floatIdx = pushLayoutNode(
          out,
          floatNode,
          fx,
          fy,
          fMeasure.w,
          fMeasure.h,
          isCollapsed
        );

        if (!isCollapsed && floatNode.children.length > 0) {
          const childX = fx + fMeasure.w + opts.hGap;
          let cur = fy;
          for (const child of floatNode.children) {
            const ch = floatSizes.get(child.id)?.h ?? 0.0;
            placeSubtree(
              child,
              childX,
              cur,
              floatIdx,
              collapsed,
              metrics,
              opts,
              floatSizes,
              out
            );
            cur += ch + opts.vGap;
          }
        }
      }
    }

    // Risoluzione relationships
    for (const rel of sheet.relationships) {
      const fromIdx = out.nodes.findIndex((n) => n.id === rel.end1Id);
      const toIdx = out.nodes.findIndex((n) => n.id === rel.end2Id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const accent = out.nodes[fromIdx].accent || out.nodes[toIdx].accent;
        out.relationships.push({
          id: rel.id,
          title: rel.title ? rel.title : undefined,
          from: fromIdx,
          to: toIdx,
          accent,
        });
      }
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
  collapsed: boolean
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
  });
  return index;
}

function computeSizes(
  node: MapNode,
  collapsed: Set<string>,
  metrics: NodeMetrics,
  opts: LayoutOpts,
  sizes: Map<string, { w: number; h: number }>
): { w: number; h: number } {
  const measure = metrics.measure(node);
  let size: { w: number; h: number };

  if (collapsed.has(node.id) || node.children.length === 0) {
    size = measure;
  } else {
    let colH = 0.0;
    let maxCw = 0.0;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const cSize = computeSizes(child, collapsed, metrics, opts, sizes);
      if (i > 0) colH += opts.vGap;
      colH += cSize.h;
      maxCw = Math.max(maxCw, cSize.w);
    }
    size = {
      w: measure.w + opts.hGap + maxCw,
      h: Math.max(measure.h, colH),
    };
  }

  sizes.set(node.id, size);
  return size;
}

function placeSubtree(
  node: MapNode,
  left: number,
  top: number,
  parentIdx: number,
  collapsed: Set<string>,
  metrics: NodeMetrics,
  opts: LayoutOpts,
  sizes: Map<string, { w: number; h: number }>,
  out: Layout
): void {
  const measure = metrics.measure(node);
  const subH = sizes.get(node.id)?.h ?? measure.h;
  const isCollapsed = collapsed.has(node.id);

  const y = top + (subH - measure.h) / 2.0;
  const index = pushLayoutNode(out, node, left, y, measure.w, measure.h, isCollapsed);

  out.edges.push({
    parent: parentIdx,
    child: index,
    group: node.group,
  });

  if (isCollapsed || node.children.length === 0) {
    return;
  }

  let childrenH = 0.0;
  for (let i = 0; i < node.children.length; i++) {
    const ch = sizes.get(node.children[i].id)?.h ?? 0.0;
    childrenH += ch + (i > 0 ? opts.vGap : 0.0);
  }

  let cur = top + (subH - childrenH) / 2.0;
  const childX = left + measure.w + opts.hGap;

  for (const child of node.children) {
    const ch = sizes.get(child.id)?.h ?? 0.0;
    placeSubtree(child, childX, cur, index, collapsed, metrics, opts, sizes, out);
    cur += ch + opts.vGap;
  }
}
