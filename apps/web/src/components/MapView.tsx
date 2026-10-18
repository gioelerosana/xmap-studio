import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layout, LayoutNode, MapStructure, Point, renderLatexToSvg, SUMMARY_BRACE_W, TitleRun, trunkX } from '@xmap/core';
import {
  Plus,
  Minus,
  Maximize2,
  FileText,
  Network,
  Edit3,
  Trash2,
  ListTree,
  GitFork,
  CornerDownLeft,
  Braces,
} from 'lucide-react';
import { Button, IconButton, Separator, cn } from '@xmap/ui-kit';
import { NodeEditor, type EditExit } from './map/NodeEditor.js';
import { hexLuminance, RichTitle, textStyleCss } from './map/RichTitle.js';
import { RelationshipLayer, type ControlPointsPatch } from './map/RelationshipLayer.js';
import {
  DropPlacement,
  DropTarget,
  buildDragIndex,
  computeDropTarget,
  isDraggable,
  subtreeOf,
} from './map/dragTarget.js';

// MathJax produce SVG con colore letterale, non una variabile CSS: i valori
// replicano il token foreground nei due temi e i testi su riempimento pieno.
const FORMULA_COLOR = { dark: '#f5f5f5', light: '#2b2b30' };
const TEXT_ON_DARK = '#ffffff';
const TEXT_ON_LIGHT = '#1f1f24';

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
const TAP_SLOP_PX = { mouse: 3, touch: 8 }; // oltre questa distanza il gesto è un pan, non un tap
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_ZOOM = 1.6;
const LONG_PRESS_MS = 400; // touch: pressione prolungata su un blocco = inizia il trascinamento
const DRAG_EDGE_ZONE = 48; // px dal bordo del canvas in cui il trascinamento fa scorrere la vista
const DRAG_EDGE_SPEED = 16; // px per frame al bordo estremo
const DRAG_DIM_OPACITY = '0.25';
// Smartphone: sotto questa larghezza l'adattamento non scende sotto uno zoom
// leggibile e il pannello dettagli è un bottom sheet che copre la parte bassa.
const COMPACT_WIDTH = 640;
const MIN_READABLE_ZOOM = 0.65;
const SHEET_VISIBLE_FRACTION = 0.4; // parte del canvas lasciata libera dal bottom sheet

/** `GestureEvent` di WebKit (pinch da trackpad in Safari/iPadOS): assente da lib.dom. */
interface SafariGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

interface NodeLook {
  fill: string;
  stroke: string;
  text: string;
  /** Testo chiaro: formule bianche, PNG di equazione invertiti, chip schiariti. */
  textLight: boolean;
  /** Riempimento pieno (radice, rami principali, fill esplicito): niente bordo hairline. */
  solid: boolean;
}

