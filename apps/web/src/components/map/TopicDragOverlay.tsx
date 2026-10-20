import type { Layout } from '@xmap/core';
import { nodeLook } from './nodeLook.js';
import { textStyleCss } from './RichTitle.js';
import type { DragOverlay } from './types.js';

/** Fantasma del blocco trascinato e indicatore del bersaglio, sopra tutto il resto della mappa. */
export function TopicDragOverlay({
  dragOverlay,
  layout,
  darkMode,
}: {
  dragOverlay: DragOverlay | null;
  layout: Layout | null;
  darkMode: boolean;
}) {
  if (!dragOverlay || !layout) return null;
  const src = layout.nodes.find((n) => n.id === dragOverlay.sourceId);
  if (!src) return null;
  const look = nodeLook(src, darkMode);
  const { ghost, drop } = dragOverlay;
  const target = drop ? layout.nodes[drop.targetIndex] : undefined;
  const ind = drop?.indicator;
  return (
    <g pointerEvents="none">
      {target && drop && (
        <rect
          x={target.x - 3}
          y={target.y - 3}
          width={target.w + 6}
          height={target.h + 6}
          rx={13}
          fill={drop.placement === 'into' ? 'color-mix(in oklab, var(--primary) 14%, transparent)' : 'none'}
          stroke="var(--primary)"
          strokeWidth={drop.placement === 'into' ? 2 : 1}
          strokeOpacity={drop.placement === 'into' ? 1 : 0.45}
        />
      )}
      {ind?.kind === 'line' && (
        <g stroke="var(--primary)" fill="var(--primary)">
          <line x1={ind.x1} x2={ind.x2} y1={ind.y} y2={ind.y} strokeWidth={3} strokeLinecap="round" />
          <circle cx={ind.x1} cy={ind.y} r={4} stroke="none" />
        </g>
      )}
      {ind?.kind === 'child' && (
        <g stroke="var(--primary)" fill="none">
          <path
            d={`M ${ind.from.x} ${ind.from.y} C ${ind.from.x + 28} ${ind.from.y}, ${ind.to.x - 28} ${ind.to.y}, ${ind.to.x} ${ind.to.y}`}
            strokeWidth={2.5}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
          <rect
            x={ind.to.x}
            y={ind.to.y - ind.h / 2}
            width={ind.w}
            height={ind.h}
            rx={10}
            strokeWidth={1.5}
            strokeDasharray="5 3"
            fill="color-mix(in oklab, var(--primary) 10%, transparent)"
          />
        </g>
      )}
      <g transform={`translate(${ghost.x}, ${ghost.y})`} opacity={0.75}>
        <rect
          width={src.w}
          height={src.h}
          rx={10}
          fill={look.fill}
          stroke={look.stroke}
          strokeWidth={1}
          style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.3))' }}
        />
        <foreignObject x={10} y={4} width={Math.max(src.w - 18, 10)} height={Math.max(src.h - 8, 10)}>
          <div
            className="flex h-full w-full items-center overflow-hidden text-xs leading-snug"
            style={{ color: look.text }}
          >
            <span className="line-clamp-3 break-words" style={textStyleCss(src.textStyle)}>
              {src.latex ? src.latex : src.displayTitle || src.title || '(senza titolo)'}
            </span>
          </div>
        </foreignObject>
      </g>
    </g>
  );
}
