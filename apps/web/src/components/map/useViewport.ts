import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Layout, LayoutNode, Point } from '@xmap/core';
import { clampZoom, computeFitView, type View } from './viewport.js';

const SYNC_DELAY_MS = 120;

/**
 * Pan e zoom della mappa. Durante i gesti si aggiorna solo `viewRef` e lo style dell'SVG;
 * lo stato React `view` viene allineato a gesto concluso.
 *
 * Nitidezza: una trasformazione CSS (con `will-change`) fa rasterizzare l'SVG una volta e poi
 * ingrandisce la bitmap: il testo esce sgranato e Safari su iPad non lo ridisegna mai. Per questo
 * la vista "a riposo" è scritta come attributo `transform` del gruppo `[data-map-viewport]`
 * (il browser ridisegna in vettoriale alla scala giusta); durante i gesti la CSS applica solo la
 * differenza rispetto a quella vista, e a gesto concluso la si riporta nell'attributo.
 */
const MAP_MOVING_ATTR = 'data-map-moving';

export function useViewport(layout: Layout | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorLayerRef = useRef<HTMLDivElement>(null);
  // Trasformazione "viva": durante i gesti si aggiorna solo questo ref e lo style
  // dell'SVG; `view` (stato React) viene allineato a gesto concluso.
  const viewRef = useRef<View>({ x: 60, y: 60, k: 1 });
  const [view, setView] = useState<View>(viewRef.current);
  const viewportGroupRef = useRef<SVGGElement>(null);
  // Vista scritta nell'attributo di `viewportGroupRef`: base della trasformazione CSS dei gesti.
  const committedRef = useRef<View>(viewRef.current);
  const selectedNodeRef = useRef<LayoutNode | null>(null);
  const frameRef = useRef(0);
  const syncTimerRef = useRef<number | undefined>(undefined);
  const syncDueRef = useRef(0); // istante in cui allineare lo stato React (vedi `scheduleSync`)
  // Larghezze di canvas e barra del blocco lette da `applyView`; `undefined` = da misurare.
  const widthsRef = useRef<{ container?: number; toolbar?: number }>({});
  const observedRef = useRef<{ ro: ResizeObserver | null; container: Element | null; toolbar: Element | null }>({
    ro: null,
    container: null,
    toolbar: null,
  });
  const motionRef = useRef(0); // rAF di animazione o inerzia
  const zoomTargetRef = useRef<number | null>(null); // zoom di arrivo dei click +/- in corso

  // Coordinate client -> coordinate mondo con pan/zoom correnti (anche a gesto in corso).
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (rect?.left ?? 0) - v.x) / v.k, y: (clientY - (rect?.top ?? 0) - v.y) / v.k };
  }, []);

  const applyView = useCallback(() => {
    const v = viewRef.current;
    const svg = svgRef.current;
    const toolbar = toolbarRef.current;
    const n = selectedNodeRef.current;
    // Su schermi stretti la barra resta dentro il canvas invece di uscire a destra. Le larghezze
    // vengono dalla cache di `widthsRef` (aggiornata dal ResizeObserver): una lettura di
    // `offsetWidth` qui, a ogni frame dei gesti e a ogni render, forzerebbe un layout sincrono
    // (su iPad la barra del blocco è sempre visibile). Si misura davvero solo la prima volta.
    let maxLeft = 0;
    if (toolbar && n) {
      const w = widthsRef.current;
      w.container ??= containerRef.current?.clientWidth;
      w.toolbar ??= toolbar.offsetWidth;
      maxLeft = Math.max(8, (w.container ?? Infinity) - w.toolbar - 8);
    }
    if (svg) {
      const c = committedRef.current;
      const s = v.k / c.k;
      const tx = v.x - c.x * s;
      const ty = v.y - c.y * s;
      const atRest = s === 1 && tx === 0 && ty === 0;
      // A riposo nessun layer composito: la mappa si dipinge in vettoriale, nitida.
      svg.style.transform = atRest ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
      svg.style.willChange = atRest ? '' : 'transform';
    }
    if (editorLayerRef.current) {
      editorLayerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
    if (toolbar && n) {
      toolbar.style.left = `${Math.max(8, Math.min(v.x + n.x * v.k, maxLeft))}px`;
      toolbar.style.top = `${v.y + (n.y - 42) * v.k}px`;
    }
  }, []);

  // Porta la vista viva nell'attributo del gruppo e azzera la trasformazione CSS:
  // il browser ridisegna testo e formule alla scala reale.
  const commitView = useCallback(() => {
    const v = viewRef.current;
    committedRef.current = { ...v };
    viewportGroupRef.current?.setAttribute('transform', `translate(${v.x}, ${v.y}) scale(${v.k})`);
    applyView();
  }, [applyView]);

  // Allinea attributo e stato React (percentuale, ecc.) dopo che il gesto si è fermato.
  // Si chiama a ogni evento del gesto (fino a 240 Hz con Apple Pencil): invece di cancellare e
  // ricreare un timer ogni volta si sposta solo la scadenza, e il timer si riarma per il residuo.
  const scheduleSync = useCallback(() => {
    syncDueRef.current = performance.now() + SYNC_DELAY_MS;
    if (syncTimerRef.current !== undefined) return;
    // Mappa in movimento: le superfici di vetro sopra la mappa rinunciano al blur
    // (`:root[data-map-moving]` in theme.css), che WebKit ricalcolerebbe a ogni frame.
    document.documentElement.setAttribute(MAP_MOVING_ATTR, '');
    const run = () => {
      const wait = syncDueRef.current - performance.now();
      if (wait > 1) {
        syncTimerRef.current = window.setTimeout(run, wait);
        return;
      }
      syncTimerRef.current = undefined;
      document.documentElement.removeAttribute(MAP_MOVING_ATTR);
      commitView();
      setView({ ...viewRef.current });
    };
    syncTimerRef.current = window.setTimeout(run, SYNC_DELAY_MS);
  }, [commitView]);

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
    if (!layout || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return computeFitView(layout, rect.width, rect.height);
  }, [layout]);

  // Adattamento immediato (caricamento, ridimensionamento)
  const fitToView = useCallback(() => {
    const fit = computeFit();
    if (!fit) return;
    cancelMotion();
    viewRef.current = fit;
    commitView();
    setView(fit);
  }, [computeFit, cancelMotion, commitView]);

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

  // Tiene sotto osservazione canvas e barra del blocco (che si monta e smonta con la selezione):
  // le loro larghezze si rileggono solo quando cambiano davvero, non a ogni render o frame.
  // Dichiarato prima dell'effetto che chiama `applyView`, così una barra nuova si misura subito.
  useLayoutEffect(() => {
    const o = observedRef.current;
    const container = containerRef.current;
    const toolbar = toolbarRef.current;
    if (container === o.container && toolbar === o.toolbar) return;
    const ro = (o.ro ??= new ResizeObserver(() => {
      const w = widthsRef.current;
      w.container = containerRef.current?.clientWidth;
      w.toolbar = toolbarRef.current?.offsetWidth;
      applyView();
    }));
    if (container !== o.container) {
      if (o.container) ro.unobserve(o.container);
      if (container) ro.observe(container);
      o.container = container;
      widthsRef.current.container = undefined;
    }
    if (toolbar !== o.toolbar) {
      if (o.toolbar) ro.unobserve(o.toolbar);
      if (toolbar) ro.observe(toolbar);
      o.toolbar = toolbar;
      widthsRef.current.toolbar = undefined;
    }
  });
  useEffect(
    () => () => {
      document.documentElement.removeAttribute(MAP_MOVING_ATTR);
      const o = observedRef.current;
      o.ro?.disconnect();
      o.ro = null;
      o.container = null;
      o.toolbar = null;
    },
    []
  );

  // Dopo ogni render riapplica la vista viva (SVG appena montato, barra del nodo).
  // Un gruppo appena montato riparte dalla vista viva, senza differenza CSS. Non legge il layout
  // (larghezze in cache): durante i gesti costa solo qualche scrittura di style.
  useLayoutEffect(() => {
    const g = viewportGroupRef.current;
    if (g && !g.hasAttribute('transform')) commitView();
    else applyView();
  });

  return {
    containerRef,
    svgRef,
    viewportGroupRef,
    toolbarRef,
    editorLayerRef,
    selectedNodeRef,
    viewRef,
    view,
    setView,
    motionRef,
    frameRef,
    syncTimerRef,
    toWorld,
    applyView,
    commitView,
    scheduleSync,
    scheduleApply,
    cancelMotion,
    animateTo,
    fitToView,
    fitAnimated,
    zoomByButton,
  };
}

export type Viewport = ReturnType<typeof useViewport>;
