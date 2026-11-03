import { describe, expect, it, vi } from 'vitest';

/**
 * Cirillico: MathJax 4 tiene questo alfabeto in un file di glifi separato, non tra
 * quelli precaricati con `loadMathJax`. Verificato: in un'istanza fresca il rendering
 * sincrono lancia "in caricamento" finché il file non arriva.
 */
const CYRILLIC_LATEX = '\\text{Жизнь}';

/** Ebraico: anch'esso file di glifi separato, usato per verificare la notifica. */
const HEBREW_LATEX = '\\text{שלום}';

describe('glifi caricati su richiesta (istanza fresca)', () => {
  it('il sincrono lancia, il caricamento parte, poi il rendering riesce', async () => {
    vi.resetModules();
    const mj = await import('../src/latex/mathjax.js');
    await mj.loadMathJax();
    const versionBefore = mj.getMathJaxVersion();

    expect(() => mj.renderLatexToSvg(CYRILLIC_LATEX)).toThrow('in caricamento');

    const viaAsync = await mj.renderLatexToSvgAsync(CYRILLIC_LATEX);
    expect(viaAsync.error).toBeNull();
    expect(viaAsync.svg).toContain('<svg');

    await vi.waitFor(() => expect(mj.getMathJaxVersion()).toBeGreaterThan(versionBefore));

    const syncAfter = mj.renderLatexToSvg(CYRILLIC_LATEX);
    expect(syncAfter.error).toBeNull();
    expect(syncAfter.svg).toBe(viaAsync.svg);
  });
});

describe('notifica dei glifi arrivati', () => {
  it('onMathJaxReady viene richiamato quando il file di glifi è pronto', async () => {
    vi.resetModules();
    const mj = await import('../src/latex/mathjax.js');
    await mj.loadMathJax();
    const listener = vi.fn();
    const unsubscribe = mj.onMathJaxReady(listener);

    expect(() => mj.renderLatexToSvg(HEBREW_LATEX)).toThrow('in caricamento');
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    unsubscribe();
  });
});
