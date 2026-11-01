import React from 'react';
import { BOUNDARY_TITLE_BAND, type BoundaryFrame } from '@xmap/core';

/** Rientro del titolo dal bordo sinistro della cornice. */
const TITLE_INSET_X = 10;
/** Distanza della base del titolo dalla fascia superiore: il testo sta dentro la fascia riservata. */
const TITLE_BASELINE_OFFSET = 5;
const TITLE_FONT_PX = 12;
const CORNER_RADIUS = 10;
const BORDER_WIDTH = 1.5;
const BORDER_DASH = '6 4';

interface BoundaryLayerProps {
  boundaries: readonly BoundaryFrame[];
}

/**
 * Cornici XMind disegnate sotto i blocchi. Non intercettano il puntatore: pan,
 * clic e trascinamento passano alla mappa come se la cornice non ci fosse.
 */
export const BoundaryLayer: React.FC<BoundaryLayerProps> = ({ boundaries }) => (
  <g data-boundary-layer pointerEvents="none">
    {boundaries.map((frame) => (
      <BoundaryShape key={`${frame.topicId}:${frame.id}`} frame={frame} />
    ))}
  </g>
);

/** Colore di bordo e titolo: quello dichiarato dal file, poi il ramo, poi il neutro della mappa. */
const outlineColor = (frame: BoundaryFrame): string => frame.lineColor ?? frame.accent ?? 'var(--map-link)';

const BoundaryShape: React.FC<{ frame: BoundaryFrame }> = ({ frame }) => {
  const line = outlineColor(frame);
  const fill = frame.fillColor ?? line;
  return (
    <g>
      <rect
        x={frame.x}
        y={frame.y}
        width={frame.w}
        height={frame.h}
        rx={CORNER_RADIUS}
        fill={`color-mix(in oklab, ${fill} var(--map-tint), transparent)`}
        stroke={`color-mix(in oklab, ${line} 70%, transparent)`}
        strokeWidth={BORDER_WIDTH}
        strokeDasharray={BORDER_DASH}
      />
      {frame.title && (
        <text
          x={frame.x + TITLE_INSET_X}
          y={frame.y + BOUNDARY_TITLE_BAND - TITLE_BASELINE_OFFSET}
          fontSize={TITLE_FONT_PX}
          fontWeight={600}
          fill={line}
        >
          {frame.title}
        </text>
      )}
    </g>
  );
};
