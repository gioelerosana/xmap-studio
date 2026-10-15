import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, renderLatexToSvg } from '@xmap/core';
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const hasAutoFitted = useRef(false);
  const lastLayoutRef = useRef<Layout | null>(null);

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

  // Calcolo e posizionamento completo fitToView
  const fitToView = useCallback(() => {
    if (!layout || !containerRef.current || layout.nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 10 || rect.height <= 10) return;

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

    if (minX === Infinity) return;

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const margin = 64;

    const scaleX = (rect.width - margin * 2) / Math.max(contentW, 100);
    const scaleY = (rect.height - margin * 2) / Math.max(contentH, 100);

    const safeZoom = Math.max(Math.min(scaleX, scaleY, 1.15), 0.12);
    setZoom(safeZoom);
    setPan({
      x: (rect.width - contentW * safeZoom) / 2 - minX * safeZoom,
      y: (rect.height - contentH * safeZoom) / 2 - minY * safeZoom,
    });
  }, [layout]);

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

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        setZoom((prevZoom) => {
          const newZoom = Math.min(Math.max(prevZoom * zoomFactor, 0.12), 3.5);
          const ratio = newZoom / prevZoom;
          setPan((p) => ({
            x: mouseX - (mouseX - p.x) * ratio,
            y: mouseY - (mouseY - p.y) * ratio,
          }));
          return newZoom;
        });
      }
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (
      e.button === 0 &&
      (e.target === containerRef.current ||
        (e.target as HTMLElement).tagName === 'svg' ||
        (e.target as HTMLElement).id === 'map-bg')
    ) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
  };

  const stopPan = () => setIsPanning(false);

  const selectedNode = useMemo(() => {
    if (!layout || !selectedTopicId) return null;
    return layout.nodes.find((n) => n.id === selectedTopicId) || null;
  }, [layout, selectedTopicId]);

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
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopPan}
      onMouseLeave={stopPan}
      className="relative flex-1 h-full w-full overflow-hidden bg-background select-none cursor-grab active:cursor-grabbing transition-colors duration-150"
    >
      {/* Controlli zoom flottanti in basso a destra */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer">
        <IconButton
          size="sm"
          variant="ghost"
          label="Riduci zoom"
          onClick={() => setZoom((z) => Math.max(z * 0.85, 0.12))}
        >
          <Minus className="size-4" />
        </IconButton>
        <span className="text-2xs font-mono tabular-nums text-muted-foreground min-w-[3rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label="Aumenta zoom"
          onClick={() => setZoom((z) => Math.min(z * 1.15, 3.5))}
        >
          <Plus className="size-4" />
        </IconButton>
        <Separator orientation="vertical" className="h-4 mx-0.5" />
        <IconButton size="sm" variant="ghost" label="Adatta alla finestra" onClick={fitToView}>
          <Maximize2 className="size-4" />
        </IconButton>
      </div>

      {/* Barra contestuale flottante sul nodo selezionato */}
      {selectedNode && (
        <div
          className="absolute z-20 pointer-events-auto flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer"
          style={{
            left: `${pan.x + selectedNode.x * zoom}px`,
            top: `${pan.y + (selectedNode.y - 42) * zoom}px`,
            transform: 'translateY(-100%)',
          }}
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
          questa classe a zoom < 1 la mappa verrebbe tagliata a una frazione del canvas. */}
      <svg
        className="w-full h-full overflow-visible"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
      >
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

        {/* Connettori gerarchici curvi */}
        {layout.edges.map((edge, idx) => {
          const p = layout.nodes[edge.parent];
          const c = layout.nodes[edge.child];
          if (!p || !c) return null;

          const startX = p.x + p.w;
          const startY = p.y + p.h / 2;
          const endX = c.x;
          const endY = c.y + c.h / 2;
          const deltaX = Math.abs(endX - startX) * 0.55;

          const pathD = `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`;

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
                onSelectTopic(node.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenDetails(node.id);
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

              {/* Indicatore comprimi / espandi sul bordo destro */}
              {hasChildren && (
                <g
                  transform={`translate(${node.w}, ${node.h / 2})`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(node.id);
                  }}
                >
                  <circle r={7} fill="var(--popover)" stroke="var(--input)" strokeWidth={1} />
                  {node.collapsed ? (
                    <path
                      d="M -2 -3 L 2 0 L -2 3"
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
      </svg>
    </div>
  );
};