// Stile XMind: topic centrale pieno, rami principali pieni del colore del ramo,
// sotto-blocchi tinti dello stesso colore così le sezioni si leggono a colpo d'occhio.
function nodeLook(node: LayoutNode, darkMode: boolean): NodeLook {
  const solidOn = (color: string): NodeLook => {
    const lum = hexLuminance(color);
    const textLight = lum === null || lum < 0.45;
    return { fill: color, stroke: color, text: textLight ? TEXT_ON_DARK : TEXT_ON_LIGHT, textLight, solid: true };
  };
  if (node.fill) return solidOn(node.fill);
  if (node.depth === 0) {
    return {
      fill: 'var(--map-central)',
      stroke: 'var(--map-central)',
      text: 'var(--map-central-foreground)',
      textLight: true,
      solid: true,
    };
  }
  if (node.depth === 1 && node.accent) return solidOn(node.accent);
  if (node.accent) {
    return {
      fill: `color-mix(in oklab, ${node.accent} var(--map-tint), var(--map-canvas))`,
      stroke: `color-mix(in oklab, ${node.accent} 45%, transparent)`,
      text: 'var(--foreground)',
      textLight: darkMode,
      solid: false,
    };
  }
  return { fill: 'var(--card)', stroke: 'var(--border)', text: 'var(--foreground)', textLight: darkMode, solid: false };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Stato visivo del trascinamento di un blocco: fantasma (angolo in alto a sinistra, mondo) e bersaglio. */
interface DragOverlay {
  sourceId: string;
  ghost: Point;
  drop: DropTarget | null;
}

/** Editing in place del titolo di un blocco, governato dal genitore. */
export interface MapEditing {
  id: string;
  /** `all` = seleziona il testo esistente; `text` = parte da `text` (digitazione su blocco selezionato). */
  mode: 'all' | 'text';
  text?: string;
}

const INTERACTIVE = 'input, textarea, select, button, [contenteditable="true"]';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches),
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export interface MapViewProps {
  /** Identità del documento/foglio mostrato: quando cambia la vista si riadatta. */
  viewKey?: string;
  editing?: MapEditing | null;
  onStartEdit?: (topicId: string) => void;
  onCommitEdit?: (topicId: string, text: string, exit: EditExit, runs?: TitleRun[]) => void;
  onCancelEdit?: () => void;
  layout: Layout | null;
  /** Blocco con selezione primaria (determina l'Inspector e i dettagli). */
  selectedTopicId?: string;
  /**
   * Elenco degli ID dei blocchi selezionati nella mappa (selezione multipla).
   * Include la selezione primaria ed è evidenziato con lo stesso stile di selezione.
   */
  selectedTopicIds?: string[];
  /**
   * Clic su un blocco: con clic semplice deseleziona gli altri, con modificatore (Maiusc o Ctrl/Cmd)
   * aggiunge o toglie il blocco alla selezione multipla.
   */
  onSelectTopic: (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  onOpenDetails: (topicId: string) => void;
  onOpenLatex?: (topicId: string) => void;
  onAddChild?: (topicId: string) => void;
  /** Crea un fratello dopo il blocco, come Invio. */
  onAddSibling?: (topicId: string) => void;
  onDeleteTopic?: (topicId: string) => void;
  onToggleCollapse: (topicId: string) => void;
  resourceResolver: (src: string) => Uint8Array | null;
  darkMode?: boolean;
  structure: MapStructure;
  onStructureChange: (structure: MapStructure) => void;
  /** Rilascio di un blocco trascinato sulla mappa; stessa firma di `onMove` dell'albero. */
  onMoveTopic?: (topicId: string, targetId: string, placement: DropPlacement) => void;
  /** Rilascio di un topic libero (detached): `position` è il suo centro relativo al centro della radice. */
  onMoveFloatingTopic?: (topicId: string, position: Point) => void;
  /** Punti di controllo di una relazione trascinati (`null` = ripristina, `undefined` = invariato). */
  onRelationshipControlPointsChange?: (relationshipId: string, points: ControlPointsPatch) => void;
  /** Pannello dettagli aperto: su smartphone il blocco viene portato sopra il bottom sheet. */
  detailsOpen?: boolean;
  /** Callback per creare un sommario sui blocchi selezionati (es. Ctrl+] o pulsante barra). */
  onAddSummary?: () => void;
  /** Indica se i blocchi correntemente selezionati sono fratelli validi per creare un sommario. */
  canAddSummary?: boolean;
}

export const MapView: React.FC<MapViewProps> = ({
  layout,
  viewKey,
  selectedTopicId,
  selectedTopicIds,
  onSelectTopic,
  onOpenDetails,
  onOpenLatex,
  onAddChild,
  onAddSibling,
  onDeleteTopic,
  onToggleCollapse,
  resourceResolver,
  darkMode = true,
  structure,
  onStructureChange,
  detailsOpen = false,
  onMoveTopic,
  onMoveFloatingTopic,
  onRelationshipControlPointsChange,
  editing = null,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onAddSummary,
  canAddSummary = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorLayerRef = useRef<HTMLDivElement>(null);
  const isCoarse = useMediaQuery('(pointer: coarse)');
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Trasformazione "viva": durante i gesti si aggiorna solo questo ref e lo style
  // dell'SVG; `view` (stato React) viene allineato a gesto concluso.
  const viewRef = useRef<View>({ x: 60, y: 60, k: 1 });
  const [view, setView] = useState<View>(viewRef.current);
  const selectedNodeRef = useRef<LayoutNode | null>(null);
  const hasAutoFitted = useRef(false);
  const lastLayoutRef = useRef<Layout | null>(null);
  const lastViewKeyRef = useRef<string | undefined>(undefined);
  const anchorIdRef = useRef<string | undefined>(selectedTopicId); // selezione prima dell'ultima modifica
  const frameRef = useRef(0);
  const syncTimerRef = useRef<number | undefined>(undefined);
  const motionRef = useRef(0); // rAF di animazione o inerzia
  const zoomTargetRef = useRef<number | null>(null); // zoom di arrivo dei click +/- in corso
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  // Callback in un ref: il contenuto memoizzato non si ricostruisce se il genitore le ricrea.
  const handlers = useRef({
    onSelectTopic,
    onOpenDetails,
    onOpenLatex,
    onToggleCollapse,
    onMoveTopic,
    onMoveFloatingTopic,
    onRelationshipControlPointsChange,
    onStartEdit,
    onAddSummary,
  });
  handlers.current = {
    onSelectTopic,
    onOpenDetails,
    onOpenLatex,
    onToggleCollapse,
    onMoveTopic,
    onMoveFloatingTopic,
    onRelationshipControlPointsChange,
    onStartEdit,
    onAddSummary,
  };
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | undefined>();
  const [dragOverlay, setDragOverlay] = useState<DragOverlay | null>(null);
  const layoutRef = useRef<Layout | null>(layout);
  layoutRef.current = layout;
  const dragIndex = useMemo(() => (layout ? buildDragIndex(layout) : null), [layout]);
  const dragIndexRef = useRef(dragIndex);
  dragIndexRef.current = dragIndex;

  // Coordinate client -> coordinate mondo con pan/zoom correnti (anche a gesto in corso).
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (rect?.left ?? 0) - v.x) / v.k, y: (clientY - (rect?.top ?? 0) - v.y) / v.k };
  }, []);
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
            const look = nodeLook(node, darkMode);
            const color = !look.solid ? FORMULA_COLOR[theme] : look.textLight ? TEXT_ON_DARK : TEXT_ON_LIGHT;
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
    if (editorLayerRef.current) {
      editorLayerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
    const n = selectedNodeRef.current;
    if (toolbarRef.current && n) {
      // Su schermi stretti la barra resta dentro il canvas invece di uscire a destra.
      const maxLeft = Math.max(8, (containerRef.current?.clientWidth ?? Infinity) - toolbarRef.current.offsetWidth - 8);
      toolbarRef.current.style.left = `${Math.max(8, Math.min(v.x + n.x * v.k, maxLeft))}px`;
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
    if (rect.width < COMPACT_WIDTH && k < MIN_READABLE_ZOOM) {
      // Mappa intera illeggibile sul telefono: si parte dalla radice a zoom leggibile,
      // allineando il contenuto a sinistra e la radice al centro (o in alto, se è lì).
      const kr = MIN_READABLE_ZOOM;
      const root = layout.nodes.find((n) => n.depth === 0) ?? layout.nodes[0];
      const pad = 16;
      return {
        k: kr,
        x: pad - minX * kr,
        y: Math.min(rect.height / 2 - (root.y + root.h / 2) * kr, pad - minY * kr),
      };
    }
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

  // ResizeObserver e auto-fit solo quando cambia il documento (file o foglio).
  // Le modifiche (aggiunte, rinomine, spostamenti) non toccano lo zoom: la vista
  // trasla soltanto perché il blocco di riferimento resti fermo sullo schermo.
  useEffect(() => {
    if (!layout) return;

    const prev = lastLayoutRef.current;
    if (prev !== layout) {
      lastLayoutRef.current = layout;
      const rootOf = (l: Layout) => l.nodes.find((n) => n.depth === 0)?.id;
      const keyChanged = lastViewKeyRef.current !== viewKey;
      lastViewKeyRef.current = viewKey;
      if (!prev || keyChanged || rootOf(prev) !== rootOf(layout)) {
        hasAutoFitted.current = false;
      } else if (hasAutoFitted.current) {
        // Riferimento: il blocco selezionato prima della modifica, se esiste ancora, altrimenti la radice.
        const pick = (id?: string) => {
          const b = id ? prev.nodes.find((n) => n.id === id) : undefined;
          const a = b && layout.nodes.find((n) => n.id === b.id);
          return b && a ? { b, a } : null;
        };
        const pair = pick(anchorIdRef.current) ?? pick(rootOf(prev));
        const v = viewRef.current;
        let { x, y } = v;
        if (pair) {
          x -= (pair.a.x - pair.b.x) * v.k;
          y -= (pair.a.y - pair.b.y) * v.k;
        }
        // Il blocco selezionato (es. appena creato) deve restare visibile: pan minimo, zoom invariato.
        const sel = selectedTopicId ? layout.nodes.find((n) => n.id === selectedTopicId) : undefined;
        const rect = containerRef.current?.getBoundingClientRect();
        if (sel && rect) {
          const pad = 32;
          const left = x + sel.x * v.k;
          const right = x + (sel.x + sel.w) * v.k;
          const top = y + sel.y * v.k;
          const bottom = y + (sel.y + sel.h) * v.k;
          if (right > rect.width - pad) x -= right - (rect.width - pad);
          if (left < pad) x += pad - left;
          if (bottom > rect.height - pad) y -= bottom - (rect.height - pad);
          if (top < pad) y += pad - top;
        }
        if (x !== v.x || y !== v.y) {
          viewRef.current = { ...v, x, y };
          applyView();
          setView({ ...viewRef.current });
        }
      }
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

  // Dichiarato dopo l'effetto di auto-fit: lì serve ancora la selezione precedente.
  useEffect(() => {
    anchorIdRef.current = selectedTopicId;
  }, [selectedTopicId]);

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
      gestureCleanupRef.current?.();
    },
    []
  );

  // Pan e pinch con Pointer Events: un dito (o il mouse sullo sfondo) trascina con
  // inerzia, due dita zoomano attorno al punto medio spostando insieme la vista.
  // `touch-action: none` sul contenitore impedisce a Safari di zoomare la pagina.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'pan' | 'pinch' | 'nodepress' | 'drag' = 'none';
    let pointerType = 'mouse';
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let moved = false;
    let samples: { t: number; x: number; y: number }[] = [];
    let pinch = { dist: 1, mx: 0, my: 0, view: viewRef.current };
    let suppressClickUntil = 0;
    // Finestra più lunga dopo un doppio tap: il browser emette mousedown/click/dblclick sintetici.
    let suppressSyntheticUntil = 0;
    let lastTap = { t: 0, x: 0, y: 0, nodeId: null as string | null };
    // Trascinamento di un blocco: `pressedNode` è il blocco premuto in attesa di capire
    // se il gesto è un click, un pan (touch che si muove subito) o un drag.
    let pressedNode = -1;
    let longPressTimer = 0;
    interface ActiveDrag {
      src: number;
      excluded: Set<number>;
      ids: string[];
      grab: Point;
      ptr: { x: number; y: number };
      raf: number;
      lastSig: string;
      /** Topic libero: si muove senza bersaglio di rilascio; `delta` è lo spostamento in coordinate mondo. */
      floating?: { delta: Point };
    }
    let drag: ActiveDrag | null = null;

    const local = (x: number, y: number) => {
      const rect = container.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };

    const startInertia = () => {
      const now = performance.now();
      const first = samples[0];
      const lastSample = samples[samples.length - 1];
      if (!first || !lastSample || now - lastSample.t > 80 || lastSample.t - first.t < 8) return;
      let vx = (lastSample.x - first.x) / (lastSample.t - first.t);
      let vy = (lastSample.y - first.y) / (lastSample.t - first.t);
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

    const setDim = (ids: string[], on: boolean) => {
      const svg = svgRef.current;
      if (!svg) return;
      for (const id of ids) {
        const sel = CSS.escape(id);
        svg.querySelectorAll<SVGElement>(`[data-node-id="${sel}"],[data-edge-child="${sel}"]`).forEach((el) => {
          el.style.opacity = on ? DRAG_DIM_OPACITY : '';
        });
      }
    };

    const dropAt = (d: ActiveDrag): DropTarget | null => {
      const l = layoutRef.current;
      const idx = dragIndexRef.current;
      if (!l || !idx) return null;
      return computeDropTarget(l, idx, d.src, toWorld(d.ptr.x, d.ptr.y), d.excluded);
    };

    // Anteprima di un topic libero: sposta i blocchi del sotto-albero e i loro connettori.
    const previewFloating = (d: ActiveDrag) => {
      const l = layoutRef.current;
      const svg = svgRef.current;
      if (!l || !svg || !d.floating) return;
      const n = l.nodes[d.src];
      const wp = toWorld(d.ptr.x, d.ptr.y);
      const delta = { x: wp.x - d.grab.x - n.x, y: wp.y - d.grab.y - n.y };
      d.floating.delta = delta;
      for (const i of d.excluded) {
        const m = l.nodes[i];
        const sel = CSS.escape(m.id);
        svg.querySelector(`[data-node-id="${sel}"]`)?.setAttribute('transform', `translate(${m.x + delta.x}, ${m.y + delta.y})`);
        const edge = svg.querySelector<SVGElement>(`[data-edge-child="${sel}"]`);
        if (edge) edge.style.transform = `translate(${delta.x}px, ${delta.y}px)`;
      }
    };

    const restoreFloating = (d: ActiveDrag) => {
      const l = layoutRef.current;
      const svg = svgRef.current;
      if (!l || !svg) return;
      for (const i of d.excluded) {
        const m = l.nodes[i];
        if (!m) continue;
        const sel = CSS.escape(m.id);
        svg.querySelector(`[data-node-id="${sel}"]`)?.setAttribute('transform', `translate(${m.x}, ${m.y})`);
        const edge = svg.querySelector<SVGElement>(`[data-edge-child="${sel}"]`);
        if (edge) edge.style.transform = '';
      }
    };

    const updateOverlay = (d: ActiveDrag) => {
      const l = layoutRef.current;
      if (!l) return;
      const wp = toWorld(d.ptr.x, d.ptr.y);
      const drop = dropAt(d);
      const ghost = { x: wp.x - d.grab.x, y: wp.y - d.grab.y };
      const sig = `${ghost.x.toFixed(1)},${ghost.y.toFixed(1)}|${drop?.targetId}:${drop?.placement}`;
      if (sig === d.lastSig) return;
      d.lastSig = sig;
      setDragOverlay({ sourceId: l.nodes[d.src].id, ghost, drop });
    };

    // Ad ogni frame: scorrimento automatico vicino ai bordi e aggiornamento di fantasma/bersaglio.
    const dragTick = () => {
      const d = drag;
      if (!d) return;
      const rect = container.getBoundingClientRect();
      const edge = (dist: number) => DRAG_EDGE_SPEED * Math.min(Math.max((DRAG_EDGE_ZONE - dist) / DRAG_EDGE_ZONE, 0), 1);
      const dx = edge(d.ptr.x - rect.left) - edge(rect.right - d.ptr.x);
      const dy = edge(d.ptr.y - rect.top) - edge(rect.bottom - d.ptr.y);
      if (dx !== 0 || dy !== 0) {
        const v = viewRef.current;
        viewRef.current = { ...v, x: v.x + dx, y: v.y + dy };
        applyView();
        scheduleSync();
      }
      if (d.floating) previewFloating(d);
      else updateOverlay(d);
      d.raf = requestAnimationFrame(dragTick);
    };

    const onDragKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishDrag(false);
    };

    const finishDrag = (commit: boolean) => {
      const d = drag;
      if (!d) return;
      drag = null;
      cancelAnimationFrame(d.raf);
      window.removeEventListener('keydown', onDragKey);
      const l = layoutRef.current;
      if (d.floating) {
        previewFloating(d);
        const { delta } = d.floating;
        restoreFloating(d);
        const n = l?.nodes[d.src];
        if (commit && n?.floatOrigin && (Math.abs(delta.x) >= 1 || Math.abs(delta.y) >= 1)) {
          handlers.current.onMoveFloatingTopic?.(n.id, {
            x: n.x + delta.x + n.w / 2 - n.floatOrigin.x,
            y: n.y + delta.y + n.h / 2 - n.floatOrigin.y,
          });
        }
        return;
      }
      setDim(d.ids, false);
      setDragOverlay(null);
      const drop = commit ? dropAt(d) : null;
      if (drop && l) handlers.current.onMoveTopic?.(l.nodes[d.src].id, drop.targetId, drop.placement);
    };

    const beginDrag = () => {
      window.clearTimeout(longPressTimer);
      const l = layoutRef.current;
      const [p] = [...pointers.values()];
      if (!l || !p || pressedNode < 0 || !l.nodes[pressedNode]) return;
      cancelMotion();
      const src = pressedNode;
      const n = l.nodes[src];
      const wp = toWorld(p.x, p.y);
      const excluded = subtreeOf(l, src);
      const ids = [...excluded].map((i) => l.nodes[i].id);
      mode = 'drag';
      moved = true;
      drag = { src, excluded, ids, grab: { x: wp.x - n.x, y: wp.y - n.y }, ptr: { ...p }, raf: 0, lastSig: '' };
      if (n.floating && n.floatOrigin && handlers.current.onMoveFloatingTopic) {
        drag.floating = { delta: { x: 0, y: 0 } };
      } else {
        setDim(ids, true);
      }
      window.addEventListener('keydown', onDragKey);
      if (pointerType !== 'mouse') navigator.vibrate?.(12);
      dragTick();
    };

    const beginPinch = () => {
      window.clearTimeout(longPressTimer);
      pressedNode = -1;
      const [a, b] = [...pointers.values()];
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), mx: mid.x, my: mid.y, view: { ...viewRef.current } };
      mode = 'pinch';
      moved = true;
      samples = [];
    };

    const beginPan = (p: { x: number; y: number }) => {
      mode = 'pan';
      last = p;
      samples = [];
    };

    // Tap senza movimento: il doppio tap su un blocco di testo avvia l'editing in place,
    // su altri blocchi apre i dettagli, sullo sfondo zooma.
    const handleTap = (e: PointerEvent) => {
      const nodeId = (e.target as Element | null)?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
      const now = performance.now();
      const isDouble =
        now - lastTap.t < DOUBLE_TAP_MS &&
        lastTap.nodeId === nodeId &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
      lastTap = isDouble ? { t: 0, x: 0, y: 0, nodeId: null } : { t: now, x: e.clientX, y: e.clientY, nodeId };
      if (!isDouble) return;
      if (nodeId) {
        setSelectedRelationshipId(undefined);
        handlers.current.onSelectTopic(nodeId);
        const node = layoutRef.current?.nodes.find((n) => n.id === nodeId);
        if (node?.kind === 'text' && handlers.current.onStartEdit) {
          if (editingRef.current?.id !== nodeId) {
            handlers.current.onStartEdit(nodeId);
          }
        } else {
          handlers.current.onOpenDetails(nodeId);
        }
        suppressSyntheticUntil = performance.now() + 400;
      } else {
        const p = local(e.clientX, e.clientY);
        const k = clampZoom(viewRef.current.k * DOUBLE_TAP_ZOOM);
        animateTo({ ...viewRef.current, k }, 220, { cx: p.x, cy: p.y });
        suppressSyntheticUntil = performance.now() + 400;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'drag') {
        if (drag) drag.ptr = { x: e.clientX, y: e.clientY };
        return;
      }
      if (mode === 'nodepress') {
        const slopPress = pointerType === 'mouse' ? TAP_SLOP_PX.mouse : TAP_SLOP_PX.touch;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < slopPress) return;
        if (pointerType === 'mouse') {
          beginDrag();
          return;
        }
        // Touch: un dito che si muove prima della pressione prolungata fa pan.
        window.clearTimeout(longPressTimer);
        pressedNode = -1;
        beginPan({ x: start.x, y: start.y });
      }
      if (mode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        const sv = pinch.view;
        const k = clampZoom(sv.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist));
        // Il punto del mondo sotto il punto medio iniziale segue il punto medio attuale.
        const wx = (pinch.mx - sv.x) / sv.k;
        const wy = (pinch.my - sv.y) / sv.k;
        viewRef.current = { k, x: mid.x - wx * k, y: mid.y - wy * k };
        scheduleApply();
        return;
      }
      if (mode !== 'pan') return;
      const slop = pointerType === 'mouse' ? TAP_SLOP_PX.mouse : TAP_SLOP_PX.touch;
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < slop) return;
      moved = true;
      const now = performance.now();
      const v = viewRef.current;
      viewRef.current = { ...v, x: v.x + e.clientX - last.x, y: v.y + e.clientY - last.y };
      last = { x: e.clientX, y: e.clientY };
      samples.push({ t: now, x: viewRef.current.x, y: viewRef.current.y });
      samples = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
      scheduleApply();
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (mode === 'drag') {
        // Anche un drag annullato con Esc resta in questa modalità fino al rilascio.
        if (drag) drag.ptr = { x: e.clientX, y: e.clientY };
        finishDrag(e.type === 'pointerup');
        mode = 'none';
        pressedNode = -1;
        cleanup();
        suppressClickUntil = performance.now() + 400;
        return;
      }
      window.clearTimeout(longPressTimer);
      pressedNode = -1;
      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      if (pointers.size === 1) {
        // Da pinch a un dito: il pan riparte dal dito rimasto, senza salti.
        const [rest] = [...pointers.values()];
        beginPan(rest);
        return;
      }
      const wasPan = mode === 'pan';
      mode = 'none';
      cleanup();
      if (moved) {
        // Il click sintetico che segue un trascinamento non deve selezionare il blocco.
        suppressClickUntil = performance.now() + 400;
        if (wasPan && e.type === 'pointerup') startInertia();
      } else if (e.type === 'pointerup' && pointerType !== 'mouse') {
        handleTap(e);
      }
    };

    const cleanup = () => {
      window.clearTimeout(longPressTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      gestureCleanupRef.current = null;
    };

    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest('[data-map-ui]')) return;
      if (mode === 'drag') return;
      // Blocco trascinabile sotto il puntatore (non la radice, né l'indicatore di collasso).
      let nodeIdx = -1;
      const nodeEl = target.closest('[data-node-id]');
      const l = layoutRef.current;
      const di = dragIndexRef.current;
      if (nodeEl && l && di && !target.closest('[data-collapse-toggle]')) {
        const i = di.byId.get(nodeEl.getAttribute('data-node-id') ?? '');
        if (i !== undefined && (isDraggable(l, di, i) || (l.nodes[i]?.floating && handlers.current.onMoveFloatingTopic))) {
          nodeIdx = i;
        }
      }
      if (e.pointerType === 'mouse') {
        // Col mouse il pan parte dallo sfondo; su un blocco trascinabile parte il drag
        // oltre la soglia, altrimenti restano click e doppio click.
        const onBackground = target === container || target.tagName === 'svg' || target.id === 'map-bg';
        if (e.button !== 0 || (!onBackground && nodeIdx < 0) || pointers.size > 0) return;
      }
      if (pointers.size >= 2) return;
      cancelMotion();
      if (pointers.size === 0) {
        gestureCleanupRef.current?.();
        pointerType = e.pointerType;
        moved = false;
        start = { x: e.clientX, y: e.clientY };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        gestureCleanupRef.current = cleanup;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        beginPinch();
      } else if (nodeIdx >= 0) {
        mode = 'nodepress';
        pressedNode = nodeIdx;
        last = { x: e.clientX, y: e.clientY };
        samples = [];
        // Touch: il drag parte con pressione prolungata, così il pan col dito resta possibile.
        if (e.pointerType !== 'mouse') {
          longPressTimer = window.setTimeout(() => {
            if (mode === 'nodepress') beginDrag();
          }, LONG_PRESS_MS);
        }
      } else {
        beginPan({ x: e.clientX, y: e.clientY });
      }
    };

    // Il menu contestuale della pressione prolungata (touch) coprirebbe il drag.
    const onContextMenu = (e: Event) => {
      if (mode === 'nodepress' || mode === 'drag') e.preventDefault();
    };

    const onMouseCapture = (e: MouseEvent) => {
      const synthetic = performance.now() < suppressSyntheticUntil;
      if (e.type === 'click' && !synthetic && performance.now() < suppressClickUntil) {
        suppressClickUntil = 0;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (synthetic) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    // Pinch da trackpad in Safari (macOS, iPad con Magic Keyboard): arriva come
    // GestureEvent e non come wheel+ctrl. Il pinch col dito è già gestito sopra.
    let gestureView: View | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      cancelMotion();
      gestureView = pointers.size >= 2 ? null : { ...viewRef.current };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!gestureView || pointers.size >= 2) return;
      const g = e as SafariGestureEvent;
      const sv = gestureView;
      const k = clampZoom(sv.k * g.scale);
      const p = local(g.clientX, g.clientY);
      const ratio = k / viewRef.current.k;
      const v = viewRef.current;
      viewRef.current = { k, x: p.x - (p.x - v.x) * ratio, y: p.y - (p.y - v.y) * ratio };
      scheduleApply();
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureView = null;
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('click', onMouseCapture, true);
    container.addEventListener('dblclick', onMouseCapture, true);
    container.addEventListener('mousedown', onMouseCapture, true);
    container.addEventListener('gesturestart', onGestureStart);
    container.addEventListener('gesturechange', onGestureChange);
    container.addEventListener('gestureend', onGestureEnd);
    return () => {
      cleanup();
      finishDrag(false);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('click', onMouseCapture, true);
      container.removeEventListener('dblclick', onMouseCapture, true);
      container.removeEventListener('mousedown', onMouseCapture, true);
      container.removeEventListener('gesturestart', onGestureStart);
      container.removeEventListener('gesturechange', onGestureChange);
      container.removeEventListener('gestureend', onGestureEnd);
    };
  }, [hasContent, animateTo, applyView, cancelMotion, scheduleApply, scheduleSync, toWorld]);

  const selectedNode = useMemo(() => {
    if (!layout || !selectedTopicId) return null;
    return layout.nodes.find((n) => n.id === selectedTopicId) || null;
  }, [layout, selectedTopicId]);

  selectedNodeRef.current = selectedNode;

  const editingNode = useMemo(() => {
    if (!layout || !editing) return null;
    return layout.nodes.find((n) => n.id === editing.id) || null;
  }, [layout, editing]);

  // Un blocco appena creato può cadere fuori schermo: lo si porta in vista.
  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!editingNode || !rect) return;
    const v = viewRef.current;
    const left = v.x + editingNode.x * v.k;
    const right = left + Math.max(editingNode.w, 120) * v.k;
    const top = v.y + editingNode.y * v.k;
    const bottom = top + editingNode.h * v.k;
    let dx = 0;
    let dy = 0;
    if (left < 16) dx = 16 - left;
    else if (right > rect.width - 16) dx = rect.width - 16 - right;
    if (top < 56) dy = 56 - top;
    else if (bottom > rect.height - 16) dy = rect.height - 16 - bottom;
    if (dx !== 0 || dy !== 0) animateTo({ k: v.k, x: v.x + dx, y: v.y + dy }, 200);
    // Solo quando si apre l'editor su un blocco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, Boolean(editingNode)]);

  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!detailsOpen || !selectedNode || !rect || rect.width >= COMPACT_WIDTH) return;
    const v = viewRef.current;
    const cy = v.y + (selectedNode.y + selectedNode.h / 2) * v.k;
    const cx = v.x + (selectedNode.x + selectedNode.w / 2) * v.k;
    const visibleH = rect.height * SHEET_VISIBLE_FRACTION;
    const insideY = cy > 56 && cy < visibleH - 16;
    const insideX = cx > 16 && cx < rect.width - 16;
    if (insideY && insideX) return;
    animateTo(
      {
        k: v.k,
        x: insideX ? v.x : rect.width / 2 - (selectedNode.x + selectedNode.w / 2) * v.k,
        y: visibleH * 0.6 - (selectedNode.y + selectedNode.h / 2) * v.k,
      },
      240
    );
  }, [detailsOpen, selectedNode, animateTo]);
  // Scorciatoie da tastiera della mappa su desktop:
  // - Ctrl+I / Cmd+I: apre il pannello dettagli sul blocco selezionato.
  // - Ctrl+Maiusc+L / Cmd+Maiusc+L: apre l'editor della formula LaTeX.
  // Usiamo Ctrl/Cmd anziché lettere semplici (D, L) perché la digitazione
  // di lettere su un blocco di testo selezionato avvia l'editing in place del titolo.
  useEffect(() => {
    if (!selectedTopicId || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta || e.altKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();
      if (!e.shiftKey && key === 'i') {
        e.preventDefault();
        handlers.current.onOpenDetails(selectedTopicId);
      } else if (e.shiftKey && key === 'l') {
        if (handlers.current.onOpenLatex) {
          e.preventDefault();
          handlers.current.onOpenLatex(selectedTopicId);
        }
      } else if (key === ']' || e.code === 'BracketRight') {
        if (handlers.current.onAddSummary) {
          e.preventDefault();
          handlers.current.onAddSummary();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTopicId, editing]);

  // Dopo ogni render riapplica la vista viva (SVG appena montato, barra del nodo).
  useLayoutEffect(() => {
    applyView();
  });

  // Contenuto pesante dell'SVG: dipende solo da layout/selezione/tema, non da zoom
  // e pan, così durante i gesti React non lo ricostruisce.
  const content = useMemo(() => {
    if (!layout) return null;
    const selectedSet = new Set(selectedTopicIds && selectedTopicIds.length > 0 ? selectedTopicIds : []);
    if (selectedTopicId) selectedSet.add(selectedTopicId);
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
            stroke={layout.nodes[t.parent]?.accent || 'var(--map-link)'}
            strokeWidth={2}
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
              data-edge-child={c.id}
              d={pathD}
              fill="none"
              stroke={c.accent || 'var(--map-link)'}
              strokeWidth={c.depth <= 1 ? 3 : 2}
              strokeLinecap="round"
            />
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
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Nodi della mappa */}
        {layout.nodes.map((node) => {
          const isSelected = selectedSet.has(node.id);
          const isRoot = node.depth === 0;
          const isBranch = node.depth === 1;
          const look = nodeLook(node, darkMode);
          const hasChildren = node.childCount > 0;
          const formulaSvg = formulaSvgCache.get(node.id);
          const hasImage = Boolean(node.imageSrc && resourceUrls.has(node.imageSrc));
          // Su riempimento pieno i chip si tingono del colore del testo.
          const chipSolidStyle = look.solid
            ? { backgroundColor: 'color-mix(in oklab, currentColor 18%, transparent)' }
            : undefined;

          return (
            <g
              key={node.id}
              data-node-id={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-pointer group"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedRelationshipId(undefined);
                const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
                handlers.current.onSelectTopic(
                  node.id,
                  isMulti ? { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey } : undefined
                );
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                // I blocchi di testo si modificano in place (anche su touch); formule e immagini aprono i dettagli.
                if (editingRef.current?.id === node.id) return;
                if (node.kind === 'text' && handlers.current.onStartEdit) {
                  handlers.current.onStartEdit(node.id);
                } else {
                  handlers.current.onOpenDetails(node.id);
                }
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
                className="transition-[filter] duration-150 group-hover:brightness-110"
                width={node.w}
                height={node.h}
                rx={isRoot ? 12 : 10}
                fill={look.fill}
                stroke={isSelected ? 'var(--primary)' : look.stroke}
                strokeWidth={isSelected ? 1.5 : 1}
                style={{ filter: look.solid ? 'drop-shadow(0 1px 3px rgba(0,0,0,0.18))' : undefined }}
              />

              {/* Immagine allegata se presente */}
              {hasImage && !formulaSvg && (
                <image
                  href={resourceUrls.get(node.imageSrc!)}
                  x={8}
                  y={4}
                  width={Math.max(node.w - 16, 20)}
                  height={Math.max(node.h - 8, 20)}
                  preserveAspectRatio="xMidYMid meet"
                  className={node.kind === 'equation' && look.textLight ? 'invert' : undefined}
                />
              )}

              {/* Contenuto del nodo: formula SVG (ha la precedenza sul PNG allegato) o testo */}
              {(!hasImage || formulaSvg) && (
                <foreignObject
                  x={isRoot ? 12 : 10}
                  y={4}
                  width={Math.max(node.w - (isRoot ? 24 : 18), 10)}
                  height={Math.max(node.h - 8, 10)}
                >
                  <div
                    className="w-full h-full flex flex-col justify-center select-none overflow-hidden"
                    style={{ color: look.text }}
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
                              : 'text-xs font-normal'
                          )}
                          style={{
                            ...textStyleCss(node.textStyle, look.textLight),
                            display: '-webkit-box',
                            WebkitLineClamp: Math.max(Math.floor((node.h - 8) / 16), 1),
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                          title={node.displayTitle || node.title}
                        >
                          <RichTitle text={node.displayTitle || node.title || '(senza titolo)'} runs={node.titleRuns} textLight={look.textLight} />
                        </span>
                      )}

                      {node.hasNotes && (
                        <FileText
                          className={cn(
                            'size-3.5 shrink-0 self-center',
                            look.solid ? 'opacity-70' : 'text-muted-foreground'
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
                                !look.solid && 'bg-muted text-muted-foreground'
                              )}
                              style={chipSolidStyle}
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
                              !look.solid && 'text-muted-foreground'
                            )}
                            style={look.solid ? { borderColor: 'color-mix(in oklab, currentColor 32%, transparent)' } : undefined}
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
                  data-collapse-toggle
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
                  <circle r={7} fill="var(--popover)" stroke={node.accent || 'var(--input)'} strokeWidth={1} />
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

        {/* Relazioni dopo i blocchi: le maniglie di piegatura devono restare cliccabili anche
            sopra i blocchi. `data-map-ui` esclude il layer da pan e drag del contenitore. */}
        <g data-map-ui>
          <RelationshipLayer
            relationships={layout.relationships}
            nodes={layout.nodes}
            selectedRelationshipId={selectedRelationshipId}
            onSelectRelationship={setSelectedRelationshipId}
            onControlPointsChange={(relId, points) =>
              handlers.current.onRelationshipControlPointsChange?.(relId, points)
            }
            toWorld={toWorld}
            darkMode={darkMode}
          />
        </g>
      </>
    );
  }, [layout, selectedTopicId, selectedTopicIds, selectedRelationshipId, darkMode, resourceUrls, formulaSvgCache, toWorld]);

  // Fantasma del blocco trascinato e indicatore del bersaglio, sopra tutto il resto.
  const dragLayer = useMemo(() => {
    if (!dragOverlay || !layout) return null;
    const src = layout.nodes.find((n) => n.id === dragOverlay.sourceId);
    if (!src) return null;
    const look = nodeLook(src, darkMode);
    const { ghost, drop } = dragOverlay;
    const target = drop ? layout.nodes[drop.targetIndex] : undefined;
    const ind = drop?.indicator;
    return (
      <g pointerEvents="none">
        {target && drop && (
          <rect
            x={target.x - 3}
            y={target.y - 3}
            width={target.w + 6}
            height={target.h + 6}
            rx={13}
            fill={drop.placement === 'into' ? 'color-mix(in oklab, var(--primary) 14%, transparent)' : 'none'}
            stroke="var(--primary)"
            strokeWidth={drop.placement === 'into' ? 2 : 1}
            strokeOpacity={drop.placement === 'into' ? 1 : 0.45}
          />
        )}
        {ind?.kind === 'line' && (
          <g stroke="var(--primary)" fill="var(--primary)">
            <line x1={ind.x1} x2={ind.x2} y1={ind.y} y2={ind.y} strokeWidth={3} strokeLinecap="round" />
            <circle cx={ind.x1} cy={ind.y} r={4} stroke="none" />
          </g>
        )}
        {ind?.kind === 'child' && (
          <g stroke="var(--primary)" fill="none">
            <path
              d={`M ${ind.from.x} ${ind.from.y} C ${ind.from.x + 28} ${ind.from.y}, ${ind.to.x - 28} ${ind.to.y}, ${ind.to.x} ${ind.to.y}`}
              strokeWidth={2.5}
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
            <rect
              x={ind.to.x}
              y={ind.to.y - ind.h / 2}
              width={ind.w}
              height={ind.h}
              rx={10}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              fill="color-mix(in oklab, var(--primary) 10%, transparent)"
            />
          </g>
        )}
        <g transform={`translate(${ghost.x}, ${ghost.y})`} opacity={0.75}>
          <rect
            width={src.w}
            height={src.h}
            rx={10}
            fill={look.fill}
            stroke={look.stroke}
            strokeWidth={1}
            style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.3))' }}
          />
          <foreignObject x={10} y={4} width={Math.max(src.w - 18, 10)} height={Math.max(src.h - 8, 10)}>
            <div
              className="flex h-full w-full items-center overflow-hidden text-xs leading-snug"
              style={{ color: look.text }}
            >
              <span className="line-clamp-3 break-words" style={textStyleCss(src.textStyle)}>
                {src.latex ? src.latex : src.displayTitle || src.title || '(senza titolo)'}
              </span>
            </div>
          </foreignObject>
        </g>
      </g>
    );
  }, [dragOverlay, layout, darkMode]);

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
      className={cn(
        'relative flex-1 h-full w-full overflow-clip bg-[var(--map-canvas)] select-none touch-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] cursor-grab active:cursor-grabbing transition-colors duration-150',
        dragOverlay && '!cursor-grabbing'
      )}
      onClick={(e) => {
        // Click sullo sfondo: deseleziona la relazione.
        const t = e.target as Element;
        if (t === e.currentTarget || t.tagName === 'svg' || t.id === 'map-bg') setSelectedRelationshipId(undefined);
      }}
    >
      {/* Barra contestuale di selezione multipla */}
      {selectedTopicIds && selectedTopicIds.length > 1 && (
        <div
          data-map-ui
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-1.5 p-1.5 surface-glass border rounded-xl shadow-composer max-w-[calc(100%-32px)]"
        >
          <span className="px-2 text-xs font-medium text-foreground whitespace-nowrap">
            {selectedTopicIds.length} blocchi selezionati
          </span>
          {onAddSummary && (
            <>
              <Separator orientation="vertical" className="h-4 mx-0.5" />
              <Button
                variant={canAddSummary ? 'default' : 'ghost'}
                size="sm"
                className="px-2.5 text-xs"
                icon={<Braces className="size-4" />}
                onClick={onAddSummary}
                title="Crea sommario sui blocchi selezionati (Ctrl+])"
              >
                Sommario
              </Button>
            </>
          )}
        </div>
      )}

      {/* Controlli zoom flottanti in basso a destra */}
      <div
        data-map-ui
        className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-20 flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer">
        <IconButton
          size="sm"
          variant="ghost"
          label="Vista ad albero"
          aria-pressed={structure === 'tree'}
          className={cn(structure === 'tree' && 'bg-accent text-foreground')}
          onClick={() => onStructureChange('tree')}
        >
          <ListTree className="size-4" />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="Vista a logica"
          aria-pressed={structure === 'logic'}
          className={cn(structure === 'logic' && 'bg-accent text-foreground')}
          onClick={() => onStructureChange('logic')}
        >
          <GitFork className="size-4 -rotate-90" />
        </IconButton>
        <Separator orientation="vertical" className="h-4 mx-0.5" />
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

      {/* Barra contestuale flottante sul nodo selezionato: visibile solo su dispositivi touch (pointer: coarse) */}
      {isCoarse && selectedNode && (
        <div
          ref={toolbarRef}
          data-map-ui
          // Niente focus sui pulsanti: le scorciatoie da tastiera sulla mappa restano attive.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 pointer-events-auto flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer max-w-[calc(100%-16px)]"
          style={{ transform: 'translateY(-100%)' }}
        >
          {onAddChild && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<Plus className="size-4" />}
              onClick={() => onAddChild(selectedNode.id)}
              title="Aggiungi sotto-blocco"
            >
              <span className="hidden min-[380px]:inline">Sotto-blocco</span>
              <span className="min-[380px]:hidden">Sotto</span>
            </Button>
          )}
          {onAddSibling && selectedNode.depth > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<CornerDownLeft className="size-4" />}
              onClick={() => onAddSibling(selectedNode.id)}
              title="Aggiungi blocco fratello"
            >
              Fratello
            </Button>
          )}
          {onAddSummary && canAddSummary && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<Braces className="size-4" />}
              onClick={onAddSummary}
              title="Crea sommario (Ctrl+])"
            >
              Sommario
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="px-2 sm:px-[9px] text-xs sm:text-sm"
            icon={<Edit3 className="size-4" />}
            onClick={() => onOpenDetails(selectedNode.id)}
            title="Modifica il blocco (testo, formula, stile)"
          >
            Modifica
          </Button>
          {selectedNode.depth > 0 && onDeleteTopic && (
            <>
              <Separator orientation="vertical" className="h-4 mx-0.5" />
              <IconButton
                size="sm"
                variant="ghost-destructive"
                label="Elimina blocco"
                onClick={() => onDeleteTopic(selectedNode.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      )}

      {/* Editor in place del titolo: stesso sistema di coordinate dell'SVG, quindi segue pan e zoom. */}
      {editingNode && editing && onCommitEdit && (
        <div
          ref={editorLayerRef}
          data-map-ui
          className="absolute left-0 top-0 z-10 size-0"
          style={{ transformOrigin: '0 0' }}
        >
          <NodeEditor
            key={editing.id}
            x={editingNode.x}
            y={editingNode.y}
            w={editingNode.w}
            h={editingNode.h}
            isRoot={editingNode.depth === 0}
            initialText={editing.mode === 'text' ? editing.text ?? '' : editingNode.title}
            initialRuns={editing.mode === 'text' ? undefined : editingNode.titleRuns}
            selectAll={editing.mode === 'all'}
            onCommit={(text, exit, runs) => onCommitEdit(editing.id, text, exit, runs)}
            onCancel={() => onCancelEdit?.()}
          />
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
        {dragLayer}
      </svg>
    </div>
  );
};
