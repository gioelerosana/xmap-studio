/** Campi di testo: le scorciatoie della mappa non si attivano dentro di essi. */
export const TEXT_FIELD = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
export const INTERACTIVE = `${TEXT_FIELD},button,a,[role="button"],[role="menuitem"],[role="dialog"]`;

export const COMPACT_QUERY = '(max-width: 639px)';
