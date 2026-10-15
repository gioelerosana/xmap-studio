import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layout, LayoutNode, renderLatexToSvg, SUMMARY_BRACE_W, trunkX } from '@xmap/core';
import {
  Plus,
  Minus,
  Maximize2,
  FileText,
  Sigma,
  Network,
  Edit3,
  Trash2,
} from 'lucide-react';
import { Button, IconButton, Separator, cn } from '@xmap/ui-kit';

// MathJax produce SVG con colore letterale, non una variabile CSS: i valori
// replicano il token foreground nei due temi. La radice ha sfondo "inchiostro"
// (--map-root), quindi la sua formula usa il colore invertito rispetto al tema.
const FORMULA_COLOR = { dark: '#f5f5f5', light: '#2b2b30' };
const FORMULA_COLOR_ON_ROOT = { dark: '#0a0a0a', light: '#fcfcfc' };

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3.5;
const clampZoom = (k: number) => Math.min(Math.max(k, MIN_ZOOM), MAX_ZOOM);
const PINCH_K = 0.01; // esponente di zoom per pixel di deltaY
const MAX_EXPONENT = 0.25; // tetto per evento (rotella a scatti con ctrl)
const LINE_PX = 16; // deltaMode LINE -> pixel
const SYNC_DELAY_MS = 120;
const VELOCITY_WINDOW_MS = 100;
const INERTIA_TAU_MS = 325;
const MIN_INERTIA_SPEED = 0.02; // px/ms
const TREE_CORNER_R = 8;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface MapViewProps {
  layout: Layout | null;
  selectedTopicId?: string;
  onSelectTopic: (topicId: string) => void;
  onOpenDetails: (topicId: string) => void;
  onOpenLatex?: (topicId: string) => void;
  onAddChild?: (topicId: string) => void;
  onDeleteTopic?: (topicId: string) => void;
  onToggleCollapse: (topicId: string) => void;
  resourceResolver: (src: string) => Uint8Array | null;
  darkMode?: boolean;
}

