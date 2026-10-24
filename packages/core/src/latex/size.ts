/**
 * Il LaTeX nei titoli dei blocchi va reso un po' più grande del testo: a parità di em
 * i glifi MathJax sembrano più piccoli di quelli sans-serif. La stessa scala serve
 * al rendering (RichTitle) e alla stima del layout, così blocco e formula combaciano.
 */
export const INLINE_MATH_SCALE = 1.25;

/** Altezza di riga dei titoli in rapporto alla dimensione del font (`leading-snug` di Tailwind). */
export const TITLE_LEADING_RATIO = 1.375;

/** Precisione (in decimi di px) della dimensione delle formule. */
const MATH_SIZE_STEPS_PER_PX = 10;

/** Dimensione in px con cui si rende una formula inline o display dentro un titolo di `textPx` px. */
export function inlineMathFontSize(textPx: number): number {
  const steps = Math.round(textPx * INLINE_MATH_SCALE * MATH_SIZE_STEPS_PER_PX);
  return steps / MATH_SIZE_STEPS_PER_PX;
}
