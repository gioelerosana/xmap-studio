/**
 * Stile e punti di controllo delle relazioni XMind.
 */
import type { Point, RelationshipShape, RelationshipStyle } from '../state/types.js';
import type { Relationship, Sheet } from './types.js';

export const DEFAULT_RELATIONSHIP_STYLE: RelationshipStyle = {
  shape: 'curved',
  linePattern: 'dash',
  lineWidth: 2,
  arrowBegin: 'none',
  arrowEnd: 'triangle',
};

/** Proprietà di `rel.style.properties` sopra quelle di `sheet.theme.relationship.properties`. */
export function resolveRelationshipStyle(_sheet: Sheet, _rel: Relationship): RelationshipStyle {
  return { ...DEFAULT_RELATIONSHIP_STYLE }; // TODO(core-rel)
}

/** `controlPoints["0"]` / `["1"]` del file, se numerici. */
export function readControlPoints(
  _rel: Relationship
): [Point | undefined, Point | undefined] | undefined {
  return undefined; // TODO(core-rel)
}

/**
 * Imposta il punto di controllo `index` (0 = lato end1, 1 = lato end2),
 * relativo al centro del blocco di estremità; `null` lo rimuove.
 * Conserva tutte le altre chiavi della relazione.
 */
export function setRelationshipControlPoint(
  _sheet: Sheet,
  _relationshipId: string,
  _index: 0 | 1,
  _point: Point | null
): boolean {
  return false; // TODO(core-rel)
}

/** Imposta `style.properties["shape-class"]` della relazione. */
export function setRelationshipShape(
  _sheet: Sheet,
  _relationshipId: string,
  _shape: RelationshipShape
): boolean {
  return false; // TODO(core-rel)
}
