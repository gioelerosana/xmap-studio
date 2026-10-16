/**
 * Stile e punti di controllo delle relazioni XMind.
 *
 * Fonte: bundle XMind 26.03 (serializer di `content.json` e router delle
 * relazioni).
 * - `theme.relationship.properties` e `rel.style.properties` usano le chiavi
 *   `shape-class`, `line-pattern`, `line-width`, `line-color`,
 *   `arrow-begin-class`, `arrow-end-class`; le proprietà della relazione
 *   vincono su quelle del tema.
 * - `controlPoints["0"|"1"]` sono offset dal CENTRO del blocco di estremità
 *   (end1 / end2). XMind accetta anche la forma polare `{angle, amount}`: qui
 *   viene ignorata (si usa il default) e, se si scrive, viene sostituita da
 *   `{x, y}`.
 * - `lineEndPoints["0"|"1"]` (punto di attacco sul bordo, relativo al centro)
 *   hanno la precedenza sul bordo derivato dal punto di controllo; se mancano,
 *   XMind li ricava dalla direzione centro -> punto di controllo. Per questo
 *   `setRelationshipControlPoint` rimuove il `lineEndPoints` dello stesso
 *   indice: resterebbe stantio e XMind disegnerebbe una linea diversa.
 */
import type {
  ArrowShape,
  LinePattern,
  Point,
  RelationshipShape,
  RelationshipStyle,
} from '../state/types.js';
import type { Relationship, Sheet } from './types.js';
import { newTopicId } from './utils.js';

export const DEFAULT_RELATIONSHIP_STYLE: RelationshipStyle = {
  shape: 'curved',
  linePattern: 'dash',
  lineWidth: 2,
  arrowBegin: 'none',
  arrowEnd: 'triangle',
};

const SHAPE_PREFIX = 'org.xmind.relationshipShape.';
const ARROW_PREFIX = 'org.xmind.arrowShape.';

const SHAPES: readonly RelationshipShape[] = ['curved', 'straight', 'angled', 'zigzag'];
const PATTERNS: readonly LinePattern[] = ['solid', 'dash', 'dot', 'dash-dot'];
const ARROWS: readonly ArrowShape[] = [
  'none',
  'triangle',
  'spearhead',
  'dot',
  'square',
  'diamond',
  'attached',
];

type Props = Record<string, unknown>;

function asRecord(value: unknown): Props | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Props)
    : undefined;
}

function propertiesOf(holder: unknown): Props {
  return asRecord(asRecord(holder)?.properties) ?? {};
}

function shapeFrom(value: unknown): RelationshipShape | undefined {
  if (typeof value !== 'string') return undefined;
  // Le varianti `flexible.*` si disegnano come la forma base.
  const name = value.replace(SHAPE_PREFIX, '').replace(/^flexible\./, '');
  return SHAPES.find((s) => s === name);
}

function patternFrom(value: unknown): LinePattern | undefined {
  if (typeof value !== 'string') return undefined;
  return PATTERNS.find((p) => p === value);
}

function arrowFrom(value: unknown): ArrowShape | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(ARROW_PREFIX, '');
  return ARROWS.find((a) => a === name);
}

function widthFrom(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function colorFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Proprietà di `rel.style.properties` sopra quelle di `sheet.theme.relationship.properties`. */
export function resolveRelationshipStyle(sheet: Sheet, rel: Relationship): RelationshipStyle {
  const theme = propertiesOf(asRecord(sheet.theme)?.relationship);
  const own = propertiesOf(rel.style);
  const pick = <T>(key: string, parse: (v: unknown) => T | undefined): T | undefined =>
    parse(own[key]) ?? parse(theme[key]);

  const d = DEFAULT_RELATIONSHIP_STYLE;
  const style: RelationshipStyle = {
    shape: pick('shape-class', shapeFrom) ?? d.shape,
    linePattern: pick('line-pattern', patternFrom) ?? d.linePattern,
    lineWidth: pick('line-width', widthFrom) ?? d.lineWidth,
    arrowBegin: pick('arrow-begin-class', arrowFrom) ?? d.arrowBegin,
    arrowEnd: pick('arrow-end-class', arrowFrom) ?? d.arrowEnd,
  };
  const color = pick('line-color', colorFrom);
  if (color) style.lineColor = color;
  return style;
}

function cartesian(value: unknown): Point | undefined {
  const o = asRecord(value);
  if (!o) return undefined;
  if (typeof o.angle === 'number' && typeof o.amount === 'number') return undefined;
  return typeof o.x === 'number' && typeof o.y === 'number' && Number.isFinite(o.x) && Number.isFinite(o.y)
    ? { x: o.x, y: o.y }
    : undefined;
}

/** `controlPoints["0"]` / `["1"]` del file, se numerici. */
export function readControlPoints(
  rel: Relationship
): [Point | undefined, Point | undefined] | undefined {
  const cps = asRecord(rel.controlPoints);
  if (!cps) return undefined;
  const p0 = cartesian(cps['0']);
  const p1 = cartesian(cps['1']);
  return p0 || p1 ? [p0, p1] : undefined;
}

function findRelationship(sheet: Sheet, id: string): Relationship | undefined {
  return (sheet.relationships ?? []).find((r) => r.id === id);
}

/**
 * Imposta il punto di controllo `index` (0 = lato end1, 1 = lato end2),
 * relativo al centro del blocco di estremità; `null` lo rimuove.
 * Conserva tutte le altre chiavi della relazione.
 */
export function setRelationshipControlPoint(
  sheet: Sheet,
  relationshipId: string,
  index: 0 | 1,
  point: Point | null
): boolean {
  const rel = findRelationship(sheet, relationshipId);
  if (!rel) return false;
  const key = String(index);

  let cps = asRecord(rel.controlPoints);
  if (point) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    if (!cps) {
      cps = {};
      rel.controlPoints = cps;
    }
    cps[key] = { x: point.x, y: point.y };
  } else if (cps) {
    delete cps[key];
    if (Object.keys(cps).length === 0) delete rel.controlPoints;
  }

  // Punto di attacco stantio: XMind lo ricalcola dal punto di controllo.
  const ends = asRecord(rel.lineEndPoints);
  if (ends) {
    delete ends[key];
    if (Object.keys(ends).length === 0) delete rel.lineEndPoints;
  }
  return true;
}

/** Imposta `style.properties["shape-class"]` della relazione. */
export function setRelationshipShape(
  sheet: Sheet,
  relationshipId: string,
  shape: RelationshipShape
): boolean {
  const rel = findRelationship(sheet, relationshipId);
  if (!rel) return false;

  let style = asRecord(rel.style);
  if (!style) {
    style = { id: newTopicId() };
    rel.style = style;
  }
  let props = asRecord(style.properties);
  if (!props) {
    props = {};
    style.properties = props;
  }
  props['shape-class'] = `${SHAPE_PREFIX}${shape}`;
  return true;
}
