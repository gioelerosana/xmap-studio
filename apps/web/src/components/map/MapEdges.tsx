import { memo, useMemo } from 'react';
import type { Layout } from '@xmap/core';
import { computeTrunks, edgePathD, summaryPathD } from './geometry.js';

/** Tronchi, connettori e graffe dei sommari: disegnati sotto i blocchi. */
function MapEdgesView({ layout: l }: { layout: Layout }) {
  const trunks = useMemo(() => computeTrunks(l), [l]);
  return (
    <>
      {/* Tronchi condivisi della Tree Chart: uno per genitore, in colore neutro */}
      {trunks.map((t) => (
        <path
          key={`trunk-${t.parent}`}
          d={`M ${t.x} ${t.y1} L ${t.x} ${t.y2}`}
          fill="none"
          stroke={l.nodes[t.parent]?.accent || 'var(--map-link)'}
          strokeWidth={l.nodes[t.parent]?.branchLineWidth ?? 2}
          strokeLinecap="round"
        />
      ))}

      {/* Connettori gerarchici */}
      {l.edges.map((edge, idx) => {
        const p = l.nodes[edge.parent];
        const c = l.nodes[edge.child];
        if (!p || !c) return null;
        return (
          <path
            key={`edge-${idx}`}
            data-edge-child={c.id}
            d={edgePathD(edge, p, c)}
            fill="none"
            stroke={c.accent || 'var(--map-link)'}
            strokeWidth={p.branchLineWidth ?? (c.depth <= 1 ? 3 : 2)}
            strokeLinecap="round"
          />
        );
      })}

      {/* Sommari: graffa di chiusura "}" e raccordo verso il blocco */}
      {l.summaries.map((s, idx) => {
        const t = l.nodes[s.topic];
        if (!t) return null;
        return (
          <path
            key={`summary-${idx}`}
            d={summaryPathD(s, t)}
            fill="none"
            stroke={s.accent || 'var(--map-link)'}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </>
  );
}

// Dipende solo dal layout: un cambio di selezione non ridisegna tutti i connettori.
export const MapEdges = memo(MapEdgesView);
