/**
 * Geometria delle relazioni, fedele alle forme di XMind
 * (curved, straight, angled, zigzag). Funzioni pure.
 *
 * Ricostruita dal router del bundle XMind 26.03:
 * - i punti di controllo sono offset dal centro del blocco di estremità;
 * - l'estremità della linea è il punto del bordo del blocco nella direzione
 *   del punto di controllo (o del centro dell'altro blocco, se manca);
 * - curved = cubica `M S C cp1 cp2 T`; angled = poligonale `S cp1 cp2 T`;
 *   straight = segmento `S T`; zigzag = `S -> (x, S.y) -> (x, T.y) -> T` (o
 *   specchiato in verticale) con il tratto centrale alla media dei due punti
 *   di controllo, tenuto ad almeno 10 px dai due bordi;
 * - senza punti di controllo: se i blocchi sono quasi allineati in verticale
 *   (scarto < 80) escono dallo stesso lato con un'ansa orizzontale, se distano
 *   80..300 in orizzontale escono dall'alto; altrimenti il default è un
 *   punto a 30 gradi e 0.33 della distanza tra le estremità.
 * Non si usa `lineEndPoints` del file: il contratto non lo porta e, in
 * assenza, XMind deriva lo stesso attacco dal punto di controllo.
 */
import type { Point, RelationshipShape, RelationshipStyle } from '../state/types.js';
import type { RelationshipGeometry } from './types.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Cps = [Point | undefined, Point | undefined];

const MIN_CP_DISTANCE = 10;
const ZIGZAG_CLEARANCE = 10;
const DEFAULT_ANGLE = (30 * Math.PI) / 180;
const DEFAULT_AMOUNT = 0.33;
const EPS = 1e-7;

function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function len(a: Point): number {
  return Math.hypot(a.x, a.y);
}