export const MapView: React.FC<MapViewProps> = ({
  layout,
  selectedTopicId,
  onSelectTopic,
  onOpenDetails,
  onOpenLatex,
  onAddChild,
  onDeleteTopic,
  onToggleCollapse,
  resourceResolver,
  darkMode = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Trasformazione "viva": durante i gesti si aggiorna solo questo ref e lo style
  // dell'SVG; `view` (stato React) viene allineato a gesto concluso.
  const viewRef = useRef<View>({ x: 60, y: 60, k: 1 });
  const [view, setView] = useState<View>(viewRef.current);
  const selectedNodeRef = useRef<LayoutNode | null>(null);
  const hasAutoFitted = useRef(false);
  const lastLayoutRef = useRef<Layout | null>(null);
  const frameRef = useRef(0);
  const syncTimerRef = useRef<number | undefined>(undefined);
  const motionRef = useRef(0); // rAF di animazione o inerzia
  const zoomTargetRef = useRef<number | null>(null); // zoom di arrivo dei click +/- in corso
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // Callback in un ref: il contenuto memoizzato non si ricostruisce se il genitore le ricrea.
  const handlers = useRef({ onSelectTopic, onOpenDetails, onToggleCollapse });
  handlers.current = { onSelectTopic, onOpenDetails, onToggleCollapse };
  // Cache delle risorse immagine / PNG come data URL
  const resourceUrls = useMemo(() => {
    const map = new Map<string, string>();
    if (!layout) return map;
    for (const node of layout.nodes) {
      if (!node.imageSrc || map.has(node.imageSrc)) continue;
      const bytes = resourceResolver(node.imageSrc);
      if (!bytes) continue;
      map.set(node.imageSrc, `data:image/png;base64,${bytesToBase64(bytes)}`);
    }
    return map;
  }, [layout, resourceResolver]);

  // Cache per il rendering SVG vettoriale delle formule LaTeX nei nodi
  const formulaSvgCache = useMemo(() => {
    const cache = new Map<string, string>();
    if (!layout) return cache;

    const theme = darkMode ? 'dark' : 'light';
    for (const node of layout.nodes) {
      const latex = node.latex;
      if (latex) {
        try {
          const res = renderLatexToSvg(latex, 16);
          if (!res.error && res.svg) {
            const onRootInk = node.depth === 0 && !node.fill;
            const color = (onRootInk ? FORMULA_COLOR_ON_ROOT : FORMULA_COLOR)[theme];
            const coloredSvg = res.svg.replaceAll('currentColor', color);
            cache.set(node.id, coloredSvg);
          }
        } catch {}
      }
    }
    return cache;
  }, [layout, darkMode]);

  const applyView = useCallback(() => {
    const v = viewRef.current;
    if (svgRef.current) {
      svgRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
    const n = selectedNodeRef.current;
    if (toolbarRef.current && n) {
      toolbarRef.current.style.left = `${v.x + n.x * v.k}px`;
      toolbarRef.current.style.top = `${v.y + (n.y - 42) * v.k}px`;
    }
  }, []);

  // Allinea lo stato React (percentuale, ecc.) dopo che il gesto si è fermato.
  const scheduleSync = useCallback(() => {
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => setView({ ...viewRef.current }), SYNC_DELAY_MS);
  }, []);

  // Più eventi nello stesso frame producono una sola scrittura sullo style.
  const scheduleApply = useCallback(() => {
    if (!frameRef.current) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        applyView();
      });
    }
    scheduleSync();
  }, [applyView, scheduleSync]);

  const cancelMotion = useCallback(() => {
    cancelAnimationFrame(motionRef.current);
    motionRef.current = 0;
    zoomTargetRef.current = null;
  }, []);

  // Anima la vista verso `target`; con `anchor` lo zoom è geometrico e il punto
  // sotto l'ancora resta fermo, altrimenti pan e zoom interpolano insieme.
  const animateTo = useCallback(
    (target: View, duration: number, anchor?: { cx: number; cy: number }) => {
      const zoomTarget = zoomTargetRef.current;
      cancelMotion();
      zoomTargetRef.current = zoomTarget;
      const from = { ...viewRef.current };
      const t0 = performance.now();
      const wx = anchor ? (anchor.cx - from.x) / from.k : 0;
      const wy = anchor ? (anchor.cy - from.y) / from.k : 0;
      const step = (now: number) => {
        const p = Math.min((now - t0) / duration, 1);
        const e = 1 - (1 - p) ** 3;
        const k = from.k * Math.pow(target.k / from.k, e);
        viewRef.current = anchor
          ? { k, x: anchor.cx - wx * k, y: anchor.cy - wy * k }
          : { k, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
        applyView();
        scheduleSync();
        if (p < 1) {
          motionRef.current = requestAnimationFrame(step);
        } else {
          motionRef.current = 0;
          zoomTargetRef.current = null;
        }
      };
      motionRef.current = requestAnimationFrame(step);
    },
    [applyView, cancelMotion, scheduleSync]
  );

  const computeFit = useCallback((): View | null => {
    if (!layout || !containerRef.current || layout.nodes.length === 0) return null;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 10 || rect.height <= 10) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of layout.nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x + node.w);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y + node.h);
    }
    if (minX === Infinity) return null;

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const margin = 64;
    const scaleX = (rect.width - margin * 2) / Math.max(contentW, 100);
    const scaleY = (rect.height - margin * 2) / Math.max(contentH, 100);
    const k = Math.max(Math.min(scaleX, scaleY, 1.15), MIN_ZOOM);
    return {
      k,
      x: (rect.width - contentW * k) / 2 - minX * k,
      y: (rect.height - contentH * k) / 2 - minY * k,
    };
  }, [layout]);

  // Adattamento immediato (caricamento, ridimensionamento)
  const fitToView = useCallback(() => {
    const fit = computeFit();
    if (!fit) return;
    cancelMotion();
    viewRef.current = fit;
    applyView();
    setView(fit);
  }, [computeFit, cancelMotion, applyView]);

  const fitAnimated = useCallback(() => {
    const fit = computeFit();
    if (fit) animateTo(fit, 260);
  }, [computeFit, animateTo]);

  // Zoom dei pulsanti attorno al centro; i click ravvicinati si sommano sul bersaglio.
  const zoomByButton = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const base = zoomTargetRef.current ?? viewRef.current.k;
      const k = clampZoom(base * factor);
      animateTo({ ...viewRef.current, k }, 170, { cx: rect.width / 2, cy: rect.height / 2 });
      zoomTargetRef.current = k;
    },
    [animateTo]
  );

  // ResizeObserver e auto-fit al caricamento o ridimensionamento finestra
  useEffect(() => {
    if (!layout) return;

    // Se il layout o i nodi sono cambiati, permetti nuovo auto-fit
    if (lastLayoutRef.current !== layout) {
      lastLayoutRef.current = layout;
      hasAutoFitted.current = false;
    }

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 50 && entry.contentRect.height > 50) {
          if (!hasAutoFitted.current) {
            hasAutoFitted.current = true;
            fitToView();
          }
        }
      }
    });

    ro.observe(container);

    // Timeout fallback per primo frame
    const timer = setTimeout(() => {
      if (!hasAutoFitted.current) {
        hasAutoFitted.current = true;
        fitToView();
      }
    }, 50);

    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [layout, fitToView]);

  const hasContent = Boolean(layout && layout.nodes.length > 0);

  // Listener nativo non passivo: React registra `wheel` come passivo, e senza
  // preventDefault() il pinch del touchpad zooma l'intera pagina in Chromium.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelMotion();
      const rect = container.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? rect.height : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Il pinch del touchpad arriva come wheel+ctrl con delta piccoli e continui.
        const exponent = Math.min(Math.max(-dy * PINCH_K, -MAX_EXPONENT), MAX_EXPONENT);
        const k = clampZoom(v.k * Math.exp(exponent));
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const ratio = k / v.k;
        viewRef.current = { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
      } else {
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        viewRef.current = { ...v, x: v.x - dx, y: v.y - dy };
      }
      scheduleApply();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [hasContent, cancelMotion, scheduleApply]);

  // Pulizia di timer, frame e listener di trascinamento allo smontaggio
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(motionRef.current);
      window.clearTimeout(syncTimerRef.current);
      dragCleanupRef.current?.();
    },
    []
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (
      e.button !== 0 ||
      !(e.target === containerRef.current || target.tagName === 'svg' || target.id === 'map-bg')
    ) {
      return;
    }
    cancelMotion();
    dragCleanupRef.current?.();
    const ox = e.clientX - viewRef.current.x;
    const oy = e.clientY - viewRef.current.y;
    let samples: { t: number; x: number; y: number }[] = [];

    const onMove = (ev: MouseEvent) => {
      const now = performance.now();
      viewRef.current = { ...viewRef.current, x: ev.clientX - ox, y: ev.clientY - oy };
      samples.push({ t: now, x: viewRef.current.x, y: viewRef.current.y });
      samples = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
      scheduleApply();
    };
    const onUp = () => {
      cleanup();
      const now = performance.now();
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (!first || !last || now - last.t > 80 || last.t - first.t < 8) return;
      let vx = (last.x - first.x) / (last.t - first.t);
      let vy = (last.y - first.y) / (last.t - first.t);
      let prev = now;
      const step = (t: number) => {
        const dt = Math.min(t - prev, 50);
        prev = t;
        const v = viewRef.current;
        viewRef.current = { ...v, x: v.x + vx * dt, y: v.y + vy * dt };
        const decay = Math.exp(-dt / INERTIA_TAU_MS);
        vx *= decay;
        vy *= decay;
        applyView();
        scheduleSync();
        motionRef.current = Math.hypot(vx, vy) > MIN_INERTIA_SPEED ? requestAnimationFrame(step) : 0;
      };
      motionRef.current = requestAnimationFrame(step);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dragCleanupRef.current = cleanup;
  };

  const selectedNode = useMemo(() => {
    if (!layout || !selectedTopicId) return null;
    return layout.nodes.find((n) => n.id === selectedTopicId) || null;
  }, [layout, selectedTopicId]);

  selectedNodeRef.current = selectedNode;
  // Dopo ogni render riapplica la vista viva (SVG appena montato, barra del nodo).
  useLayoutEffect(() => {
    applyView();
  });

  // Contenuto pesante dell'SVG: dipende solo da layout/selezione/tema, non da zoom
  // e pan, così durante i gesti React non lo ricostruisce.
  const content = useMemo(() => {
    if (!layout) return null;
    // Un tronco per genitore Tree Chart, fino al centro del figlio più basso.
    const trunkMap = new Map<number, { parent: number; x: number; y1: number; y2: number }>();
    for (const edge of layout.edges) {
      if (edge.kind !== 'tree') continue;
      const p = layout.nodes[edge.parent];
      const c = layout.nodes[edge.child];
      if (!p || !c) continue;
      const cy = c.y + c.h / 2;
      const prev = trunkMap.get(edge.parent);
      if (!prev) {
        trunkMap.set(edge.parent, { parent: edge.parent, x: trunkX(p), y1: p.y + p.h, y2: cy });
      } else if (cy > prev.y2) {
        prev.y2 = cy;
      }
    }
    const trunks = [...trunkMap.values()].map((t) => ({
      ...t,
      y2: Math.max(t.y2 - TREE_CORNER_R, t.y1),
    }));
    return (
      <>
        <defs>
          <pattern
            id="map-dot-grid"
            x="0"
            y="0"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1" fill="var(--map-grid-dot)" />
          </pattern>

          <marker id="rel-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>

        <rect
          id="map-bg"
          x={-15000}
          y={-15000}
          width={45000}
          height={45000}
          fill="url(#map-dot-grid)"
        />

        {/* Tronchi condivisi della Tree Chart: uno per genitore, in colore neutro */}
        {trunks.map((t) => (
          <path
            key={`trunk-${t.parent}`}
            d={`M ${t.x} ${t.y1} L ${t.x} ${t.y2}`}
            fill="none"
            stroke="var(--map-link)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}

        {/* Connettori gerarchici */}
        {layout.edges.map((edge, idx) => {
          const p = layout.nodes[edge.parent];
          const c = layout.nodes[edge.child];
          if (!p || !c) return null;

          const endY = c.y + c.h / 2;
          let pathD: string;
          if (edge.kind === 'tree') {
            // Solo gomito + tratto orizzontale: il tronco è disegnato a parte.
            const tx = trunkX(p);
            const r = Math.max(Math.min(TREE_CORNER_R, c.x - tx, endY - (p.y + p.h)), 0);
            pathD = `M ${tx} ${endY - r} Q ${tx} ${endY} ${tx + r} ${endY} L ${c.x} ${endY}`;
          } else {
            const startX = p.x + p.w;
            const startY = p.y + p.h / 2;
            const deltaX = Math.abs(c.x - startX) * 0.55;
            pathD = `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${c.x - deltaX} ${endY}, ${c.x} ${endY}`;
          }

          return (
            <path
              key={`edge-${idx}`}
              d={pathD}
              fill="none"
              stroke={c.accent || 'var(--map-link)'}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={c.accent ? 0.8 : 1}
            />
          );
        })}

        {/* Relazioni tra nodi */}
        {layout.relationships.map((rel) => {
          const from = layout.nodes[rel.from];
          const to = layout.nodes[rel.to];
          if (!from || !to) return null;
          const sx = from.x + from.w / 2;
          const sy = from.y + from.h / 2;
          const ex = to.x + to.w / 2;
          const ey = to.y + to.h / 2;
          const cx = (sx + ex) / 2 - (ey - sy) * 0.2;
          const cy = (sy + ey) / 2 + (ex - sx) * 0.2;
          // Larghezza stimata della pillola: ~6px per carattere a 11px.
          const labelW = rel.title ? rel.title.length * 6 + 14 : 0;

          return (
            <g key={`rel-${rel.id}`}>
              <path
                d={`M ${sx} ${sy} Q ${cx} ${cy}, ${ex} ${ey}`}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                markerEnd="url(#rel-arrow)"
                opacity={0.8}
              />
              {rel.title && (
                <>
                  <rect
                    x={cx - labelW / 2}
                    y={cy - 18}
                    width={labelW}
                    height={16}
                    rx={6}
                    fill="var(--background)"
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  <text
                    x={cx}
                    y={cy - 10}
                    fill="var(--muted-foreground)"
                    className="text-2xs font-medium"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {rel.title}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Sommari: graffa di chiusura "}" e raccordo verso il blocco */}
        {layout.summaries.map((s, idx) => {
          const t = layout.nodes[s.topic];
          if (!t) return null;
          const ym = (s.y1 + s.y2) / 2;
          const hw = SUMMARY_BRACE_W / 2;
          const r = Math.max(Math.min(hw, (s.y2 - s.y1) / 4), 0);
          const d =
            `M ${s.x} ${s.y1} Q ${s.x + hw} ${s.y1} ${s.x + hw} ${s.y1 + r} ` +
            `L ${s.x + hw} ${ym - r} Q ${s.x + hw} ${ym} ${s.x + SUMMARY_BRACE_W} ${ym} ` +
            `Q ${s.x + hw} ${ym} ${s.x + hw} ${ym + r} ` +
            `L ${s.x + hw} ${s.y2 - r} Q ${s.x + hw} ${s.y2} ${s.x} ${s.y2} ` +
            `M ${s.x + SUMMARY_BRACE_W} ${ym} L ${t.x} ${t.y + t.h / 2}`;
          return (
            <path
              key={`summary-${idx}`}
              d={d}
              fill="none"
              stroke={s.accent || 'var(--map-link)'}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Nodi della mappa */}
        {layout.nodes.map((node) => {
          const isSelected = node.id === selectedTopicId;
          const isRoot = node.depth === 0;
          const isBranch = node.depth === 1;
          const nodeAccent = node.accent;
          const hasChildren = node.childCount > 0;
          const formulaSvg = formulaSvgCache.get(node.id);
          const hasImage = Boolean(node.imageSrc && resourceUrls.has(node.imageSrc));
          // Radice su sfondo "inchiostro": testo e chip usano il colore invertito.
          const onInk = isRoot && !node.fill;
          // Il bordo della radice si confonde con l'inchiostro (o prende l'accento
          // scelto dall'utente); lo style batte le classi `stroke-*` del rettangolo.
          const rootStroke = !isSelected && isRoot ? nodeAccent || (onInk ? 'var(--map-root)' : undefined) : undefined;
          const chipInkStyle = onInk
            ? { backgroundColor: 'color-mix(in oklab, var(--map-root-foreground) 16%, transparent)' }
            : undefined;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-pointer group"
              onClick={(e) => {
                e.stopPropagation();
                handlers.current.onSelectTopic(node.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                handlers.current.onOpenDetails(node.id);
              }}
            >
              {/* Alone di selezione: anello esterno adiacente al bordo (3px, 24%) */}
              {isSelected && (
                <rect
                  x={-2.25}
                  y={-2.25}
                  width={node.w + 4.5}
                  height={node.h + 4.5}
                  rx={12.25}
                  fill="none"
                  stroke="color-mix(in oklab, var(--primary) 24%, transparent)"
                  strokeWidth={3}
                />
              )}

              {/* Rettangolo base della card del nodo */}
              <rect
                className={cn(
                  'transition-colors duration-150',
                  isSelected ? 'stroke-primary' : 'stroke-border group-hover:stroke-input'
                )}
                width={node.w}
                height={node.h}
                rx={10}
                fill={node.fill || (isRoot ? 'var(--map-root)' : 'var(--card)')}
                strokeWidth={isSelected || (isRoot && nodeAccent) ? 1.5 : 1}
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.04))', stroke: rootStroke }}
              />

              {/* Barretta d'accento a sinistra (colore scelto dall'utente) */}
              {!isRoot && nodeAccent && (
                <rect x={5} y={8} width={3} height={Math.max(node.h - 16, 4)} rx={1.5} fill={nodeAccent} />
              )}

              {/* Immagine allegata se presente */}
              {hasImage && !formulaSvg && (
                <image
                  href={resourceUrls.get(node.imageSrc!)}
                  x={8}
                  y={4}
                  width={Math.max(node.w - 16, 20)}
                  height={Math.max(node.h - 8, 20)}
                  preserveAspectRatio="xMidYMid meet"
                  className={node.kind === 'equation' && darkMode !== onInk ? 'invert' : undefined}
                />
              )}

              {/* Contenuto del nodo: formula SVG (ha la precedenza sul PNG allegato) o testo */}
              {(!hasImage || formulaSvg) && (
                <foreignObject
                  x={isRoot ? 12 : nodeAccent ? 14 : 10}
                  y={4}
                  width={Math.max(node.w - (isRoot ? 24 : nodeAccent ? 22 : 18), 10)}
                  height={Math.max(node.h - 8, 10)}
                >
                  <div
                    className={cn(
                      'w-full h-full flex flex-col justify-center select-none overflow-hidden',
                      onInk ? 'text-[color:var(--map-root-foreground)]' : 'text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      {formulaSvg ? (
                        <div
                          className="flex items-center max-w-full overflow-hidden shrink-0"
                          dangerouslySetInnerHTML={{ __html: formulaSvg }}
                        />
                      ) : (
                        <span
                          className={cn(
                            'break-words whitespace-normal leading-snug',
                            isRoot
                              ? 'text-sm font-semibold tracking-tight'
                              : isBranch
                              ? 'text-xs font-semibold'
                              : 'text-xs font-medium'
                          )}
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: Math.max(Math.floor((node.h - 8) / 16), 1),
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                          title={node.displayTitle || node.title}
                        >
                          {node.displayTitle || node.title || '(senza titolo)'}
                        </span>
                      )}

                      {node.hasNotes && (
                        <FileText
                          className={cn(
                            'size-3.5 shrink-0 self-center',
                            onInk ? 'opacity-70' : 'text-muted-foreground'
                          )}
                        />
                      )}
                    </div>

                    {/* Riga inferiore: etichette e marker */}
                    {(node.labels.length > 0 || node.markers.length > 0) && (
                      <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                        {node.markers.map((m) => {
                          const isPriority = m.startsWith('priority-');
                          const pNum = isPriority ? m.replace('priority-', '') : null;
                          return (
                            <span
                              key={m}
                              className={cn(
                                'inline-flex h-3.5 shrink-0 items-center justify-center rounded-sm px-1 text-3xs font-medium leading-none',
                                !onInk && 'bg-muted text-muted-foreground'
                              )}
                              style={chipInkStyle}
                              title={m}
                            >
                              {pNum ? `P${pNum}` : m.slice(0, 4)}
                            </span>
                          );
                        })}
                        {node.labels.map((lbl) => (
                          <span
                            key={lbl}
                            className={cn(
                              'block h-3.5 max-w-[60px] truncate rounded-sm border px-1 text-3xs font-medium leading-[12px]',
                              !onInk && 'text-muted-foreground'
                            )}
                            style={onInk ? { borderColor: 'color-mix(in oklab, var(--map-root-foreground) 32%, transparent)' } : undefined}
                          >
                            {lbl}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </foreignObject>
              )}

              {/* Indicatore comprimi / espandi: bordo destro, o sotto il blocco per la Tree Chart */}
              {hasChildren && (
                <g
                  transform={
                    node.childrenBelow
                      ? `translate(${trunkX(node) - node.x}, ${node.h + 8})`
                      : `translate(${node.w}, ${node.h / 2})`
                  }
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlers.current.onToggleCollapse(node.id);
                  }}
                >
                  <circle r={7} fill="var(--popover)" stroke="var(--input)" strokeWidth={1} />
                  {node.collapsed ? (
                    <path
                      d={node.childrenBelow ? 'M -3 -2 L 0 2 L 3 -2' : 'M -2 -3 L 2 0 L -2 3'}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <path d="M -3 0 L 3 0" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                  )}
                </g>
              )}
            </g>
          );
        })}
      </>
    );
  }, [layout, selectedTopicId, darkMode, resourceUrls, formulaSvgCache]);

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 p-8 text-center select-none bg-background">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <Network className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Nessuna mappa da visualizzare.</p>
          <p className="text-xs text-muted-foreground">Apri un file .xmind o creane uno nuovo per iniziare.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      className="relative flex-1 h-full w-full overflow-hidden bg-background select-none cursor-grab active:cursor-grabbing transition-colors duration-150"
    >
      {/* Controlli zoom flottanti in basso a destra */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer">
        <IconButton
          size="sm"
          variant="ghost"
          label="Riduci zoom"
          onClick={() => zoomByButton(1 / 1.2)}
        >
          <Minus className="size-4" />
        </IconButton>
        <span className="text-2xs font-mono tabular-nums text-muted-foreground min-w-[3rem] text-center">
          {Math.round(view.k * 100)}%
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label="Aumenta zoom"
          onClick={() => zoomByButton(1.2)}
        >
          <Plus className="size-4" />
        </IconButton>
        <Separator orientation="vertical" className="h-4 mx-0.5" />
        <IconButton size="sm" variant="ghost" label="Adatta alla finestra" onClick={fitAnimated}>
          <Maximize2 className="size-4" />
        </IconButton>
      </div>

      {/* Barra contestuale flottante sul nodo selezionato */}
      {selectedNode && (
        <div
          ref={toolbarRef}
          className="absolute z-20 pointer-events-auto flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer"
          style={{ transform: 'translateY(-100%)' }}
        >
          {onAddChild && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => onAddChild(selectedNode.id)}
              title="Aggiungi sotto-blocco"
            >
              Sotto-blocco
            </Button>
          )}
          {onOpenLatex && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Sigma className="size-4" />}
              onClick={() => onOpenLatex(selectedNode.id)}
              title="Modifica formula LaTeX"
            >
              Formula
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<Edit3 className="size-4" />}
            onClick={() => onOpenDetails(selectedNode.id)}
            title="Apri pannello dettagli"
          >
            Dettagli
          </Button>
          {selectedNode.depth > 0 && onDeleteTopic && (
            <>
              <Separator orientation="vertical" className="h-4 mx-0.5" />
              <IconButton
                size="sm"
                variant="ghost-destructive"
                label="Elimina blocco"
                onClick={() => {
                  if (confirm('Eliminare questo blocco?')) {
                    onDeleteTopic(selectedNode.id);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      )}

      {/* Canvas SVG principale */}
      {/* overflow-visible: l'SVG ritaglia prima della trasformazione, quindi senza
          questa classe a zoom < 1 la mappa verrebbe tagliata a una frazione del canvas.
          La trasformazione è applicata imperativamente (applyView), non da React. */}
      <svg
        ref={svgRef}
        className="w-full h-full overflow-visible"
        style={{ transformOrigin: '0 0', willChange: 'transform', textRendering: 'geometricPrecision' }}
      >
        {content}
      </svg>
    </div>
  );
};
