// Motore MathJax vero e proprio. È il modulo più pesante dell'app (≈2/3 del bundle
// web): `mathjax.ts` lo carica con `import()` solo quando serve una formula, così
// l'avvio non lo scarica né lo valuta.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

/** Converte LaTeX nel markup SVG grezzo di MathJax (`<mjx-container>…</mjx-container>`). */
export type MathJaxConvert = (latex: string, display: boolean) => string;

export function createMathJaxConverter(): MathJaxConvert {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages });
  const svg = new SVG({ fontCache: 'local' });
  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
  return (latex, display) => {
    const node = doc.convert(latex, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
    return adaptor.innerHTML(node);
  };
}