function rotate(v: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Punto del bordo di `r` sulla semiretta dal centro verso `target`. */
function borderToward(r: Rect, target: Point): Point {
  const c = center(r);
  const d = sub(target, c);
  if (len(d) < EPS) return { x: c.x + r.w / 2, y: c.y };
  const tx = Math.abs(d.x) < EPS ? Infinity : r.w / 2 / Math.abs(d.x);
  const ty = Math.abs(d.y) < EPS ? Infinity : r.h / 2 / Math.abs(d.y);
  const t = Math.min(tx, ty);
  return { x: c.x + d.x * t, y: c.y + d.y * t };
}

/** Punto di controllo assoluto da un offset cartesiano dal centro (distanza minima 10). */
function absoluteControlPoint(c: Point, rel: Point): Point {
  const l = len(rel);
  if (l < EPS) return c;
  if (l >= MIN_CP_DISTANCE) return add(c, rel);
  const k = MIN_CP_DISTANCE / l;
  return { x: c.x + rel.x * k, y: c.y + rel.y * k };
}

/** Default di XMind quando la relazione non ha punti di controllo. */
function defaultAnchors(
  from: Rect,
  to: Rect
): { cp1: Point; cp2: Point; ref1: Point; ref2: Point } | null {
  const cf = center(from);
  const ct = center(to);
  const delta = sub(ct, cf);
  const gap = Math.abs(delta.x > 0 ? from.x - to.x : from.x + from.w - (to.x + to.w));
  const aligned = gap < 80;
  const near = gap < 300;
  const closeY = Math.abs(delta.y) < 200;

  if (aligned && closeY) {
    const k = 0.75 * Math.min(delta.y, 600);
    const n1 = Math.max(66 + from.w / 2, k);
    const n2 = Math.max(66 + to.w / 2, k);
    const right = delta.x > 0 || (Math.abs(delta.x) < EPS && cf.x > 0);
    const s = right ? 1 : -1;
    return {
      cp1: { x: s * (n1 + from.w / 2), y: 0 },
      cp2: { x: s * (n2 + to.w / 2), y: 0 },
      ref1: { x: (s * from.w) / 2, y: 0 },
      ref2: { x: (s * to.w) / 2, y: 0 },
    };
  }
  if (!aligned && near && closeY) {
    const t = 0.618 * Math.min(Math.abs(delta.x), 600);
    return {
      cp1: { x: 0, y: -t - from.h / 2 },
      cp2: { x: 0, y: -t - to.h / 2 },
      ref1: { x: 0, y: -from.h / 2 },
      ref2: { x: 0, y: -to.h / 2 },
    };
  }
  return null;
}

/** Spinge `v` fuori dall'intervallo [a - tol, a + tol] se ci cade dentro. */
function clearOf(v: number, a: number, tol: number): number {
  const lo = a - tol;
  const hi = a + tol;
  if (v < lo || v > hi) return v;
  return Math.abs(v - lo) < Math.abs(v - hi) ? lo : hi;
}

function angleOf(v: Point, fallback: Point): number {
  const d = len(v) < EPS ? fallback : v;
  return Math.atan2(d.y, d.x);
}

function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function relationshipGeometry(
  from: Rect,
  to: Rect,
  style: RelationshipStyle,
  controlPoints?: Cps
): RelationshipGeometry {
  const cf = center(from);
  const ct = center(to);
  let rel1 = controlPoints?.[0];
  let rel2 = controlPoints?.[1];
  let ref1: Point | undefined;
  let ref2: Point | undefined;

  if (!rel1 && !rel2) {
    const d = defaultAnchors(from, to);
    if (d) {
      rel1 = d.cp1;
      rel2 = d.cp2;
      ref1 = d.ref1;
      ref2 = d.ref2;
    }
  }

  const start = borderToward(from, ref1 ? add(cf, ref1) : rel1 ? add(cf, rel1) : ct);
  const end = borderToward(to, ref2 ? add(ct, ref2) : rel2 ? add(ct, rel2) : cf);

  const polarDefault = (a: Point, b: Point): Point =>
    add(a, rotate(scale(sub(b, a), DEFAULT_AMOUNT), DEFAULT_ANGLE));
  const cp1 = rel1 ? absoluteControlPoint(cf, rel1) : polarDefault(start, end);
  const cp2 = rel2 ? absoluteControlPoint(ct, rel2) : polarDefault(end, start);

  return buildShape(style.shape, start, end, cp1, cp2);
}

function buildShape(
  shape: RelationshipShape,
  start: Point,
  end: Point,
  cp1: Point,
  cp2: Point
): RelationshipGeometry {
  const f = (n: number): string => String(Math.round(n * 100) / 100);
  const p = (pt: Point): string => `${f(pt.x)} ${f(pt.y)}`;

  switch (shape) {
    case 'straight': {
      const a = angleOf(sub(end, start), { x: 1, y: 0 });
      return {
        d: `M ${p(start)} L ${p(end)}`,
        start,
        end,
        handles: [lerp(start, end, 1 / 3), lerp(start, end, 2 / 3)],
        startAngle: a + Math.PI,
        endAngle: a,
        label: mid(start, end),
      };
    }
    case 'angled':
      return {
        d: `M ${p(start)} L ${p(cp1)} L ${p(cp2)} L ${p(end)}`,
        start,
        end,
        handles: [cp1, cp2],
        startAngle: angleOf(sub(start, cp1), sub(start, end)),
        endAngle: angleOf(sub(end, cp2), sub(end, start)),
        label: mid(cp1, cp2),
      };
    case 'zigzag': {
      const horizontal =
        Math.abs(start.x - cp1.x) + Math.abs(cp2.x - end.x) >
        Math.abs(start.y - cp1.y) + Math.abs(cp2.y - end.y);
      let c1: Point;
      let c2: Point;
      if (horizontal) {
        const x = clearOf(
          clearOf((cp1.x + cp2.x) / 2, start.x, ZIGZAG_CLEARANCE),
          end.x,
          ZIGZAG_CLEARANCE
        );
        c1 = { x, y: start.y };
        c2 = { x, y: end.y };
      } else {
        const y = clearOf(
          clearOf((cp1.y + cp2.y) / 2, start.y, ZIGZAG_CLEARANCE),
          end.y,
          ZIGZAG_CLEARANCE
        );
        c1 = { x: start.x, y };
        c2 = { x: end.x, y };
      }
      return {
        d: horizontal
          ? `M ${p(start)} H ${f(c1.x)} V ${f(c2.y)} H ${f(end.x)}`
          : `M ${p(start)} V ${f(c1.y)} H ${f(c2.x)} V ${f(end.y)}`,
        start,
        end,
        handles: [c1, c2],
        startAngle: angleOf(sub(start, c1), sub(start, end)),
        endAngle: angleOf(sub(end, c2), sub(end, start)),
        label: mid(c1, c2),
      };
    }
    case 'curved':
    default: {
      const t = 0.5;
      const u = 1 - t;
      const label = {
        x: u * u * u * start.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * end.x,
        y: u * u * u * start.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * end.y,
      };
      return {
        d: `M ${p(start)} C ${p(cp1)} ${p(cp2)} ${p(end)}`,
        start,
        end,
        handles: [cp1, cp2],
        startAngle: angleOf(sub(start, cp1), sub(start, end)),
        endAngle: angleOf(sub(end, cp2), sub(end, start)),
        label,
      };
    }
  }
}

/**
 * Inverso delle maniglie: dalla posizione mondo della maniglia `index` al
 * punto di controllo da salvare (relativo al centro del blocco di estremità).
 */
export function handleToControlPoint(index: 0 | 1, world: Point, from: Rect, to: Rect): Point {
  const c = center(index === 0 ? from : to);
  return { x: world.x - c.x, y: world.y - c.y };
}

/**
 * Punti di controllo da salvare trascinando la maniglia `index` in `world`.
 * Per lo zigzag le due maniglie sono gli angoli dello stesso tratto centrale:
 * si spostano insieme, così il tratto segue il puntatore invece di muoversi
 * della metà. Per le altre forme si cambia solo la maniglia trascinata.
 */
export function dragHandle(
  index: 0 | 1,
  world: Point,
  from: Rect,
  to: Rect,
  style: RelationshipStyle,
  controlPoints?: Cps
): Cps {
  const result: Cps = [controlPoints?.[0], controlPoints?.[1]];
  if (style.shape !== 'zigzag') {
    result[index] = handleToControlPoint(index, world, from, to);
    return result;
  }
  const g = relationshipGeometry(from, to, style, controlPoints);
  const vertical = Math.abs(g.handles[0].x - g.handles[1].x) < EPS;
  for (const i of [0, 1] as const) {
    const h = g.handles[i];
    const moved = vertical ? { x: world.x, y: h.y } : { x: h.x, y: world.y };
    result[i] = handleToControlPoint(i, moved, from, to);
  }
  return result;
}
