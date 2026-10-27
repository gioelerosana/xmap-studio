import { afterEach, describe, expect, it } from 'vitest';
import {
  estimateNodeSize,
  inlineMathFontSize,
  renderLatexToSvg,
  setTextMeasurer,
  type TextMeasurer,
} from '../src/index.js';

/** Misura deterministica: 0.5em per carattere, 0.6em in grassetto. */
const fakeMeasurer: TextMeasurer = (text, fontSizePx, bold) =>
  [...text].length * fontSizePx * (bold ? 0.6 : 0.5);

/** Altezza di una riga base di un blocco di profondità 2 e padding verticale del blocco. */
const LINE_H = 18;
const PAD_V = 16;

afterEach(() => {
  setTextMeasurer(null);
});

describe('stima del titolo con run e formule', () => {
  it('misura ogni parola con lo stile dei caratteri che copre, anche se in grassetto solo in parte', () => {
    setTextMeasurer(fakeMeasurer);
    const plain = estimateNodeSize({ depth: 2, title: 'alpha beta gamma' });
    const partlyBold = estimateNodeSize({
      depth: 2,
      title: 'alpha beta gamma',
      titleRuns: [{ text: 'alpha ' }, { text: 'beta', bold: true }, { text: ' gamma' }],
    });
    // 'alpha ' + 'beta' + ' gamma': 'beta' in grassetto pesa 4 * 12 * 0.6 invece di 4 * 12 * 0.5
    expect(partlyBold.w).toBeGreaterThanOrEqual(plain.w);
    expect(plain.w).toBe(Math.round(96 + 18 + 2));
    expect(partlyBold.w).toBe(Math.round(100.8 + 18 + 2));
  });

  it('una run con dimensione maggiore alza la riga e quindi il blocco', () => {
    const plain = estimateNodeSize({ depth: 2, title: 'uno' });
    const bigger = estimateNodeSize({
      depth: 2,
      title: 'uno',
      titleRuns: [{ text: 'uno', fontSizePx: 24 }],
    });
    // Riga da 24px: round(24 * 1.375) + 1 = 34, più il padding verticale
    expect(plain.h).toBe(36);
    expect(bigger.h).toBeGreaterThan(plain.h);
    expect(bigger.h).toBe(34 + PAD_V);
  });

  it('un a capo nel titolo produce due righe in altezza', () => {
    const size = estimateNodeSize({ depth: 2, title: 'uno\ndue' });
    expect(size.h).toBe(2 * LINE_H + PAD_V);
  });

  it('una formula display ha una riga propria con la sua altezza più 4px', () => {
    const latex = '\\sum_{i=1}^{n} i';
    const mathH = renderLatexToSvg(latex, inlineMathFontSize(12), true).height;
    const withDisplay = estimateNodeSize({ depth: 2, title: `testo $$${latex}$$` });
    const plainText = estimateNodeSize({ depth: 2, title: 'testo' });
    // Riga del testo prima della formula, poi la riga della formula
    expect(withDisplay.h).toBe(Math.round(LINE_H + mathH + 4 + PAD_V));
    expect(withDisplay.h).toBeGreaterThan(plainText.h);
  });

  it('una formula inline alza la riga solo se è più alta del testo', () => {
    const mathH = renderLatexToSvg('x^2', inlineMathFontSize(12), false).height;
    const size = estimateNodeSize({ depth: 2, title: 'valore $x^2$' });
    expect(size.h).toBe(Math.max(36, Math.round(Math.max(LINE_H, mathH + 4) + PAD_V)));
  });

  it('con run in grassetto che contengono una formula il blocco resta calcolato sul titolo', () => {
    setTextMeasurer(fakeMeasurer);
    const size = estimateNodeSize({
      depth: 2,
      title: 'valore $x^2$',
      titleRuns: [{ text: 'valore ' }, { text: '$x^2$', bold: true }],
    });
    const mathH = renderLatexToSvg('x^2', inlineMathFontSize(12), false).height;
    expect(size.h).toBe(Math.max(36, Math.round(Math.max(LINE_H, mathH + 4) + PAD_V)));
    expect(size.w).toBeGreaterThan(0);
  });

  it('run non coerenti con il testo ricadono sullo stile di base', () => {
    setTextMeasurer(fakeMeasurer);
    const plain = estimateNodeSize({ depth: 2, title: 'uno' });
    const mismatched = estimateNodeSize({
      depth: 2,
      title: 'uno',
      titleRuns: [{ text: 'altro', fontSizePx: 40 }],
    });
    expect(mismatched).toEqual(plain);
  });

  it("l'equazione nativa misura la formula come la si disegna, non il PNG salvato", () => {
    const latex = 'E=mc^2';
    const svg = renderLatexToSvg(latex, inlineMathFontSize(12));
    const size = estimateNodeSize({ depth: 2, kind: 'equation', latex, imageW: 600, imageH: 300 });
    expect(size.w).toBeCloseTo(Math.max(svg.width + 36, 96), 5);
    expect(size.h).toBeCloseTo(Math.max(svg.height + 22, 38), 5);
  });

  it("l'equazione nativa e la formula nel testo hanno la stessa scala", () => {
    const small = estimateNodeSize({ depth: 2, kind: 'equation', latex: 'x^2' });
    const root = estimateNodeSize({ depth: 0, kind: 'equation', latex: 'x^2' });
    expect(root.h).toBeGreaterThan(small.h);
  });

  it('la scala delle formule segue la dimensione del testo', () => {
    expect(inlineMathFontSize(12)).toBe(16.2);
    expect(inlineMathFontSize(14)).toBe(18.9);
  });
});
