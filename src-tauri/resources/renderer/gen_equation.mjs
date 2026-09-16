// LaTeX -> standalone MathJax SVG with explicit px dimensions.
//
// Identical engine (mathjax-full) and configuration to XMind's bundled MathJax,
// so the fallback raster and the live preview match what XMind draws.
//
// Usage: node gen_equation.mjs '<latex>' <out.svg> <em_px>
// stdout: {"width": <px>, "height": <px>, "error": <string|null>}
//
// This file is a faithful extension of the validated reference script
// (~/.local/share/xmind-latex/gen_equation.mjs): it only adds error reporting.
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import fs from "fs";

const latex = process.argv[2];
const outFile = process.argv[3];
const emPx = parseFloat(process.argv[4] || "23.33");

if (typeof latex !== "string" || !outFile) {
  console.error("usage: node gen_equation.mjs '<latex>' <out.svg> <em_px>");
  process.exit(2);
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: "local" });
const doc = mathjax.document("", { InputJax: tex, OutputJax: svg });

// display:true renders in display style, matching XMind's equation rendering.
const node = doc.convert(latex, { display: true, em: 16, ex: 8, containerWidth: 80 * 16 });
let svgStr = adaptor.innerHTML(node);

// MathJax reports recoverable TeX errors as <merror data-mjx-error="...">.
const errMatch = svgStr.match(/data-mjx-error="([^"]*)"/);
const error = errMatch ? decodeHtml(errMatch[1]) : null;

// Size derives from the viewBox; MathJax viewBox units are 1/1000 em.
const vbMatch = svgStr.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
if (!vbMatch) throw new Error("viewBox not found in MathJax output");
const widthPx = (parseFloat(vbMatch[3]) / 1000) * emPx;
const heightPx = (parseFloat(vbMatch[4]) / 1000) * emPx;

// Force explicit px dimensions so rasterizers render it at the intended size.
svgStr = svgStr
  .replace(/\swidth="[^"]*"/, ` width="${widthPx.toFixed(2)}px"`)
  .replace(/\sheight="[^"]*"/, ` height="${heightPx.toFixed(2)}px"`)
  .replace(/\sstyle="vertical-align:[^"]*"/, "");
if (!svgStr.includes('fill="currentColor"')) {
  svgStr = svgStr.replace("<svg ", '<svg fill="currentColor" ');
}

fs.writeFileSync(outFile, svgStr);
console.log(JSON.stringify({ width: widthPx, height: heightPx, error }));

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
