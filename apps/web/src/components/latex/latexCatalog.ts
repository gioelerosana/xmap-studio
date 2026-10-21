// Catalogo dei comandi LaTeX proposti dai suggerimenti e dalla tavolozza dei simboli.

export type PaletteGroup = 'greek' | 'operators' | 'relations' | 'arrows' | 'sets' | 'structures';

export interface LatexCommand {
  /** Testo che l'utente digita dopo la barra rovesciata (`frac`, `pmatrix`). */
  key: string;
  /** Testo inserito; `CARET` indica dove va il cursore, altrimenti dentro la prima `{}`. */
  snippet: string;
  /** Simbolo mostrato nei bottoni e nei suggerimenti (Unicode o breve testo). */
  glyph: string;
  /** Descrizione breve in italiano. */
  description: string;
  group: PaletteGroup;
  /** Forma leggibile mostrata nell'elenco dei suggerimenti. */
  display: string;
}

/** Segnaposto del cursore negli snippet (U+2038): non compare mai in LaTeX reale. */
export const CARET = '\u2038';

export const PALETTE_TABS: { id: PaletteGroup; label: string }[] = [
  { id: 'greek', label: 'Greco' },
  { id: 'operators', label: 'Operatori' },
  { id: 'relations', label: 'Relazioni' },
  { id: 'arrows', label: 'Frecce' },
  { id: 'sets', label: 'Insiemi' },
  { id: 'structures', label: 'Strutture' },
];

function displayOf(key: string, snippet: string): string {
  if (snippet.includes('\n')) return `\\begin{${key}}`;
  return snippet.replaceAll(CARET, '');
}

function entry(
  group: PaletteGroup,
  key: string,
  glyph: string,
  description: string,
  snippet: string = `\\${key}`,
): LatexCommand {
  return { key, snippet, glyph, description, group, display: displayOf(key, snippet) };
}

/** Comandi senza argomenti: lo snippet è `\key`. */
function simple(
  group: PaletteGroup,
  rows: [key: string, glyph: string, description: string][],
): LatexCommand[] {
  return rows.map(([key, glyph, description]) => entry(group, key, glyph, description));
}

