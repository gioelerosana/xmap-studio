import React from 'react';
import type { LayoutNode, LayoutRelationship, Point } from '@xmap/core';

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

/** Relazioni XMind (frecce fra blocchi) con maniglie per piegarle. Da renderizzare dentro l'SVG della mappa. */
export const RelationshipLayer: React.FC<RelationshipLayerProps> = ({ relationships }) => {
  return (
    <g>
      {relationships.map((rel) => (
        <path
          key={rel.id}
          d={rel.geometry.d}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={rel.style.lineWidth}
        />
      ))}
    </g>
  );
};
