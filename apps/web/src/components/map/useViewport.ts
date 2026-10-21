import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Layout, Point } from '@xmap/core';
import { clampZoom, computeFitView, type View } from './viewport.js';

const SYNC_DELAY_MS = 120;

/**
 * Pan e zoom della mappa. Durante i gesti si aggiorna solo `viewRef` e lo style dell'SVG;
 * lo stato React `view` viene allineato a gesto concluso.
 */
export function useViewport(layout: Layout | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorLayerRef = useRef<HTMLDivElement>(null);
  // Trasformazione "viva": durante i gesti si aggiorna solo questo ref e lo style
  // dell'SVG; `view` (stato React) viene allineato a gesto concluso.
  const viewRef = useRef<View>({ x: 60, y: 60, k: 1 });
  const [view, setView] = useState<View>(viewRef.current);
  // Punto mondo sopra cui sta la barra flottante (blocco o relazione selezionati); `centered` la centra su x.
  const toolbarAnchorRef = useRef<{ x: number; y: number; centered?: boolean } | null>(null);
  const frameRef = useRef(0);
  const syncTimerRef = useRef<number | undefined>(undefined);
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
    if (svgRef.current) {
      svgRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
    if (editorLayerRef.current) {
      editorLayerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
    const a = toolbarAnchorRef.current;
    if (toolbarRef.current && a) {
      // Su schermi stretti la barra resta dentro il canvas invece di uscire a destra.
      const width = toolbarRef.current.offsetWidth;
      const maxLeft = Math.max(8, (containerRef.current?.clientWidth ?? Infinity) - width - 8);
      const left = v.x + a.x * v.k - (a.centered ? width / 2 : 0);
      toolbarRef.current.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
      toolbarRef.current.style.top = `${v.y + (a.y - 42) * v.k}px`;
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

  // Dopo ogni render riapplica la vista viva (SVG appena montato, barra del nodo).
  useLayoutEffect(() => {
    applyView();
  });

  return {
    containerRef,
    svgRef,
    toolbarRef,
    editorLayerRef,
    toolbarAnchorRef,
    viewRef,
    view,
    setView,
    motionRef,
    frameRef,
    syncTimerRef,
    toWorld,
    applyView,
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