const structures: LatexCommand[] = [
  entry('structures', 'frac', 'a/b', 'Frazione', '\\frac{}{}'),
  entry('structures', 'sqrt', '√', 'Radice quadrata', '\\sqrt{}'),
  entry('structures', 'nthroot', 'ⁿ√', 'Radice n-esima', `\\sqrt[${CARET}]{}`),
  entry('structures', 'dfrac', 'a/b', 'Frazione in formato display', '\\dfrac{}{}'),
  entry('structures', 'binom', '(n k)', 'Coefficiente binomiale', '\\binom{}{}'),
  entry('structures', 'text', 'abc', 'Testo normale', '\\text{}'),
  entry('structures', 'left', '( )', 'Parentesi tonde che si adattano', `\\left(${CARET}\\right)`),
  entry('structures', 'leftbracket', '[ ]', 'Parentesi quadre che si adattano', `\\left[${CARET}\\right]`),
  entry('structures', 'leftbrace', '{ }', 'Graffe che si adattano', `\\left\\{${CARET}\\right\\}`),
  entry('structures', 'abs', '| |', 'Valore assoluto', `\\left|${CARET}\\right|`),
  entry('structures', 'norm', '‖ ‖', 'Norma', `\\left\\|${CARET}\\right\\|`),
  entry('structures', 'langle', '⟨ ⟩', 'Parentesi angolari', `\\langle ${CARET}\\rangle`),
  entry('structures', 'lfloor', '⌊ ⌋', 'Parte intera inferiore', `\\lfloor ${CARET}\\rfloor`),
  entry('structures', 'lceil', '⌈ ⌉', 'Parte intera superiore', `\\lceil ${CARET}\\rceil`),
  entry('structures', 'hat', 'â', 'Accento circonflesso', '\\hat{}'),
  entry('structures', 'bar', 'ā', 'Barra sopra', '\\bar{}'),
  entry('structures', 'vec', 'v⃗', 'Vettore', '\\vec{}'),
  entry('structures', 'tilde', 'ã', 'Tilde', '\\tilde{}'),
  entry('structures', 'dot', 'ȧ', 'Punto sopra (derivata temporale)', '\\dot{}'),
  entry('structures', 'ddot', 'ä', 'Due punti sopra', '\\ddot{}'),
  entry('structures', 'widehat', 'â', 'Cappuccio esteso', '\\widehat{}'),
  entry('structures', 'overline', 'x̅', 'Linea sopra', '\\overline{}'),
  entry('structures', 'underline', 'x̲', 'Linea sotto', '\\underline{}'),
  entry('structures', 'overrightarrow', 'AB⃗', 'Freccia estesa sopra', '\\overrightarrow{}'),
  entry('structures', 'overbrace', '⏞', 'Graffa sopra', '\\overbrace{}^{}'),
  entry('structures', 'underbrace', '⏟', 'Graffa sotto', '\\underbrace{}_{}'),
  entry('structures', 'mathrm', 'Rm', 'Carattere tondo', '\\mathrm{}'),
  entry('structures', 'mathbf', 'B', 'Grassetto', '\\mathbf{}'),
  entry('structures', 'boldsymbol', 'α', 'Simbolo in grassetto', '\\boldsymbol{}'),
  entry('structures', 'mathcal', '𝒜', 'Calligrafico', '\\mathcal{}'),
  entry('structures', 'mathbb', '𝔸', 'Lavagna (insiemi numerici)', '\\mathbb{}'),
  entry('structures', 'quad', '␣', 'Spazio ampio', '\\quad '),
  entry('structures', 'qquad', '␣␣', 'Spazio molto ampio', '\\qquad '),
  entry(
    'structures',
    'pmatrix',
    '(▦)',
    'Matrice con parentesi tonde',
    `\\begin{pmatrix}\n  ${CARET} & \\\\\n   & \n\\end{pmatrix}`,
  ),
  entry(
    'structures',
    'bmatrix',
    '[▦]',
    'Matrice con parentesi quadre',
    `\\begin{bmatrix}\n  ${CARET} & \\\\\n   & \n\\end{bmatrix}`,
  ),
  entry(
    'structures',
    'vmatrix',
    '|▦|',
    'Determinante',
    `\\begin{vmatrix}\n  ${CARET} & \\\\\n   & \n\\end{vmatrix}`,
  ),
  entry(
    'structures',
    'cases',
    '{▤',
    'Definizione a casi',
    `\\begin{cases}\n  ${CARET} & \\text{se } \\\\\n   & \\text{altrimenti}\n\\end{cases}`,
  ),
  entry(
    'structures',
    'aligned',
    '≡▤',
    'Equazioni allineate',
    `\\begin{aligned}\n  ${CARET} &=  \\\\\n  &= \n\\end{aligned}`,
  ),
  entry(
    'structures',
    'array',
    '▥',
    'Tabella di colonne',
    `\\begin{array}{cc}\n  ${CARET} & \\\\\n   & \n\\end{array}`,
  ),
];

const operators: LatexCommand[] = [
  entry('operators', 'sum', '∑', 'Sommatoria', '\\sum_{}^{}'),
  entry('operators', 'int', '∫', 'Integrale', '\\int_{}^{}'),
  entry('operators', 'lim', 'lim', 'Limite', '\\lim_{}'),
  entry('operators', 'prod', '∏', 'Produttoria', '\\prod_{}^{}'),
  entry('operators', 'oint', '∮', 'Integrale di linea chiusa', '\\oint_{}'),
  entry('operators', 'iint', '∬', 'Integrale doppio', '\\iint_{}'),
  entry('operators', 'bigcup', '⋃', 'Unione estesa', '\\bigcup_{}^{}'),
  entry('operators', 'bigcap', '⋂', 'Intersezione estesa', '\\bigcap_{}^{}'),
  ...simple('operators', [
    ['partial', '∂', 'Derivata parziale'],
    ['nabla', '∇', 'Nabla (gradiente)'],
    ['infty', '∞', 'Infinito'],
    ['cdot', '·', 'Prodotto con punto'],
    ['times', '×', 'Prodotto'],
    ['div', '÷', 'Divisione'],
    ['pm', '±', 'Più o meno'],
    ['mp', '∓', 'Meno o più'],
    ['ast', '∗', 'Asterisco'],
    ['circ', '∘', 'Composizione'],
    ['bullet', '•', 'Punto elenco'],
    ['oplus', '⊕', 'Somma diretta'],
    ['otimes', '⊗', 'Prodotto tensoriale'],
    ['cdots', '⋯', "Puntini a mezz'altezza"],
    ['ldots', '…', 'Puntini in basso'],
    ['vdots', '⋮', 'Puntini verticali'],
    ['ddots', '⋱', 'Puntini diagonali'],
    ['sin', 'sin', 'Seno'],
    ['cos', 'cos', 'Coseno'],
    ['tan', 'tan', 'Tangente'],
    ['arcsin', 'arcsin', 'Arcoseno'],
    ['arctan', 'arctan', 'Arcotangente'],
    ['log', 'log', 'Logaritmo'],
    ['ln', 'ln', 'Logaritmo naturale'],
    ['exp', 'exp', 'Esponenziale'],
    ['max', 'max', 'Massimo'],
    ['min', 'min', 'Minimo'],
    ['sup', 'sup', 'Estremo superiore'],
    ['inf', 'inf', 'Estremo inferiore'],
    ['det', 'det', 'Determinante'],
    ['gcd', 'gcd', 'Massimo comun divisore'],
  ]),
];

