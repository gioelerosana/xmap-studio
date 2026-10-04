import React, { useState, useRef, useEffect } from 'react';
import { Layout, LayoutNode, TopicView } from '@xmap/core';
import { Plus, Minus, Maximize2, Sparkles, FileText, ChevronRight } from 'lucide-react';

export interface MapViewProps {
  layout: Layout | null;
  selectedTopicId?: string;
  onSelectTopic: (topicId: string) => void;
  onOpenDetails: (topicId: string) => void;
  onOpenLatex: (topicId: string) => void;
  onAddChild: (topicId: string) => void;
  onToggleCollapse: (topicId: string) => void;
  resourceResolver: (src: string) => Uint8Array | null;
}

export const MapView: React.FC<MapViewProps> = ({
  layout,
  selectedTopicId,
  onSelectTopic,
  onOpenDetails,
  onOpenLatex,
  onAddChild,
  onToggleCollapse,
  resourceResolver,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Gestione rotellina per zoom e pan
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.min(Math.max(z * zoomFactor, 0.2), 3.0));
    } else {
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY,
      }));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target as HTMLElement).tagName === 'svg') {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 60, y: 60 });
  };

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm opacity-50 select-none">
        Nessun layout disponibile.
      </div>
    );
  }

  // Prepara l'URL per le immagini dei nodi
  const getResourceUrl = (src?: string): string | undefined => {
    if (!src) return undefined;
    const bytes = resourceResolver(src);
    if (!bytes) return undefined;
    const blob = new Blob([bytes as any], { type: 'image/png' });
    return URL.createObjectURL(blob);
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative flex-1 h-full w-full overflow-hidden bg-adw-bg select-none cursor-grab active:cursor-grabbing"
    >
      {/* Controlli Zoom Flottanti */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center space-x-1.5 p-1.5 rounded-2xl bg-adw-card/90 backdrop-blur-md border border-adw-cardBorder shadow-lg">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z * 0.85, 0.2))}
          className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10"
          title="Zoom Indietro"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold px-1 min-w-[42px] text-center font-mono">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z * 1.15, 3.0))}
          className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10"
          title="Zoom Avanti"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-adw-accent"
          title="Ripristina Vista"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* SVG Canvas Principale */}
      <svg
        className="w-full h-full"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <defs>
          <marker
            id="rel-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e01b24" opacity="0.8" />
          </marker>
        </defs>

        {/* 1. Tracciamento Connettori Gerarchici tra Nodi */}
        {layout.edges.map((edge, idx) => {
          const p = layout.nodes[edge.parent];
          const c = layout.nodes[edge.child];
          if (!p || !c) return null;

          const startX = p.x + p.w;
          const startY = p.y + p.h / 2;
          const endX = c.x;
          const endY = c.y + c.h / 2;
          const midX = (startX + endX) / 2;

          const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
          const strokeColor = c.accent || '#3584e4';

          return (
            <path
              key={`edge-${idx}`}
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth={p.depth === 0 ? 2.5 : 2}
              strokeLinecap="round"
              opacity={0.8}
            />
          );
        })}

        {/* 2. Tracciamento Relazioni Arbitrarie tra Nodi (Relationship) */}
        {layout.relationships.map((rel) => {
          const fromNode = layout.nodes[rel.from];
          const toNode = layout.nodes[rel.to];
          if (!fromNode || !toNode) return null;

          const startX = fromNode.x + fromNode.w / 2;
          const startY = fromNode.y + fromNode.h / 2;
          const endX = toNode.x + toNode.w / 2;
          const endY = toNode.y + toNode.h / 2;

          const dx = endX - startX;
          const dy = endY - startY;
          const cx = (startX + endX) / 2 - dy * 0.2;
          const cy = (startY + endY) / 2 + dx * 0.2;

          return (
            <g key={`rel-${rel.id}`}>
              <path
                d={`M ${startX} ${startY} Q ${cx} ${cy}, ${endX} ${endY}`}
                fill="none"
                stroke="#e01b24"
                strokeWidth={1.8}
                strokeDasharray="5,5"
                markerEnd="url(#rel-arrow)"
                opacity={0.7}
              />
              {rel.title && (
                <text
                  x={cx}
                  y={cy - 4}
                  fill="#e01b24"
                  fontSize={10}
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  {rel.title}
                </text>
              )}
            </g>
          );
        })}

        {/* 3. Rendering dei Nodi del Layout */}
        {layout.nodes.map((node) => {
          const isSelected = node.id === selectedTopicId;
          const accent = node.accent || (node.depth === 0 ? '#3584e4' : undefined);
          const hasChildren = node.childCount > 0;

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
              {/* Box del Nodo */}
              <rect
                width={node.w}
                height={node.h}
                rx={node.depth === 0 ? 12 : 8}
                className="transition-all"
                fill={node.fill || (node.depth === 0 ? '#3584e4' : 'var(--adw-card-bg)')}
                stroke={
                  isSelected
                    ? '#3584e4'
                    : accent || 'var(--adw-card-border)'
                }
                strokeWidth={isSelected ? 2.5 : accent ? 1.8 : 1}
                filter="drop-shadow(0 2px 6px rgba(0,0,0,0.06))"
              />

              {/* Contenuto del Nodo: Titolo o Immagine Formula LaTeX */}
              <foreignObject x={8} y={4} width={node.w - 16} height={node.h - 8}>
                <div
                  className={`w-full h-full flex items-center space-x-2 truncate select-none ${
                    node.depth === 0 ? 'text-white font-bold' : 'text-adw-fg'
                  }`}
                >
                  {node.latex ? (
                    <div className="flex items-center space-x-1.5 overflow-hidden">
                      <Sparkles className="w-3.5 h-3.5 text-adw-accent shrink-0" />
                      <span className="font-mono text-xs truncate">
                        ${node.latex}$
                      </span>
                    </div>
                  ) : (
                    <span
                      className={`truncate ${
                        node.depth === 0 ? 'text-sm font-bold' : 'text-xs font-medium'
                      }`}
                    >
                      {node.title || '(senza titolo)'}
                    </span>
                  )}

                  {node.hasNotes && (
                    <FileText className="w-3 h-3 opacity-50 shrink-0" />
                  )}
                </div>
              </foreignObject>

              {/* Indicatore Comprimi / Espandi sul bordo destro */}
              {hasChildren && (
                <g
                  transform={`translate(${node.w}, ${node.h / 2})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(node.id);
                  }}
                  className="hover:scale-125 transition-transform"
                >
                  <circle
                    r={7}
                    fill={accent || '#3584e4'}
                    stroke="white"
                    strokeWidth={1.5}
                  />
                  {node.collapsed ? (
                    <path
                      d="M -2 -3 L 2 0 L -2 3"
                      fill="none"
                      stroke="white"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  ) : (
                    <circle r={2} fill="white" />
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
