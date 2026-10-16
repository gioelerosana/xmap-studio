/**
 * Stile del testo dei blocchi: lettura di `style.properties` e
 * `attributedTitle`, scrittura non distruttiva delle proprietà `fo:*`.
 */
import type { TextStyle, TitleRun } from '../state/types.js';
import type { Topic } from './types.js';

/** Modifica parziale: `null` rimuove la proprietà, `undefined` la lascia com'è. */
export type TextStylePatch = { [K in keyof TextStyle]?: TextStyle[K] | null };

/** Stile del blocco intero da `style.properties`; `undefined` se non c'è nulla. */
export function readTextStyle(_topic: Topic): TextStyle | undefined {
  return undefined; // TODO(core-style)
}

/** Frammenti di `attributedTitle`, solo se la loro concatenazione è uguale a `title`. */
export function readTitleRuns(_topic: Topic): TitleRun[] | undefined {
  return undefined; // TODO(core-style)
}

/** Applica `patch` a `style.properties` conservando ogni altra chiave. */
export function setTextStyle(_topic: Topic, _patch: TextStylePatch): void {
  // TODO(core-style)
}
