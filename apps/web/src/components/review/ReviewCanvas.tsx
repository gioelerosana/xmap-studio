import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { BoundaryFrame, Layout, LayoutNode } from '@xmap/core';
import { BoundaryLayer } from '../map/BoundaryLayer.js';
import { MapEdges } from '../map/MapEdges.js';
import { NodeCard } from '../map/NodeCard.js';
import { RelationshipLayer } from '../map/RelationshipLayer.js';
import { buildFormulaSvgCache, buildResourceUrls } from '../map/assets.js';
import { nodeLook } from '../map/nodeLook.js';
import { useMediaQuery } from '../map/useMediaQuery.js';
import { useViewport } from '../map/useViewport.js';
import { clampZoom, computeFitView, MIN_ZOOM, type View } from '../map/viewport.js';
import { useMathJaxVersion } from '../../mathReady.js';

/** Opacità dei blocchi fuori dal riflettore: restano leggibili come struttura, non come contenuto. */
const DIM_OPACITY = 0.22;
/** Zoom massimo dell'inquadratura automatica: un blocco senza figli non riempie lo schermo. */
const MAX_FRAME_ZOOM = 1.5;
const CAMERA_MS = 420;
const TAP_SLOP_PX = 6;

export interface ReviewCanvasProps {
  layout: Layout;
  boundaries: readonly BoundaryFrame[];
  /** Blocco a fuoco. */
  currentId: string;
  /** Blocchi in luce (corrente, antenati, figli). */
  lit: ReadonlySet<string>;
  /** Blocchi da mostrare come segnaposto ("?"): modo prova, non ancora scoperti. */
  hidden: ReadonlySet<string>;
  /** Blocchi che la camera inquadra; vuoto = tutta la mappa (panoramica). */
  frameIds: readonly string[];
  darkMode: boolean;
  resourceResolver: (src: string) => Uint8Array | null;
  /** Spazio coperto da barre sovrapposte alla tela, da lasciare libero nell'inquadratura. */
  insets: { top: number; bottom: number };
  onPickTopic: (topicId: string) => void;
}

const noop = () => {};

