import { describe, expect, it, vi } from 'vitest';
import {
  applyEquation,
  MATHJAX_PROVIDER,
  renderLatexToSvg,
  renderLatexToSvgAsync,
  sha256Hex,
  Topic,
} from '../src/index.js';

/** Formule non banali: frazioni, matrici, alfabeti speciali, allineamenti, mhchem, annullamenti. */
const FORMULAS = [
  '\\frac{a+b}{\\sqrt{c^2+d^2}}',
  '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}',
  '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}',
  '\\mathbb{R}^n',
  '\\mathcal{L}',
  '\\mathfrak{g}',
  '\\operatorname{rank}(A)',
  '\\begin{align}a&=b+c\\\\d&=e\\end{align}',
  '\\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt\\pi}{2}',
  '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}',
  '\\left(\\frac{a}{b}\\right)',
  '\\ce{H2O}',
  '\\cancel{x}',
];

/** Formula con cirillico: il suo font non è tra quelli precaricati, quindi serve il caricamento su richiesta. */
const CYRILLIC_LATEX = '\\mathbb{Z}\\times\\text{Ж}';

/** Presenza di resvg (rasterizzatore PNG di Node): senza, il test dell'equazione si salta. */
const HAS_RESVG = await import('@resvg/resvg-js').then(
  () => true,
  () => false
);

describe('formule con MathJax 4 (renderLatexToSvgAsync)', () => {
  it.each(FORMULAS)('rende senza errori né marcatori di errore: %s', async (latex) => {
    const result = await renderLatexToSvgAsync(latex);
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('viewBox="');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.svg).not.toContain('merror');
    expect(result.svg).not.toContain('data-mjx-error');
  });
});

describe('alfabeti precaricati', () => {
  it('\\mathbb{R} si rende in sincrono subito dopo il caricamento del motore', async () => {
    vi.resetModules();
    const mj = await import('../src/latex/mathjax.js');
    await mj.loadMathJax();
    const result = mj.renderLatexToSvg('\\mathbb{R}');
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
  });
});

describe('LaTeX non valido', () => {
  it('restituisce error valorizzato senza lanciare eccezioni', async () => {
    const sync = renderLatexToSvg('\\frac{');
    expect(sync.error).not.toBeNull();
    const viaAsync = await renderLatexToSvgAsync('\\frac{');
    expect(viaAsync.error).not.toBeNull();
  });
});

describe('SVG autosufficiente', () => {
  it('contiene <defs> e <use> che puntano a id definiti nello stesso SVG', async () => {
    const { svg } = await renderLatexToSvgAsync('\\frac{a+b}{\\sqrt{c^2+d^2}}');
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<use');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="currentColor"');

    const targets = svg
      .split('xlink:href="#')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf('"')));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((id) => !svg.includes(`id="${id}"`))).toEqual([]);
  });
});

describe.skipIf(!HAS_RESVG)('equazione salvata con la via asincrona', () => {
  it('risorsa = SHA-256 del PNG, image annidato, extensions array con provider MathJax', async () => {
    const topic: Topic = { id: 't', title: 'x' };
    const { outcome, png } = await applyEquation(topic, CYRILLIC_LATEX);

    const hash = sha256Hex(png);
    expect(outcome.resource).toBe(`resources/${hash}.png`);
    const PNG_TAG = 'PNG';
    expect(new TextDecoder().decode(png.subarray(1, 1 + PNG_TAG.length))).toBe(PNG_TAG);
    expect(topic.image).toEqual({
      src: `xap:resources/${hash}.png`,
      width: outcome.width,
      height: outcome.height,
      isMathJaxImage: true,
    });
    expect(topic.extensions).toEqual([{ provider: MATHJAX_PROVIDER, content: { content: CYRILLIC_LATEX } }]);
  });
});

describe('mhchem', () => {
  // In MathJax 4 le frecce di `\ce` stanno nell'estensione di font mhchem: senza,
  // la freccia sparisce in silenzio (nessun errore, solo un avviso in console).
  it('la freccia di \\ce{A -> B} ha il suo glifo nello stesso SVG', async () => {
    const { svg } = await renderLatexToSvgAsync('\\ce{A -> B}');
    expect(svg).toContain('data-c="E429"');
    expect(svg).toMatch(/<path id="[^"]*E429" d="M/);
  });
});
