import { useEffect, useRef } from 'react';
import type { Layout, LayoutNode, Point } from '@xmap/core';
import { computeDropTargetIn, isDraggable, prepareDrop, subtreeOf, type DropContext, type DropTarget } from './dragTarget.js';
import type { ContextMenuState, DragIndexRef, DragOverlay, MapEditing, MapHandlers } from './types.js';
import type { Viewport } from './useViewport.js';
import { clampZoom, type View } from './viewport.js';

const PINCH_K = 0.01; // esponente di zoom per pixel di deltaY
const MAX_EXPONENT = 0.25; // tetto per evento (rotella a scatti con ctrl)
const LINE_PX = 16; // deltaMode LINE -> pixel
const VELOCITY_WINDOW_MS = 100;
const INERTIA_TAU_MS = 325;
const MIN_INERTIA_SPEED = 0.02; // px/ms
const TAP_SLOP_PX = { mouse: 3, touch: 8 }; // oltre questa distanza il gesto è un pan, non un tap
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_ZOOM = 1.6;
const DRAG_EDGE_ZONE = 48; // px dal bordo del canvas in cui il trascinamento fa scorrere la vista
const DRAG_EDGE_SPEED = 16; // px per frame al bordo estremo
const DRAG_DIM_OPACITY = '0.25';

/** `GestureEvent` di WebKit (pinch da trackpad in Safari/iPadOS): assente da lib.dom. */
interface SafariGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** Ref e setter di React letti dai gesti al momento dell'evento, senza ricreare i listener. */
export interface MapGestureUi {
  hasContent: boolean;
  layoutRef: { readonly current: Layout | null };
  dragIndexRef: { readonly current: DragIndexRef };
  handlers: { readonly current: MapHandlers };
  editingRef: { readonly current: MapEditing | null };
  selectedTopicIdRef: { readonly current: string | undefined };
  selectedTopicIdsRef: { readonly current: string[] | undefined };
  setContextMenu: (menu: ContextMenuState | null) => void;
  setSelectedRelationshipId: (id: string | undefined) => void;
  setDragOverlay: (overlay: DragOverlay | null) => void;
}

/**
 * Gesti sulla mappa: rotella e pinch del trackpad, pan e pinch con inerzia, tap e doppio tap,
 * pressione lunga e trascinamento dei blocchi.
 */