const greek: LatexCommand[] = simple('greek', [
  ['alpha', 'α', 'Alfa'],
  ['beta', 'β', 'Beta'],
  ['gamma', 'γ', 'Gamma'],
  ['delta', 'δ', 'Delta'],
  ['epsilon', 'ε', 'Epsilon'],
  ['varepsilon', 'ɛ', 'Epsilon (variante)'],
  ['zeta', 'ζ', 'Zeta'],
  ['eta', 'η', 'Eta'],
  ['theta', 'θ', 'Theta'],
  ['vartheta', 'ϑ', 'Theta (variante)'],
  ['iota', 'ι', 'Iota'],
  ['kappa', 'κ', 'Kappa'],
  ['lambda', 'λ', 'Lambda'],
  ['mu', 'μ', 'Mu'],
  ['nu', 'ν', 'Nu'],
  ['xi', 'ξ', 'Xi'],
  ['pi', 'π', 'Pi greco'],
  ['rho', 'ρ', 'Rho'],
  ['sigma', 'σ', 'Sigma'],
  ['tau', 'τ', 'Tau'],
  ['upsilon', 'υ', 'Upsilon'],
  ['phi', 'ϕ', 'Phi'],
  ['varphi', 'φ', 'Phi (variante)'],
  ['chi', 'χ', 'Chi'],
  ['psi', 'ψ', 'Psi'],
  ['omega', 'ω', 'Omega'],
  ['Gamma', 'Γ', 'Gamma maiuscola'],
  ['Delta', 'Δ', 'Delta maiuscola'],
  ['Theta', 'Θ', 'Theta maiuscola'],
  ['Lambda', 'Λ', 'Lambda maiuscola'],
  ['Xi', 'Ξ', 'Xi maiuscola'],
  ['Pi', 'Π', 'Pi maiuscola'],
  ['Sigma', 'Σ', 'Sigma maiuscola'],
  ['Upsilon', 'Υ', 'Upsilon maiuscola'],
  ['Phi', 'Φ', 'Phi maiuscola'],
  ['Psi', 'Ψ', 'Psi maiuscola'],
  ['Omega', 'Ω', 'Omega maiuscola'],
]);

const relations: LatexCommand[] = simple('relations', [
  ['leq', '≤', 'Minore o uguale'],
  ['geq', '≥', 'Maggiore o uguale'],
  ['neq', '≠', 'Diverso'],
  ['approx', '≈', 'Approssimativamente uguale'],
  ['equiv', '≡', 'Equivalente'],
  ['sim', '∼', 'Simile'],
  ['simeq', '≃', 'Asintoticamente uguale'],
  ['cong', '≅', 'Congruente'],
  ['propto', '∝', 'Proporzionale'],
  ['ll', '≪', 'Molto minore'],
  ['gg', '≫', 'Molto maggiore'],
  ['prec', '≺', 'Precede'],
  ['succ', '≻', 'Segue'],
  ['perp', '⊥', 'Perpendicolare'],
  ['parallel', '∥', 'Parallelo'],
  ['mid', '∣', 'Divide'],
  ['vdash', '⊢', 'Deriva'],
  ['models', '⊨', 'Modello di'],
]);

