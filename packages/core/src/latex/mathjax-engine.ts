// Motore MathJax 4 vero e proprio. È il modulo più pesante dell'app: `mathjax.ts` lo
// carica con `import()` solo quando serve una formula, così l'avvio non lo scarica
// né lo valuta.
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
// Frecce estensibili di mhchem (`\ce{A -> B}`): in MathJax 4 stanno in un'estensione del font.
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js';
// MathJax 4 non ha più `AllPackages`: si importano le configurazioni una per una.
// L'elenco è quello di `AllPackages` di MathJax 3, così le formule esistenti si
// leggono come prima.
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/action/ActionConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/braket/BraketConfiguration.js';
import '@mathjax/src/js/input/tex/bussproofs/BussproofsConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/colortbl/ColortblConfiguration.js';
import '@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js';
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js';
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/html/HtmlConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/noerrors/NoErrorsConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js';
import '@mathjax/src/js/input/tex/verb/VerbConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js';
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';

const TEX_PACKAGES = [
  'base', 'action', 'ams', 'amscd', 'bbox', 'boldsymbol', 'braket', 'bussproofs',
  'cancel', 'cases', 'centernot', 'color', 'colortbl', 'empheq', 'enclose', 'extpfeil',
  'gensymb', 'html', 'mathtools', 'mhchem', 'newcommand', 'noerrors', 'noundefined',
  'upgreek', 'unicode', 'verb', 'configmacros', 'tagformat', 'textcomp', 'textmacros',
];

/**
 * Esito di una conversione: l'SVG grezzo di MathJax, oppure la promessa del file di
 * glifi che manca (il font `mathjax-newcm` di MathJax 4 tiene gli alfabeti meno
 * comuni in file separati, caricati alla prima formula che li usa). Risolta la
 * promessa, la stessa conversione va ripetuta. Se il file non si può caricare
 * (es. offline senza cache), la promessa si risolve una volta e le successive
 * vengono rifiutate.
 */
export type MathJaxOutcome = { svg: string } | { pending: Promise<void> };

/** Converte LaTeX nel markup SVG grezzo di MathJax (`<svg …>…</svg>`), in modo sincrono. */
export type MathJaxConvert = (latex: string, display: boolean) => MathJaxOutcome;

const FONT_PREFIX = '@mathjax/mathjax-newcm-font/js/svg/dynamic/';

// Import espliciti (non un percorso calcolato): i bundler ne fanno un chunk per file,
// che il service worker mette in cache con il resto della build (uso offline).
const FONT_FILES: Record<string, () => Promise<unknown>> = {
  'PUA': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/PUA.js'),
  'accents-b-i': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/accents-b-i.js'),
  'accents': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js'),
  'arabic': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/arabic.js'),
  'arrows': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js'),
  'braille-d': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/braille-d.js'),
  'braille': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/braille.js'),
  'calligraphic': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js'),
  'cherokee': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/cherokee.js'),
  'cyrillic-ss': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic-ss.js'),
  'cyrillic': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic.js'),
  'devanagari': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/devanagari.js'),
  'double-struck': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js'),
  'fraktur': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js'),
  'greek-ss': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js'),
  'greek': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js'),
  'hebrew': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/hebrew.js'),
  'latin-b': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js'),
  'latin-bi': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js'),
  'latin-i': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js'),
  'latin': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js'),
  'marrows': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js'),
  'math': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js'),
  'monospace-ex': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-ex.js'),
  'monospace-l': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-l.js'),
  'monospace': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js'),
  'mshapes': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js'),
  'phonetics-ss': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics-ss.js'),
  'phonetics': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics.js'),
  'sans-serif-b': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-b.js'),
  'sans-serif-bi': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-bi.js'),
  'sans-serif-ex': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-ex.js'),
  'sans-serif-i': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-i.js'),
  'sans-serif-r': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-r.js'),
  'sans-serif': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js'),
  'script': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js'),
  'shapes': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js'),
  'symbols-b-i': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js'),
  'symbols': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js'),
  'variants': () => import('@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js'),
};

/**
 * Formula che usa gli alfabeti più frequenti nelle mappe (`\mathbb`, `\mathcal`,
 * `\mathfrak`, `\mathscr`, `\mathsf`, `\mathtt`): convertita al caricamento, porta
 * in memoria i loro file di glifi (≈200 kB compressi in tutto), così quasi ogni
 * formula si rende al primo colpo.
 */
const WARMUP_LATEX = '\\mathbb{R}\\mathcal{L}\\mathfrak{g}\\mathscr{F}\\mathsf{A}\\mathtt{A}';

/** Tentativi massimi di una conversione in attesa di glifi (uno per file mancante). */
const MAX_RETRIES = 10;

/** Opzioni di conversione invariate da MathJax 3: le dimensioni in px le ricalcola `mathjax.ts` dal viewBox. */
const EM_PX = 16;
const EX_PX = 8;
const CONTAINER_WIDTH_PX = 80 * EM_PX;

// Toglie l'estensione: "double-struck.js" → "double-struck"; "double-struck" resta com'è.
const JS_EXTENSION = /\.js$/;

function loadFontFile(name: string): Promise<unknown> {
  const file = name.startsWith(FONT_PREFIX) ? name.slice(FONT_PREFIX.length).replace(JS_EXTENSION, '') : null;
  const load = file !== null ? FONT_FILES[file] : undefined;
  if (!load) return Promise.reject(new Error(`File MathJax non disponibile: ${name}`));
  return load();
}

async function settle(retry: Promise<unknown>): Promise<void> {
  await retry;
}

/** La promessa di un errore "MathJax retry" (glifi da caricare), o null per gli altri errori. */
function retryPromise(err: unknown): Promise<void> | null {
  if (typeof err !== 'object' || err === null || !('retry' in err)) return null;
  const retry: unknown = err.retry;
  return retry instanceof Promise ? settle(retry) : null;
}

/** Converte `WARMUP_LATEX` finché i suoi glifi sono in memoria (al più `attemptsLeft` volte). */
async function warmUp(convert: MathJaxConvert, attemptsLeft: number): Promise<void> {
  if (attemptsLeft <= 0) return;
  const outcome = convert(WARMUP_LATEX, true);
  if (!('pending' in outcome)) return;
  try {
    await outcome.pending;
  } catch {
    // Un file che non si carica non blocca il motore: quella formula resterà in sospeso.
    return;
  }
  await warmUp(convert, attemptsLeft - 1);
}

/**
 * Crea il convertitore. Asincrona perché, prima di restituirlo, carica i glifi
 * degli alfabeti più comuni (`WARMUP_LATEX`).
 */
export async function createMathJaxConverter(): Promise<MathJaxConvert> {
  mathjax.asyncLoad = loadFontFile;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: TEX_PACKAGES });
  // `fontCache: 'local'`: i glifi stanno dentro ogni SVG (`<defs>`), che resta autosufficiente.
  const svg = new SVG({ fontCache: 'local' });
  svg.addExtension(MathJaxMhchemFontExtension);
  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

  const convert: MathJaxConvert = (latex, display) => {
    try {
      const node = doc.convert(latex, { display, em: EM_PX, ex: EX_PX, containerWidth: CONTAINER_WIDTH_PX });
      return { svg: adaptor.innerHTML(node) };
    } catch (err: unknown) {
      const pending = retryPromise(err);
      if (pending) return { pending };
      throw err;
    }
  };

  await warmUp(convert, MAX_RETRIES);
  return convert;
}
