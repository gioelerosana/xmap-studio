import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layout, renderLatexToSvg } from '@xmap/core';
import {
  Plus,
  Minus,
  Maximize2,
  FileText,
  Sparkles,
  Edit3,
  Trash2,
} from 'lucide-react';
import { cn } from '@xmap/ui-kit';

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

    const color = darkMode ? '#ffffff' : '#1e1e1e';
    for (const node of layout.nodes) {
      if (node.latex) {
        try {
          const res = renderLatexToSvg(node.latex, 16);
          if (!res.error && res.svg) {
            const coloredSvg = res.svg.replaceAll('currentColor', color);
            cache.set(node.id, coloredSvg);
          }
        } catch {}
      }
    }
    return cache;
  }, [layout, darkMode]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((z) => Math.min(Math.max(z * zoomFactor, 0.15), 3.5));
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).id === 'map-bg')) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
  };

  const stopPan = () => setIsPanning(false);

  const fitToView = () => {
    if (!layout || !containerRef.current || layout.nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const margin = 60;
    const z = Math.min(
      (rect.width - margin * 2) / Math.max(layout.width, 1),
      (rect.height - margin * 2) / Math.max(layout.height, 1),
      1.4
    );
    const safeZoom = Math.max(0.2, z);
    setZoom(safeZoom);
    setPan({
      x: (rect.width - layout.width * safeZoom) / 2,
      y: (rect.height - layout.height * safeZoom) / 2,
    });
  };

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.width, layout?.height]);

  const selectedNode = useMemo(() => {
    if (!layout || !selectedTopicId) return null;
    return layout.nodes.find((n) => n.id === selectedTopicId) || null;
  }, [layout, selectedTopicId]);

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center select-none text-[var(--adw-muted-color)] bg-[var(--adw-bg-color)]">
        <Sparkles className="w-8 h-8 text-[var(--adw-accent-color)] opacity-40 mb-2" />
        <p className="text-sm font-medium">Nessuna mappa da visualizzare.</p>
      </div>
    );
  }

  const defaultAccent = '#3584e4';

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopPan}
      onMouseLeave={stopPan}
      className="relative flex-1 h-full w-full overflow-hidden bg-[var(--adw-bg-color)] select-none cursor-grab active:cursor-grabbing transition-colors duration-150"
    >
      {/* Controlli Zoom Flottanti in basso a destra */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center space-x-1 p-1 rounded-xl bg-[var(--adw-card-bg)]/90 backdrop-blur-md border border-[var(--adw-card-border)] shadow-md">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z * 0.85, 0.2))}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--adw-fg-color)] transition-colors"
          title="Zoom Indietro"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-semibold px-1 min-w-[38px] text-center font-mono text-[var(--adw-fg-color)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z * 1.15, 3.0))}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--adw-fg-color)] transition-colors"
          title="Zoom Avanti"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-[1px] h-3.5 bg-[var(--adw-card-border)] mx-0.5" />
        <button
          type="button"
          onClick={fitToView}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--adw-accent-color)] transition-colors"
          title="Adatta alla finestra"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Barra Contestuale Flottante sul Nodo Selezionato */}
      {selectedNode && (
        <div
          className="absolute z-20 pointer-events-auto flex items-center space-x-1 p-1 rounded-xl bg-[var(--adw-card-bg)]/95 backdrop-blur-md border border-[var(--adw-card-border)] shadow-lg text-xs"
          style={{
            left: `${pan.x + selectedNode.x * zoom}px`,
            top: `${pan.y + (selectedNode.y - 42) * zoom}px`,
            transform: 'translateY(-100%)',
          }}
        >
          {onAddChild && (
            <button
              type="button"
              onClick={() => onAddChild(selectedNode.id)}
              className="flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--adw-fg-color)] transition-colors"
              title="Aggiungi sotto-blocco"
            >
              <Plus className="w-3.5 h-3.5 text-[var(--adw-accent-color)]" />
              <span className="text-[11px] font-medium">Sotto-blocco</span>
            </button>
          )}
          {onOpenLatex && (
            <button
              type="button"
              onClick={() => onOpenLatex(selectedNode.id)}
              className="flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--adw-fg-color)] transition-colors"
              title="Modifica formula LaTeX"
            >
              <Sparkles className="w-3.5 h-3.5 text-[var(--adw-accent-color)]" />
              <span className="text-[11px] font-medium">Formula</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenDetails(selectedNode.id)}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--adw-fg-color)] transition-colors"
            title="Apri pannello dettagli"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">Dettagli</span>
          </button>
          {selectedNode.depth > 0 && onDeleteTopic && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Eliminare questo blocco?')) {
                  onDeleteTopic(selectedNode.id);
                }
              }}
              className="p-1 rounded-lg hover:bg-[var(--adw-destructive-color)]/15 text-[var(--adw-destructive-color)] transition-colors ml-0.5"
              title="Elimina blocco"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Canvas SVG Principale */}
      <svg
        className="w-full h-full"
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
            <circle
              cx="2"
              cy="2"
              r="1"
              fill={darkMode ? '#ffffff' : '#000000'}
              opacity={darkMode ? 0.12 : 0.08}
            />
          </pattern>

          <marker id="rel-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e01b24" opacity="0.85" />
          </marker>
        </defs>

        <rect
          id="map-bg"
          x={-5000}
          y={-5000}
          width={15000}
          height={15000}
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
          const strokeColor = c.accent || (c.depth === 1 ? '#3584e4' : darkMode ? '#5a5d64' : '#c4c9d2');

          return (
            <path
              key={`edge-${idx}`}
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth={p.depth === 0 ? 2.5 : 1.8}
              strokeLinecap="round"
              opacity={0.85}
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

          return (
            <g key={`rel-${rel.id}`}>
              <path
                d={`M ${sx} ${sy} Q ${cx} ${cy}, ${ex} ${ey}`}
                fill="none"
                stroke="#e01b24"
                strokeWidth={1.8}
                strokeDasharray="5,4"
                markerEnd="url(#rel-arrow)"
                opacity={0.75}
              />
              {rel.title && (
                <text x={cx} y={cy - 6} fill="#e01b24" fontSize={10} textAnchor="middle" fontWeight={600}>
                  {rel.title}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodi della Mappa */}
        {layout.nodes.map((node) => {
          const isSelected = node.id === selectedTopicId;
          const isRoot = node.depth === 0;
          const nodeAccent = node.accent || (isRoot ? defaultAccent : undefined);
          const hasChildren = node.childCount > 0;
          const formulaSvg = formulaSvgCache.get(node.id);
          const hasImage = Boolean(node.imageSrc && resourceUrls.has(node.imageSrc));

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
              {/* Bordo di selezione luminoso */}
              {isSelected && (
                <rect
                  x={-3}
                  y={-3}
                  width={node.w + 6}
                  height={node.h + 6}
                  rx={isRoot ? 15 : 11}
                  fill="none"
                  stroke="var(--adw-accent-color)"
                  strokeWidth={2.5}
                  opacity={0.9}
                />
              )}

              {/* Rettangolo Base della Card del Nodo */}
              <rect
                width={node.w}
                height={node.h}
                rx={isRoot ? 12 : 8}
                fill={
                  node.fill ||
                  (isRoot
                    ? 'var(--adw-accent-soft)'
                    : darkMode
                    ? '#2b2b2b'
                    : '#ffffff')
                }
                stroke={
                  isSelected
                    ? 'var(--adw-accent-color)'
                    : nodeAccent || 'var(--adw-card-border)'
                }
                strokeWidth={isSelected ? 2 : nodeAccent ? 1.8 : 1}
                filter="drop-shadow(0 2px 4px rgba(0,0,0,0.06))"
              />

              {/* Strip Accent Color a Sinistra */}
              {!isRoot && nodeAccent && (
                <path
                  d={`M 0 8 Q 0 0 8 0 L 8 ${node.h} Q 0 ${node.h} 0 ${node.h - 8} Z`}
                  fill={nodeAccent}
                />
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
                  className={node.kind === 'equation' ? 'dark:invert' : undefined}
                />
              )}

              {/* Contenuto del Nodo: Formula SVG o Testo */}
              {!hasImage && (
                <foreignObject
                  x={isRoot ? 12 : nodeAccent ? 14 : 10}
                  y={4}
                  width={node.w - (isRoot ? 24 : nodeAccent ? 22 : 18)}
                  height={node.h - 8}
                >
                  <div
                    className={cn(
                      'w-full h-full flex flex-col justify-center select-none overflow-hidden',
                      isRoot ? 'text-[var(--adw-accent-color)]' : 'text-[var(--adw-fg-color)]'
                    )}
                  >
                    <div className="flex items-center space-x-1.5 overflow-hidden">
                      {formulaSvg ? (
                        <div
                          className="flex items-center max-w-full overflow-hidden shrink-0"
                          dangerouslySetInnerHTML={{ __html: formulaSvg }}
                        />
                      ) : (
                        <span
                          className={cn(
                            'truncate',
                            isRoot ? 'text-sm font-bold tracking-tight' : 'text-xs font-semibold'
                          )}
                        >
                          {node.displayTitle || node.title || '(senza titolo)'}
                        </span>
                      )}

                      {node.hasNotes && (
                        <FileText
                          className={cn(
                            'w-3 h-3 shrink-0',
                            isRoot ? 'opacity-80' : 'opacity-50'
                          )}
                        />
                      )}
                    </div>

                    {/* Riga Inferiore: Etichette e Marker */}
                    {(node.labels.length > 0 || node.markers.length > 0) && (
                      <div className="flex items-center space-x-1 mt-0.5 overflow-hidden">
                        {node.markers.map((m) => {
                          const isPriority = m.startsWith('priority-');
                          const pNum = isPriority ? m.replace('priority-', '') : null;
                          return (
                            <span
                              key={m}
                              className="inline-flex items-center justify-center px-1 rounded text-[9px] font-bold bg-black/10 dark:bg-white/15"
                              title={m}
                            >
                              {pNum ? `P${pNum}` : m.slice(0, 4)}
                            </span>
                          );
                        })}
                        {node.labels.map((lbl) => (
                          <span
                            key={lbl}
                            className="px-1.5 py-0.2 rounded-full text-[9px] bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)] truncate max-w-[60px]"
                          >
                            {lbl}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </foreignObject>
              )}

              {/* Indicatore Comprimi / Espandi sul bordo destro */}
              {hasChildren && (
                <g
                  transform={`translate(${node.w}, ${node.h / 2})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(node.id);
                  }}
                >
                  <circle
                    r={7}
                    fill={nodeAccent || defaultAccent}
                    stroke="var(--adw-bg-color)"
                    strokeWidth={1.5}
                  />
                  {node.collapsed ? (
                    <path
                      d="M -2.5 -3 L 2 0 L -2.5 3"
                      fill="none"
                      stroke="white"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  ) : (
                    <path d="M -3 0 L 3 0" stroke="white" strokeWidth={1.5} strokeLinecap="round" />
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