const arrows: LatexCommand[] = simple('arrows', [
  ['to', '→', 'Freccia (tende a)'],
  ['rightarrow', '→', 'Freccia a destra'],
  ['leftarrow', '←', 'Freccia a sinistra'],
  ['leftrightarrow', '↔', 'Freccia bidirezionale'],
  ['Rightarrow', '⇒', 'Implica'],
  ['Leftarrow', '⇐', 'È implicato da'],
  ['Leftrightarrow', '⇔', 'Se e solo se'],
  ['implies', '⟹', 'Implica (lunga)'],
  ['iff', '⟺', 'Se e solo se (lunga)'],
  ['mapsto', '↦', 'Manda in'],
  ['longrightarrow', '⟶', 'Freccia lunga a destra'],
  ['longleftarrow', '⟵', 'Freccia lunga a sinistra'],
  ['hookrightarrow', '↪', 'Inclusione'],
  ['uparrow', '↑', 'Freccia in su'],
  ['downarrow', '↓', 'Freccia in giù'],
  ['rightleftharpoons', '⇌', 'Equilibrio'],
  ['nearrow', '↗', 'Freccia in alto a destra'],
  ['searrow', '↘', 'Freccia in basso a destra'],
]);

const sets: LatexCommand[] = [
  entry('sets', 'mathbbR', 'ℝ', 'Numeri reali', '\\mathbb{R}'),
  entry('sets', 'mathbbN', 'ℕ', 'Numeri naturali', '\\mathbb{N}'),
  entry('sets', 'mathbbZ', 'ℤ', 'Numeri interi', '\\mathbb{Z}'),
  entry('sets', 'mathbbQ', 'ℚ', 'Numeri razionali', '\\mathbb{Q}'),
  entry('sets', 'mathbbC', 'ℂ', 'Numeri complessi', '\\mathbb{C}'),
  ...simple('sets', [
    ['in', '∈', 'Appartiene a'],
    ['notin', '∉', 'Non appartiene a'],
    ['ni', '∋', 'Contiene come elemento'],
    ['subset', '⊂', 'Sottoinsieme'],
    ['subseteq', '⊆', 'Sottoinsieme o uguale'],
    ['supset', '⊃', 'Sovrainsieme'],
    ['supseteq', '⊇', 'Sovrainsieme o uguale'],
    ['cup', '∪', 'Unione'],
    ['cap', '∩', 'Intersezione'],
    ['setminus', '∖', 'Differenza di insiemi'],
    ['emptyset', '∅', 'Insieme vuoto'],
    ['forall', '∀', 'Per ogni'],
    ['exists', '∃', 'Esiste'],
    ['nexists', '∄', 'Non esiste'],
    ['neg', '¬', 'Negazione'],
    ['land', '∧', 'E logico'],
    ['lor', '∨', 'O logico'],
    ['therefore', '∴', 'Quindi'],
    ['because', '∵', 'Poiché'],
    ['aleph', 'ℵ', 'Aleph'],
    ['hbar', 'ℏ', 'h tagliato'],
    ['ell', 'ℓ', 'L corsiva'],
  ]),
];

export const LATEX_COMMANDS: LatexCommand[] = [
  ...structures,
  ...operators,
  ...greek,
  ...relations,
  ...arrows,
  ...sets,
];

export function commandsOfGroup(group: PaletteGroup): LatexCommand[] {
  return LATEX_COMMANDS.filter((command) => command.group === group);
}

/** Quanti suggerimenti mostrare al massimo. */
const MAX_SUGGESTIONS = 6;

/** Comandi che iniziano con `prefix` (prima) o lo contengono (dopo), nell'ordine del catalogo. */
export function searchCommands(prefix: string): LatexCommand[] {
  const needle = prefix.toLowerCase();
  if (!needle) return [];
  const keyOf = (command: LatexCommand) => command.key.toLowerCase();
  const exact = LATEX_COMMANDS.filter((command) => keyOf(command) === needle);
  const starts = LATEX_COMMANDS.filter((command) => keyOf(command) !== needle && keyOf(command).startsWith(needle));
  const contains = LATEX_COMMANDS.filter((command) => !keyOf(command).startsWith(needle) && keyOf(command).includes(needle));
  return [...exact, ...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

/** Testo da inserire e posizione del cursore (offset dall'inizio dello snippet). */
export function parseSnippet(snippet: string): { text: string; caret: number } {
  const marker = snippet.indexOf(CARET);
  if (marker >= 0) return { text: snippet.replace(CARET, ''), caret: marker };
  const brace = snippet.indexOf('{');
  return { text: snippet, caret: brace >= 0 ? brace + 1 : snippet.length };
}
