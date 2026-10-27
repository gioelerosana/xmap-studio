/**
 * Il LaTeX nei blocchi va reso più grande del testo: a parità di em i glifi MathJax
 * sembrano più piccoli di quelli sans-serif. La stessa scala serve alle formule nel
 * testo (`$…$`), alle equazioni del pulsante e alla stima del layout, così blocco e
 * formula combaciano e tutte le formule hanno la stessa dimensione.
 */
export const INLINE_MATH_SCALE = 1.35;

/** Dimensione base del testo di un blocco: 14 px la radice, 12 px gli altri, salvo lo stile del testo. */
export function titleBaseFontPx(depth: number, textStyle?: { fontSizePx?: number }): number {
  return textStyle?.fontSizePx ?? (depth === 0 ? 14 : 12);
}

/** Altezza di riga dei titoli in rapporto alla dimensione del font (`leading-snug` di Tailwind). */
export const TITLE_LEADING_RATIO = 1.375;

/** Precisione (in decimi di px) della dimensione delle formule. */
const MATH_SIZE_STEPS_PER_PX = 10;

/** Dimensione in px con cui si rende una formula (inline, display o equazione di blocco) per un testo di `textPx` px. */
export function inlineMathFontSize(textPx: number): number {
  const steps = Math.round(textPx * INLINE_MATH_SCALE * MATH_SIZE_STEPS_PER_PX);
  return steps / MATH_SIZE_STEPS_PER_PX;
}
