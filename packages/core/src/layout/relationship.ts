/**
 * Geometria delle relazioni, fedele alle forme di XMind
 * (curved, straight, angled, zigzag). Funzioni pure.
 */
import type { Point, RelationshipStyle } from '../state/types.js';
import type { RelationshipGeometry } from './types.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function relationshipGeometry(
  from: Rect,
  to: Rect,
  _style: RelationshipStyle,
  _controlPoints?: [Point | undefined, Point | undefined]
): RelationshipGeometry {
  // TODO(core-rel): stub provvisorio a linea retta tra i centri.
  const start = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const end = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return {
    d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    start,
    end,
    handles: [start, end],
    startAngle: angle + Math.PI,
    endAngle: angle,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

/**
 * Inverso delle maniglie: dalla posizione mondo della maniglia `index` al
 * punto di controllo da salvare (relativo al centro del blocco di estremità).
 */
export function handleToControlPoint(index: 0 | 1, world: Point, from: Rect, to: Rect): Point {
  const r = index === 0 ? from : to;
  return { x: world.x - (r.x + r.w / 2), y: world.y - (r.y + r.h / 2) }; // TODO(core-rel)
}
