import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '@xmap/core';
import { Plus, Minus, Maximize2, FileText, ChevronRight } from 'lucide-react';
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
  onToggleCollapse: (topicId: string) => void;
  resourceResolver: (src: string) => Uint8Array | null;
}

export const MapView: React.FC<MapViewProps> = ({
  layout,
  selectedTopicId,
  onSelectTopic,
  onOpenDetails,
  onToggleCollapse,
  resourceResolver,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Cache delle risorse come data URL: nessun ciclo di vita blob da gestire.
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

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.min(Math.max(z * factor, 0.2), 3));
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target as HTMLElement).tagName === 'svg') {
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

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-sm text-[var(--adw-muted-color)]">
        Nessun layout disponibile.
      </div>
    );
  }

  const accent = '#3b6cf6';

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopPan}
      onMouseLeave={stopPan}
      className="relative flex-1 h-full w-full overflow-hidden bg-[var(--adw-surface)] select-none cursor-grab active:cursor-grabbing"
    >
      <svg
        className="w-full h-full"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
      >
        <defs>
          <marker id="rel-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e5484d" opacity="0.85" />
          </marker>
        </defs>

        {/* Connettori gerarchici */}
        {layout.edges.map((edge, idx) => {
          const p = layout.nodes[edge.parent];
          const c = layout.nodes[edge.child];
          if (!p || !c) return null;
          const sx = p.x + p.w;
          const sy = p.y + p.h / 2;
          const ex = c.x;
          const ey = c.y + c.h / 2;
          const mid = (sx + ex) / 2;
          return (
            <path
              key={`edge-${idx}`}
              d={`M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ey}, ${ex} ${ey}`}
              fill="none"
              stroke={c.accent || '#c4c9d2'}
              strokeWidth={p.depth === 0 ? 2 : 1.5}
              strokeLinecap="round"
              opacity={0.9}
            />
          );
        })}

        {/* Relazioni */}
        {layout.relationships.map((rel) => {
          const from = layout.nodes[rel.from];
          const to = layout.nodes[rel.to];
          if (!from || !to) return null;
          const sx = from.x + from.w / 2;
          const sy = from.y + from.h / 2;
          const ex = to.x + to.w / 2;
          const ey = to.y + to.h / 2;
          const cx = (sx + ex) / 2 - (ey - sy) * 0.18;
          const cy = (sy + ey) / 2 + (ex - sx) * 0.18;
          return (
            <g key={`rel-${rel.id}`}>
              <path
                d={`M ${sx} ${sy} Q ${cx} ${cy}, ${ex} ${ey}`}
                fill="none"
                stroke="#e5484d"
                strokeWidth={1.6}
                strokeDasharray="5,4"
                markerEnd="url(#rel-arrow)"
                opacity={0.75}
              />
              {rel.title && (
                <text x={cx} y={cy - 4} fill="#e5484d" fontSize={10} textAnchor="middle" fontWeight={600}>
                  {rel.title}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodi */}
        {layout.nodes.map((node) => {
          const isSelected = node.id === selectedTopicId;
          const isRoot = node.depth === 0;
          const nodeAccent = node.accent || (isRoot ? accent : undefined);
          const boxed = node.depth <= 1 || Boolean(node.fill) || Boolean(node.imageSrc);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-pointer"
              onClick={() => onSelectTopic(node.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenDetails(node.id);
              }}
            >
              {node.imageSrc && resourceUrls.get(node.imageSrc) ? (
                <image
                  href={resourceUrls.get(node.imageSrc)}
                  x={0}
                  y={0}
                  width={node.w}
                  height={node.h}
                  preserveAspectRatio="xMidYMid meet"
                  // Le equazioni sono PNG nero; in tema scuro vanno tinti per la
                  // sola visualizzazione (il file resta invariato).
                  className={node.kind === 'equation' ? 'dark:invert' : undefined}
                />
              ) : (
                <rect
                  width={node.w}
                  height={node.h}
                  rx={8}
                  fill={node.fill || (isRoot ? 'var(--adw-accent-soft)' : 'var(--adw-card-bg)')}
                  stroke={isSelected ? accent : nodeAccent || 'var(--adw-card-border)'}
                  strokeWidth={isSelected ? 2 : 1.2}
                />
              )}
              {!node.imageSrc && (
                <foreignObject x={10} y={4} width={Math.max(node.w - 20, 10)} height={Math.max(node.h - 8, 10)}>
                  <div
                    className={cn(
                      'w-full h-full flex items-center gap-1.5 overflow-hidden',
                      isRoot ? 'text-[var(--adw-accent-color)]' : 'text-[var(--adw-fg-color)]'
                    )}
                  >
                    <span className={cn('truncate', isRoot ? 'text-[13px] font-semibold' : 'text-[12px]')}>
                      {node.title || '(senza titolo)'}
                    </span>
                    {node.hasNotes && <FileText className="w-3 h-3 opacity-40 shrink-0" />}
                  </div>
                </foreignObject>
              )}

              {node.childCount > 0 && (
                <g
                  transform={`translate(${node.w}, ${node.h / 2})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(node.id);
                  }}
                >
                  <circle r={6.5} fill={nodeAccent || accent} stroke="var(--adw-bg-color)" strokeWidth={1.5} />
                  {node.collapsed ? (
                    <path d="M -2 -3 L 2 0 L -2 3" fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round" />
                  ) : (
                    <path d="M -3 0 L 3 0" stroke="white" strokeWidth={1.5} strokeLinecap="round" />
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Controlli zoom */}
      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 p-1 rounded-lg bg-[var(--adw-card-bg)] border border-[var(--adw-card-border)] shadow-[var(--adw-shadow-md)]">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z * 0.85, 0.2))}
          className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--adw-muted-color)] hover:bg-[var(--adw-button-hover)] hover:text-[var(--adw-fg-color)]"
          title="Riduci zoom"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-medium px-1 min-w-[40px] text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z * 1.15, 3))}
          className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--adw-muted-color)] hover:bg-[var(--adw-button-hover)] hover:text-[var(--adw-fg-color)]"
          title="Aumenta zoom"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[var(--adw-hairline)] mx-0.5" />
        <button
          type="button"
          onClick={fitToView}
          className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--adw-muted-color)] hover:bg-[var(--adw-button-hover)] hover:text-[var(--adw-fg-color)]"
          title="Adatta allo schermo"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
