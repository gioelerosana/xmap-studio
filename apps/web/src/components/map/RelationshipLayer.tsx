import React, { useCallback, useRef, useState } from 'react';
import { handleToControlPoint, relationshipGeometry } from '@xmap/core';
import type { LayoutNode, LayoutRelationship, Point, RelationshipGeometry } from '@xmap/core';
import { arrowPath, dashArray, resolveLineColor } from './arrows';

export interface RelationshipLayerProps {
  relationships: LayoutRelationship[];
  nodes: LayoutNode[];
  selectedRelationshipId?: string;
  onSelectRelationship?: (relationshipId: string | undefined) => void;
  /** Punto di controllo da salvare (già relativo al blocco, `handleToControlPoint`); `null` = ripristina. */
  onControlPointChange?: (relationshipId: string, index: 0 | 1, point: Point | null) => void;
  /** Coordinate client del puntatore → coordinate mondo della mappa. */
  toWorld: (clientX: number, clientY: number) => Point;
  darkMode?: boolean;
}

type ControlPoints = [Point | undefined, Point | undefined];

interface DragState {
  id: string;
  index: 0 | 1;
  controlPoints: ControlPoints;
  geometry: RelationshipGeometry;
}

/** Impedisce che il canvas interpreti il gesto come pan/deselezione. */
const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

const isCoarse = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** Relazioni XMind (frecce fra blocchi) con maniglie per piegarle. Da renderizzare dentro l'SVG della mappa. */
export const RelationshipLayer: React.FC<RelationshipLayerProps> = ({
  relationships,
  nodes,
  selectedRelationshipId,
  onSelectRelationship,
  onControlPointChange,
  toWorld,
  darkMode,
}) => {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Ultimo valore del trascinamento, letto al rilascio senza dipendere dal render.
  const dragRef = useRef<DragState | null>(null);
  const [coarse] = useState(isCoarse);

  const compute = useCallback(
    (rel: LayoutRelationship, index: 0 | 1, world: Point): DragState | null => {
      const from = nodes[rel.from];
      const to = nodes[rel.to];
      if (!from || !to) return null;
      const other = (index === 0 ? 1 : 0) as 0 | 1;
      const cps: ControlPoints = [undefined, undefined];
      cps[index] = handleToControlPoint(index, world, from, to);
      cps[other] =
        rel.controlPoints?.[other] ?? handleToControlPoint(other, rel.geometry.handles[other], from, to);
      return { id: rel.id, index, controlPoints: cps, geometry: relationshipGeometry(from, to, rel.style, cps) };
    },
    [nodes]
  );

  const handleR = coarse ? 11 : 6;

  return (
    <g>
      {relationships.map((rel) => {
        if (!nodes[rel.from] || !nodes[rel.to]) return null;
        const dragging = drag?.id === rel.id ? drag : null;
        const geo = dragging ? dragging.geometry : rel.geometry;
        const selected = rel.id === selectedRelationshipId;
        const { style } = rel;
        const color = selected ? 'var(--primary)' : resolveLineColor(style.lineColor, darkMode);
        const select = (e: React.SyntheticEvent): void => {
          e.stopPropagation();
          onSelectRelationship?.(rel.id);
        };
        const beginArrow = arrowPath(style.arrowBegin, geo.start.x, geo.start.y, geo.startAngle, style.lineWidth);
        const endArrow = arrowPath(style.arrowEnd, geo.end.x, geo.end.y, geo.endAngle, style.lineWidth);
        const ends = [geo.start, geo.end];
        const labelW = rel.title ? rel.title.length * 6 + 14 : 0;

        return (
          <g key={`rel-${rel.id}`}>
            <path
              d={geo.d}
              fill="none"
              stroke={color}
              strokeWidth={selected ? style.lineWidth + 0.5 : style.lineWidth}
              strokeDasharray={dashArray(style.linePattern, style.lineWidth)}
              strokeLinejoin="round"
              pointerEvents="none"
            />
            {beginArrow && <path d={beginArrow} fill={color} stroke={color} strokeLinejoin="round" pointerEvents="none" />}
            {endArrow && <path d={endArrow} fill={color} stroke={color} strokeLinejoin="round" pointerEvents="none" />}

            {rel.title && (
              <g onPointerDown={stop} onClick={select} style={{ cursor: 'pointer' }}>
                <rect
                  x={geo.label.x - labelW / 2}
                  y={geo.label.y - 8}
                  width={labelW}
                  height={16}
                  rx={6}
                  fill="var(--background)"
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={geo.label.x}
                  y={geo.label.y}
                  fill="var(--muted-foreground)"
                  className="text-2xs font-medium"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {rel.title}
                </text>
              </g>
            )}

            {/* Area di click invisibile e più larga della linea */}
            <path
              d={geo.d}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(12, style.lineWidth + 8)}
              strokeLinecap="round"
              pointerEvents="stroke"
              style={{ cursor: 'pointer' }}
              onPointerDown={stop}
              onClick={select}
            />

            {selected &&
              ([0, 1] as const).map((i) => {
                const h = geo.handles[i];
                const end = ends[i];
                return (
                  <g key={`h-${i}`}>
                    <line
                      x1={end.x}
                      y1={end.y}
                      x2={h.x}
                      y2={h.y}
                      stroke="var(--primary)"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      pointerEvents="none"
                    />
                    <circle
                      cx={h.x}
                      cy={h.y}
                      r={handleR}
                      fill="var(--background)"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      style={{ cursor: 'grab', touchAction: 'none' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        // Nessun calcolo qui: un semplice tocco non deve fissare il punto.
                        dragRef.current = null;
                      }}
                      onPointerMove={(e) => {
                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        e.stopPropagation();
                        const s = compute(rel, i, toWorld(e.clientX, e.clientY));
                        dragRef.current = s;
                        setDrag(s);
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                        const s = dragRef.current;
                        dragRef.current = null;
                        setDrag(null);
                        const p = s?.controlPoints[i];
                        if (s && p && s.id === rel.id && s.index === i) onControlPointChange?.(rel.id, i, p);
                      }}
                      onPointerCancel={() => {
                        dragRef.current = null;
                        setDrag(null);
                      }}
                      onClick={stop}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        dragRef.current = null;
                        setDrag(null);
                        onControlPointChange?.(rel.id, i, null);
                      }}
                    />
                  </g>
                );
              })}
          </g>
        );
      })}
    </g>
  );
};
