/**
 * Ponte tra l'editor in place del titolo (`NodeEditor`) e la barra flottante.
 * Mentre un blocco è in modifica i pulsanti di stile agiscono sulla selezione dell'editor
 * (formattazione parziale) invece che sull'intero blocco. Un solo editor è aperto alla volta.
 *
 * I pulsanti che lo usano devono chiamare `preventDefault()` su `pointerdown`/`mousedown`:
 * se l'editor perdesse il focus confermerebbe il testo e si chiuderebbe.
 */
export type InlineToggleStyle = 'bold' | 'italic' | 'underline' | 'strikethrough';

export interface InlineEditorApi {
  /** Attiva/disattiva lo stile sulla selezione; con il cursore senza selezione agisce su tutto il testo. */
  toggleStyle: (style: InlineToggleStyle) => void;
  /** Colore del testo selezionato (o di tutto il testo); `null` torna al colore del tema. */
  setColor: (color: string | null) => void;
  /** Dimensione in px del testo selezionato (o di tutto il testo); `null` torna a quella del blocco. */
  setFontSize: (px: number | null) => void;
  /** Somma `delta` px alla dimensione di ogni carattere selezionato; `basePx` vale per quelli senza dimensione propria. */
  stepFontSize: (delta: number, basePx: number) => void;
}

/** Limiti della dimensione del testo impostabile dalla barra, in px. */
export const MIN_FONT_SIZE_PX = 6;
export const MAX_FONT_SIZE_PX = 120;

export const clampFontSizePx = (px: number): number =>
  Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, Math.round(px)));

let active: InlineEditorApi | null = null;

export function registerInlineEditor(api: InlineEditorApi): () => void {
  active = api;
  return () => {
    if (active === api) active = null;
  };
}

/** Editor in place aperto, se c'è. */
export function activeInlineEditor(): InlineEditorApi | null {
  return active;
}
