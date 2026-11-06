import { describe, expect, it, vi } from 'vitest';
import { inlineMathFontSize, renderLatexToSvg, titleBaseFontPx, type Layout, type LayoutNode } from '../src/index.js';
// `assets.ts` importa `@xmap/core`: nei test punta ai sorgenti, senza richiedere la build.
vi.mock('@xmap/core', () => import('../src/index.js'));

import { buildFormulaSvgCache } from '../../../apps/web/src/components/map/assets.js';
import { FORMULA_COLOR, nodeLook, TEXT_ON_DARK, TEXT_ON_LIGHT } from '../../../apps/web/src/components/map/nodeLook.js';

function node(id: string, extra: Partial<LayoutNode> = {}): LayoutNode {
  return {
    id,
    title: id,
    x: 0,
    y: 0,
    w: 80,
    h: 30,
    kind: 'equation',
    labels: [],
    markers: [],
    hasNotes: false,
    childCount: 0,
    collapsed: false,
    group: 'attached',
    depth: 2,
    sheetIndex: 0,
    childrenBelow: false,
    ...extra,
  } as LayoutNode;
}

function layoutOf(nodes: LayoutNode[]): Layout {
  return { nodes, edges: [], summaries: [], relationships: [], width: 0, height: 0 } as unknown as Layout;
}

/** Implementazione precedente (senza cache dei colori): il riferimento del risultato atteso. */
function naiveFormulaSvgCache(layout: Layout, darkMode: boolean): Map<string, string> {
  const cache = new Map<string, string>();
  const theme = darkMode ? 'dark' : 'light';
  for (const n of layout.nodes) {
    if (!n.latex) continue;
    const res = renderLatexToSvg(n.latex, inlineMathFontSize(titleBaseFontPx(n.depth, n.textStyle)));
    if (res.error || !res.svg) continue;
    const look = nodeLook(n, darkMode);
    const color = !look.solid ? FORMULA_COLOR[theme] : look.textLight ? TEXT_ON_DARK : TEXT_ON_LIGHT;
    cache.set(n.id, res.svg.replaceAll('currentColor', color));
  }
  return cache;
}

/** Mappa sintetica: formule ripetute e diverse, su blocchi pieni, tinti e neutri. */
function syntheticLayout(): Layout {
  const formulas = ['x^2', '\\frac{a}{b}', '\\int_0^1 f(x)\\,dx', '\\sum_{i=1}^n i', 'e^{i\\pi}+1=0'];
  const nodes: LayoutNode[] = [node('root', { depth: 0, kind: 'text', latex: '\\alpha' })];
  for (let i = 0; i < 60; i++) {
    nodes.push(
      node(`n${i}`, {
        latex: formulas[i % formulas.length],
        depth: 1 + (i % 3),
        accent: i % 4 === 0 ? '#3366ff' : undefined,
        fill: i % 7 === 0 ? '#ffee88' : undefined,
      })
    );
  }
  nodes.push(node('text', { kind: 'text' }));
  return layoutOf(nodes);
}

describe('buildFormulaSvgCache con la cache dei colori', () => {
  it('dà gli stessi SVG dell’implementazione senza cache, in entrambi i temi', () => {
    const layout = syntheticLayout();
    for (const dark of [true, false]) {
      expect(buildFormulaSvgCache(layout, dark)).toEqual(naiveFormulaSvgCache(layout, dark));
      // Seconda passata dalla cache: identica alla prima.
      expect(buildFormulaSvgCache(layout, dark)).toEqual(naiveFormulaSvgCache(layout, dark));
    }
  });
});
