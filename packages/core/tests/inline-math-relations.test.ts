import { describe, expect, it } from 'vitest';
import { renderLatexToSvgAsync } from '../src/index.js';

const glyphs = (svg: string) => svg.match(/<use data-c="[0-9A-F]+"/g)?.map((m) => m.slice(13, -1)) ?? [];

describe('formule in linea con relazioni', () => {
  // MathJax 4 spezzava le formule in linea dopo `<`/`>`/`=` in più SVG: restava solo il primo pezzo.
  it('disegna tutti i simboli dopo una relazione', async () => {
    const { svg, error } = await renderLatexToSvgAsync('<D, I>', 16, false);
    expect(error).toBeNull();
    expect(glyphs(svg)).toEqual(['3C', '1D437', '2C', '1D43C', '3E']);
  });

  it('a < b = c resta intera in linea', async () => {
    const { svg } = await renderLatexToSvgAsync('a<b=c', 16, false);
    expect(glyphs(svg)).toEqual(['1D44E', '3C', '1D44F', '3D', '1D450']);
    expect(svg.match(/<svg/g)).toHaveLength(1);
  });
});