/** Vista che inquadra i blocchi `nodes` nel riquadro libero della tela. */
function frameView(nodes: readonly LayoutNode[], width: number, height: number, insets: { top: number; bottom: number }): View | null {
  if (nodes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  const pad = width < 640 ? 20 : 56;
  const availW = width - pad * 2;
  const availH = height - insets.top - insets.bottom - pad * 2;
  if (availW <= 20 || availH <= 20) return null;
  const k = clampZoom(Math.max(Math.min(availW / Math.max(x1 - x0, 1), availH / Math.max(y1 - y0, 1), MAX_FRAME_ZOOM), MIN_ZOOM));
  return {
    k,
    x: (width - (x1 - x0) * k) / 2 - x0 * k,
    y: insets.top + pad + (availH - (y1 - y0) * k) / 2 - y0 * k,
  };
}

/** Selettore CSS sicuro per un id di topic (gli id XMind sono liberi). */
const cssId = (id: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'));

/**
 * Mappa del ripasso: stessa resa dell'editor (blocchi, connettori, cornici, relazioni) ma in sola
 * lettura. Il riflettore attenua ciò che è fuori fuoco senza toglierlo: la struttura resta visibile.
 * La camera inquadra i blocchi del passo a ogni cambio; pan, rotella e pinch restano liberi.
 */
export const ReviewCanvas: React.FC<ReviewCanvasProps> = ({
  layout,
  boundaries,
  currentId,
  lit,
  hidden,
  frameIds,
  darkMode,
  resourceResolver,
  insets,
  onPickTopic,
}) => {
  const viewport = useViewport(layout);
  const { containerRef, svgRef, viewportGroupRef, viewRef, animateTo, commitView, setView, cancelMotion, scheduleApply } = viewport;
  const isCoarse = useMediaQuery('(pointer: coarse)');
  const mathVersion = useMathJaxVersion();
  const formulaSvgCache = useMemo(() => buildFormulaSvgCache(layout, darkMode), [layout, darkMode, mathVersion]);
  const resourceUrls = useMemo(() => buildResourceUrls(layout, resourceResolver), [layout, resourceResolver]);
  const pickRef = useRef(onPickTopic);
  pickRef.current = onPickTopic;
  const movedRef = useRef(false);

  // Camera: inquadra il passo. Il primo inquadramento (montaggio, cambio di foglio) è immediato.
  const placedRef = useRef(false);
  const frameKey = `${currentId}|${frameIds.join(',')}`;
  const placeCamera = useCallback(
    (animate: boolean) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const byId = new Map(layout.nodes.map((n) => [n.id, n]));
      const nodes = frameIds.map((id) => byId.get(id)).filter((n): n is LayoutNode => n !== undefined);
      const target =
        nodes.length > 0
          ? frameView(nodes, rect.width, rect.height, insets)
          : computeFitView(layout, rect.width, Math.max(rect.height - insets.top - insets.bottom, 40));
      if (!target) return;
      if (nodes.length === 0) target.y += insets.top;
      if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animateTo(target, CAMERA_MS);
      } else {
        cancelMotion();
        viewRef.current = target;
        commitView();
        setView(target);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, frameKey, insets.top, insets.bottom]
  );
  useLayoutEffect(() => {
    placeCamera(placedRef.current);
    placedRef.current = true;
  }, [placeCamera]);

  // Ridimensionamento (rotazione del telefono, schermo intero): si reinquadra il passo.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      placeCamera(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, placeCamera]);

  // Gesti: rotella (Ctrl = zoom), trascinamento per spostarsi, pinch a due dita. Un tocco senza
  // spostamento su un blocco lo porta a fuoco (gestito dal click del blocco).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinch: { dist: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelMotion();
      const rect = el.getBoundingClientRect();
      const v = viewRef.current;
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const k = clampZoom(v.k * Math.exp(Math.max(-0.25, Math.min(0.25, -e.deltaY * unit * 0.01))));
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        viewRef.current = { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      } else {
        viewRef.current = { ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit };
      }
      scheduleApply();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      cancelMotion();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        movedRef.current = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const v = viewRef.current;
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: v.k, cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top, vx: v.x, vy: v.y };
        movedRef.current = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const k = clampZoom(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist));
        const cx = (a.x + b.x) / 2 - rect.left;
        const cy = (a.y + b.y) / 2 - rect.top;
        const wx = (pinch.cx - pinch.vx) / pinch.k;
        const wy = (pinch.cy - pinch.vy) / pinch.k;
        viewRef.current = { k, x: cx - wx * k, y: cy - wy * k };
        scheduleApply();
        return;
      }
      if (start && !movedRef.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) {
        movedRef.current = true;
        el.setPointerCapture?.(e.pointerId);
      }
      if (movedRef.current) {
        const v = viewRef.current;
        viewRef.current = { ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y };
        scheduleApply();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) start = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [containerRef, viewRef, cancelMotion, scheduleApply]);

  const selectNode = useCallback((node: LayoutNode, e: React.MouseEvent<SVGGElement>) => {
    e.stopPropagation();
    if (movedRef.current) return;
    pickRef.current(node.id);
  }, []);
  const ignoreNode = useCallback((_node: LayoutNode, e: React.MouseEvent<SVGGElement>) => e.stopPropagation(), []);

  // Connettori in luce: quelli che arrivano a un blocco in luce. Tronchi e graffe restano attenuati.
  const edgeCss = useMemo(() => {
    const litEdges = [...lit].map((id) => `[data-review-canvas] [data-edge-child="${cssId(id)}"]`);
    return [
      `[data-review-canvas] [data-review-edges] path{opacity:${DIM_OPACITY};transition:opacity .25s ease}`,
      litEdges.length ? `${litEdges.join(',')}{opacity:1}` : '',
    ].join('\n');
  }, [lit]);

  // In prova le relazioni e le cornici dei blocchi non ancora scoperti non devono suggerire il contenuto.
  const relationships = useMemo(
    () =>
      hidden.size === 0
        ? layout.relationships
        : layout.relationships.filter((r) => {
            const a = layout.nodes[r.from];
            const b = layout.nodes[r.to];
            return a && b && !hidden.has(a.id) && !hidden.has(b.id);
          }),
    [layout, hidden]
  );
  const visibleBoundaries = useMemo(
    () => (hidden.size === 0 ? boundaries : boundaries.filter((b) => !hidden.has(b.topicId))),
    [boundaries, hidden]
  );

  const content = useMemo(
    () => (
      <>
        <style>{edgeCss}</style>
        <g opacity={0.5}>
          <BoundaryLayer boundaries={visibleBoundaries} />
        </g>
        <g data-review-edges>
          <MapEdges layout={layout} />
        </g>
        {layout.nodes.map((node) => {
          const isLit = lit.has(node.id);
          const isCurrent = node.id === currentId;
          const g = (child: React.ReactNode) => (
            <g
              key={node.id}
              opacity={isLit ? 1 : DIM_OPACITY}
              style={{ transition: 'opacity .25s ease' }}
              data-review-node={node.id}
            >
              {child}
              {isCurrent && (
                <rect
                  x={node.x - 6}
                  y={node.y - 6}
                  width={node.w + 12}
                  height={node.h + 12}
                  rx={14}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  pointerEvents="none"
                />
              )}
            </g>
          );
          if (hidden.has(node.id)) {
            const accent = node.accent || 'var(--map-link)';
            return g(
              <g
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!movedRef.current) pickRef.current(node.id);
                }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx={node.depth === 0 ? 12 : 10}
                  fill={`color-mix(in oklab, ${accent} var(--map-tint), var(--map-canvas))`}
                  stroke={accent}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <text
                  x={node.x + node.w / 2}
                  y={node.y + node.h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={16}
                  fontWeight={600}
                  fill={accent}
                >
                  ?
                </text>
              </g>
            );
          }
          return g(
            <NodeCard
              node={node}
              look={nodeLook(node, darkMode)}
              isSelected={false}
              isPrimary={false}
              isEditing={false}
              formulaSvg={formulaSvgCache.get(node.id)}
              imageUrl={node.imageSrc ? resourceUrls.get(node.imageSrc) : undefined}
              isCoarse={isCoarse}
              onSelect={selectNode}
              onActivate={ignoreNode}
              onToggleCollapse={noop}
              onResetWidth={noop}
              onStartResize={noop}
            />
          );
        })}
        <g opacity={0.75} pointerEvents="none">
          <RelationshipLayer relationships={relationships} nodes={layout.nodes} toWorld={viewport.toWorld} darkMode={darkMode} />
        </g>
      </>
    ),
    [layout, lit, hidden, currentId, darkMode, formulaSvgCache, resourceUrls, isCoarse, selectNode, ignoreNode, edgeCss, relationships, visibleBoundaries, viewport.toWorld]
  );

  return (
    <div
      ref={containerRef}
      data-review-canvas
      className="relative h-full w-full overflow-clip bg-(--map-canvas) select-none touch-none cursor-grab active:cursor-grabbing animate-fade-in"
    >
      <svg ref={svgRef} className="h-full w-full overflow-visible" style={{ transformOrigin: '0 0', textRendering: 'geometricPrecision' }}>
        <g ref={viewportGroupRef}>{content}</g>
      </svg>
    </div>
  );
};