export function useMapGestures(viewport: Viewport, ui: MapGestureUi) {
  const { containerRef, svgRef, viewRef, motionRef, frameRef, syncTimerRef, cancelMotion, animateTo, applyView, scheduleApply, scheduleSync, toWorld } = viewport;
  const { hasContent, layoutRef, dragIndexRef, handlers, editingRef, selectedTopicIdRef, selectedTopicIdsRef, setContextMenu, setSelectedRelationshipId, setDragOverlay } = ui;
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  // Listener nativo non passivo: React registra `wheel` come passivo, e senza
  // preventDefault() il pinch del touchpad zooma l'intera pagina in Chromium.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setContextMenu(null);
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
    // Con touch/penna si trascina un blocco solo se era già selezionato; altrimenti il gesto è un pan.
    let pressedDraggable = true;
    let longPressTimer = 0;
    interface ActiveDrag {
      src: number;
      excluded: Set<number>;
      ids: string[];
      grab: Point;
      ptr: { x: number; y: number };
      raf: number;
      lastSig: string;
      /** Indice di `computeDropTargetIn`, costruito all'inizio del drag (rifatto se cambia il layout). */
      ctx: DropContext | null;
      /** Ultimo punto mondo valutato: se puntatore e vista sono fermi il frame non ricalcola nulla. */
      lastWorld: Point | null;
      lastLayout: Layout | null;
      /** Fantasma già montato da React: lo si sposta scrivendone il `transform`. */
      ghostEl: SVGGElement | null;
      /** Topic libero: si muove senza bersaglio di rilascio; `delta` è lo spostamento in coordinate mondo. */
      floating?: {
        delta: Point;
        /** Blocchi del sotto-albero e loro connettori nel DOM, cercati per il layout `elsLayout`. */
        els: { m: LayoutNode; node: Element | null; edge: SVGElement | null }[] | null;
        elsLayout: Layout | null;
      };
    }
    let drag: ActiveDrag | null = null;

    // Rettangolo del canvas letto all'inizio del gesto: pinch e pinch da trackpad lo usano a ogni
    // evento (fino a 240 Hz con la penna) senza interrogare il layout ogni volta.
    let gestureRect: DOMRect | null = null;
    const local = (x: number, y: number) => {
      const rect = gestureRect ?? container.getBoundingClientRect();
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

    // Coordinate mondo con un rettangolo del canvas già letto (una sola lettura per frame).
    const worldAt = (rect: DOMRect, x: number, y: number): Point => {
      const v = viewRef.current;
      return { x: (x - rect.left - v.x) / v.k, y: (y - rect.top - v.y) / v.k };
    };

    const dropAt = (d: ActiveDrag, wp: Point): DropTarget | null => {
      const l = layoutRef.current;
      const idx = dragIndexRef.current;
      if (!l || !idx) return null;
      if (!d.ctx || d.ctx.layout !== l || d.ctx.idx !== idx) d.ctx = prepareDrop(l, idx, d.src, d.excluded);
      return computeDropTargetIn(d.ctx, wp);
    };

    // Anteprima di un topic libero: sposta i blocchi del sotto-albero e i loro connettori.
    // Gli elementi si cercano una volta per drag (di nuovo solo se cambia il layout).
    const previewFloating = (d: ActiveDrag, wp: Point) => {
      const l = layoutRef.current;
      const svg = svgRef.current;
      if (!l || !svg || !d.floating) return;
      const n = l.nodes[d.src];
      const delta = { x: wp.x - d.grab.x - n.x, y: wp.y - d.grab.y - n.y };
      d.floating.delta = delta;
      let els = d.floating.els;
      if (!els || d.floating.elsLayout !== l || els.some((e) => e.node?.isConnected === false)) {
        d.floating.elsLayout = l;
        els = [...d.excluded].map((i) => {
          const m = l.nodes[i];
          const sel = CSS.escape(m.id);
          return {
            m,
            node: svg.querySelector(`[data-node-id="${sel}"]`),
            edge: svg.querySelector<SVGElement>(`[data-edge-child="${sel}"]`),
          };
        });
        d.floating.els = els;
      }
      for (const { m, node, edge } of els) {
        node?.setAttribute('transform', `translate(${m.x + delta.x}, ${m.y + delta.y})`);
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

    // Il bersaglio passa da React (render della MapView) solo quando cambia; tra un cambio e
    // l'altro il fantasma si sposta scrivendo direttamente il suo `transform`.
    const updateOverlay = (d: ActiveDrag, wp: Point) => {
      const l = layoutRef.current;
      if (!l) return;
      const drop = dropAt(d, wp);
      const ghost = { x: wp.x - d.grab.x, y: wp.y - d.grab.y };
      const ghostSig = `${ghost.x.toFixed(1)},${ghost.y.toFixed(1)}`;
      const sig = `${ghostSig}|${drop?.targetId}:${drop?.placement}`;
      if (sig === d.lastSig) return;
      const sameDrop = d.lastSig.slice(d.lastSig.indexOf('|')) === sig.slice(sig.indexOf('|'));
      d.lastSig = sig;
      if (d.ghostEl && !d.ghostEl.isConnected) d.ghostEl = null;
      d.ghostEl ??= svgRef.current?.querySelector<SVGGElement>('[data-drag-ghost]') ?? null;
      if (sameDrop && d.ghostEl) {
        d.ghostEl.setAttribute('transform', `translate(${ghost.x}, ${ghost.y})`);
        return;
      }
      setDragOverlay({ sourceId: l.nodes[d.src].id, ghost, drop });
    };

    // Ad ogni frame: scorrimento automatico vicino ai bordi e aggiornamento di fantasma/bersaglio.
    // Una sola lettura del rettangolo del canvas, prima di ogni scrittura (niente layout forzati);
    // con puntatore, vista e layout fermi il frame non ricalcola il bersaglio.
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
      const wp = worldAt(rect, d.ptr.x, d.ptr.y);
      const l = layoutRef.current;
      const still = d.lastWorld && d.lastWorld.x === wp.x && d.lastWorld.y === wp.y && d.lastLayout === l;
      if (!still) {
        d.lastWorld = wp;
        d.lastLayout = l;
        if (d.floating) previewFloating(d, wp);
        else updateOverlay(d, wp);
      }
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
        previewFloating(d, toWorld(d.ptr.x, d.ptr.y));
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
      const drop = commit ? dropAt(d, toWorld(d.ptr.x, d.ptr.y)) : null;
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
      drag = { src, excluded, ids, grab: { x: wp.x - n.x, y: wp.y - n.y }, ptr: { ...p }, raf: 0, lastSig: '', ctx: null, lastWorld: null, lastLayout: null, ghostEl: null };
      // Indice dei bersagli costruito subito, non al primo frame del trascinamento.
      const di = dragIndexRef.current;
      if (di) drag.ctx = prepareDrop(l, di, src, excluded);
      if (n.floating && n.floatOrigin && handlers.current.onMoveFloatingTopic) {
        drag.floating = { delta: { x: 0, y: 0 }, els: null, elsLayout: null };
      } else {
        setDim(ids, true);
      }
      window.addEventListener('keydown', onDragKey);
      if (pointerType !== 'mouse') navigator.vibrate?.(12);
      dragTick();
    };

    const beginPinch = () => {
      setContextMenu(null);
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
      setContextMenu(null);
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
      // In modalità selezione ogni tap alterna già la selezione (vedi `selectNode`): niente editing.
      if (nodeId && handlers.current.selectionMode) return;
      if (nodeId) {
        setSelectedRelationshipId(undefined);
        handlers.current.onSelectTopic(nodeId);
        const node = layoutRef.current?.nodes.find((n) => n.id === nodeId);
        if (node?.kind === 'text' && handlers.current.onStartEdit) {
          if (editingRef.current?.id !== nodeId) {
            handlers.current.onStartEdit(nodeId);
          }
        } else if (node?.kind === 'equation') {
          handlers.current.onOpenLatex(nodeId);
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
        window.clearTimeout(longPressTimer);
        if (pressedDraggable) {
          beginDrag();
          return;
        }
        pressedNode = -1;
        beginPan(start);
      } else if (mode === 'pinch' && pointers.size >= 2) {
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
      window.clearTimeout(longPressTimer);
      const now = performance.now();
      const v = viewRef.current;
      viewRef.current = { ...v, x: v.x + e.clientX - last.x, y: v.y + e.clientY - last.y };
      last = { x: e.clientX, y: e.clientY };
      samples.push({ t: now, x: viewRef.current.x, y: viewRef.current.y });
      // Campioni in ordine di tempo: si scartano in testa quelli fuori finestra, senza nuovi array.
      let old = 0;
      while (old < samples.length && now - samples[old].t > VELOCITY_WINDOW_MS) old++;
      if (old > 0) samples.splice(0, old);
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
      gestureRect = null;
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

      if (handlers.current.isConnectingRelationship) {
        if (nodeIdx >= 0) {
          const n = layoutRef.current?.nodes[nodeIdx];
          if (n) {
            handlers.current.onConnectRelationshipTarget?.(n.id);
          }
        }
        return;
      }

      if (pointers.size === 0) {
        gestureCleanupRef.current?.();
        pointerType = e.pointerType;
        moved = false;
        start = { x: e.clientX, y: e.clientY };
        gestureRect = container.getBoundingClientRect();
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
        const pressedId = layoutRef.current?.nodes[nodeIdx]?.id;
        pressedDraggable =
          e.pointerType === 'mouse' ||
          (pressedId !== undefined &&
            (pressedId === selectedTopicIdRef.current || (selectedTopicIdsRef.current ?? []).includes(pressedId)));
        last = { x: e.clientX, y: e.clientY };
        samples = [];
        // Touch: pressione lunga (~500 ms senza movimento) apre il menu contestuale
        if (e.pointerType !== 'mouse') {
          longPressTimer = window.setTimeout(() => {
            if (mode === 'nodepress') {
              mode = 'none';
              pressedNode = -1;
              const n = layoutRef.current?.nodes[nodeIdx];
              if (n) {
                navigator.vibrate?.(12);
                const currentMulti = selectedTopicIdsRef.current ?? [];
                if (!currentMulti.includes(n.id)) {
                  handlers.current.onSelectTopic(n.id);
                }
                setContextMenu({
                  x: start.x,
                  y: start.y,
                  target: { type: 'node', topicId: n.id },
                });
                suppressClickUntil = performance.now() + 400;
                // Senza i listener il rilascio non toglierebbe il dito da `pointers`: il tocco
                // successivo sembrerebbe un secondo dito e la mappa non risponderebbe più.
                pointers.clear();
                cleanup();
              }
            }
          }, 500);
        }
      } else {
        if (e.pointerType !== 'mouse') {
          longPressTimer = window.setTimeout(() => {
            if (mode === 'pan' && !moved) {
              mode = 'none';
              navigator.vibrate?.(12);
              setContextMenu({
                x: start.x,
                y: start.y,
                target: { type: 'background' },
              });
              suppressClickUntil = performance.now() + 400;
              pointers.clear();
              cleanup();
            }
          }, 500);
        }
        beginPan({ x: e.clientX, y: e.clientY });
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (handlers.current.isConnectingRelationship) return;
      if (mode === 'drag') return;

      const target = e.target as Element;
      const nodeEl = target.closest?.('[data-node-id]');
      const nodeId = nodeEl?.getAttribute('data-node-id');

      if (nodeId) {
        const currentMulti = selectedTopicIdsRef.current ?? [];
        if (!currentMulti.includes(nodeId)) {
          handlers.current.onSelectTopic(nodeId);
        }
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          target: { type: 'node', topicId: nodeId },
        });
      } else {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          target: { type: 'background' },
        });
      }
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
      if (gestureView) gestureRect = container.getBoundingClientRect();
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
      // Il rettangolo resta se nel frattempo è iniziato un gesto con i puntatori (lo azzera `cleanup`).
      if (gestureView && pointers.size === 0) gestureRect = null;
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
}
