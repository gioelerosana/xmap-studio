import { describe, expect, it, vi } from 'vitest';

// Istanza fresca del modulo: il setup dei test ha già caricato MathJax in quella condivisa.
async function freshMathJax() {
  vi.resetModules();
  return await import('../src/latex/mathjax.js');
}

describe('caricamento su richiesta di MathJax', () => {
  it('prima del caricamento renderLatexToSvg lancia e avvia il caricamento', async () => {
    const mj = await freshMathJax();
    expect(mj.isMathJaxReady()).toBe(false);
    const ready = vi.fn();
    mj.onMathJaxReady(ready);
    expect(() => mj.renderLatexToSvg('x^2')).toThrow(/non è ancora caricato/);
    await mj.loadMathJax();
    expect(mj.isMathJaxReady()).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(mj.renderLatexToSvg('x^2').svg).toContain('<svg');
  });

  it('loadMathJax è idempotente', async () => {
    const mj = await freshMathJax();
    const a = mj.loadMathJax();
    expect(mj.loadMathJax()).toBe(a);
    await a;
  });

  it('il layout rimisura le formule quando MathJax diventa disponibile', async () => {
    vi.resetModules();
    const mj = await import('../src/latex/mathjax.js');
    const layout = await import('../src/layout/layout.js');
    const node = { depth: 1, kind: 'equation', latex: '\\int_0^1 x^2\\,dx', title: '', displayTitle: '' } as const;
    const before = layout.estimateNodeSize(node);
    await mj.loadMathJax();
    const after = layout.estimateNodeSize(node);
    expect(after).not.toEqual(before);
  });
});
