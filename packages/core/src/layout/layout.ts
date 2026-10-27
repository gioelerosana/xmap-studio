import { relationshipGeometry } from './relationship.js';
import { SheetDto, SheetTheme, TextStyle, ThemeLevel, ThemeLevelStyle, TitleRun, TopicView } from '../state/types.js';
import { renderLatexToSvg } from '../latex/mathjax.js';
import { splitInlineMath } from '../latex/inline.js';
import { inlineMathFontSize, titleBaseFontPx, TITLE_LEADING_RATIO } from '../latex/size.js';
import { parseRange } from '../model/utils.js';
import {
  BRANCH_COLORS,
  Layout,
  LayoutOpts,
  LayoutSummary,
  EdgeKind,
  MapNode,
  MapSummary,
  NodeMetrics,
  SUMMARY_BRACE_W,
  TREE_RIGHT_STRUCTURE,
  trunkX,
} from './types.js';

/**
 * Larghezza in px di `text` a `fontSizePx`, grassetto o no, con il font `family`
 * del tema (prima scelta, la UI ricade sul font della mappa) o quello della mappa.
 */
export type TextMeasurer = (text: string, fontSizePx: number, bold: boolean, family?: string) => number;

let textMeasurer: TextMeasurer | null = null;

/**
 * La UI può fornire una misura reale del testo (es. canvas `measureText` con il font
 * della mappa), così i blocchi si adattano esattamente al testo; senza, si usa la
 * stima a tabella qui sotto (test, export senza display).
 */
export function setTextMeasurer(measurer: TextMeasurer | null): void {
  textMeasurer = measurer;
}

/** Margine (px) sotto la larghezza utile: il browser arrotonda i sub-pixel, meglio andare a capo un po' prima. */
const LINE_FIT_MARGIN = 1.0;
/** Spazio verticale sopra e sotto una formula display (`my-0.5` per lato, più il margine). */
const DISPLAY_MATH_GAP = 4.0;
/** Riserva verticale che una formula inline aggiunge alla riga in cui si trova. */
const INLINE_MATH_GAP = 4.0;
/** Larghezza aggiunta a ogni formula, come margine del contenitore SVG. */
const MATH_SIDE_PAD = 2.0;
/** Il sorgente di una formula non renderizzabile si mostra in monospace a 0.85em. */
const RAW_SOURCE_SCALE = 0.85;
/** Altezza di riga oltre la dimensione del font, per le righe con caratteri più grandi. */
const LINE_HEIGHT_EXTRA = 1;

/**
 * Stima della larghezza di un singolo carattere in font proporzionale sans-serif
 * (Inter / sistema) in base alla dimensione del carattere e all'eventuale grassetto.
 */
function heuristicCharWidth(ch: string, fontSize: number, bold: boolean): number {
  const code = ch.charCodeAt(0);
  let factor = 0.55;
  if (/[ijlI1|!.,:;'" ()\[\]{}t\-]/.test(ch)) {
    factor = 0.28;
  } else if ('frksJ'.includes(ch)) {
    factor = 0.42;
  } else if ('mwMW%@&_#+='.includes(ch)) {
    factor = 0.85;
  } else if (code >= 0x4e00 && code <= 0x9fff) {
    // Ideogrammi CJK
    factor = 1.0;
  } else if (code >= 0x2000 && code <= 0x206f) {
    // Punteggiatura generale
    factor = 0.35;
  }
  if (bold) factor *= 1.08;
  return fontSize * factor;
}

/** Larghezza di `text` con lo stile dato: misura della UI se installata, altrimenti stima. */
function measureText(text: string, fontSize: number, bold: boolean, family?: string): number {
  if (textMeasurer) return textMeasurer(text, fontSize, bold, family);
  let sum = 0;
  for (const ch of text) sum += heuristicCharWidth(ch, fontSize, bold);
  return sum;
}

/** Unità indivisibile del titolo: un carattere con il suo stile, oppure una formula MathJax. */
type TitleCell =
  | { kind: 'char'; ch: string; size: number; bold: boolean; family?: string }
  | { kind: 'math'; width: number; height: number; display: boolean };

/** Stile di base del blocco: dimensione e grassetto del testo, altezza minima di riga. */
interface TitleBase {
  size: number;
  bold: boolean;
  lineH: number;
  family?: string;
}

/** Riga del titolo già misurata. */
interface LineBox {
  width: number;
  height: number;
}

function charCells(source: string, size: number, bold: boolean, family?: string): TitleCell[] {
  return [...source].map((ch): TitleCell => ({ kind: 'char', ch, size, bold, family }));
}

/**
 * Formula come la rende RichTitle: l'SVG MathJax a `inlineMathFontSize`. Se non si
 * renderizza, la UI mostra il sorgente `$…$`, quindi lo si misura come testo.
 */
function mathCells(latex: string, size: number, display: boolean): TitleCell[] {
  try {
    const rendered = renderLatexToSvg(latex, inlineMathFontSize(size), display);
    if (!rendered.error) {
      return [{ kind: 'math', width: rendered.width + MATH_SIDE_PAD, height: rendered.height, display }];
    }
  } catch {
    // LaTeX non valido: si ricade sul sorgente, misurato qui sotto.
  }
  const delimiter = display ? '$$' : '$';
  return charCells(`${delimiter}${latex}${delimiter}`, size * RAW_SOURCE_SCALE, false);
}

/** Celle di un frammento di testo (con eventuali formule `$…$` / `$$…$$`), nello stile dato. */
function partCells(source: string, size: number, bold: boolean, family?: string): TitleCell[] {
  if (!source.includes('$')) return charCells(source, size, bold, family);
  return splitInlineMath(source).flatMap((seg) =>
    seg.kind === 'text' ? charCells(seg.value, size, bold, family) : mathCells(seg.value, size, seg.display ?? false)
  );
}

/**
 * Celle del titolo nell'ordine di rendering. I `runs` si usano solo se coincidono
 * con il testo: ogni run tiene il proprio grassetto e la propria dimensione, come in RichTitle.
 */
function titleCells(text: string, base: TitleBase, runs?: TitleRun[]): TitleCell[] {
  if (!runs || runs.length === 0 || runs.map((r) => r.text).join('') !== text) {
    return partCells(text, base.size, base.bold, base.family);
  }
  return runs.flatMap((run) =>
    partCells(run.text, run.fontSizePx ?? base.size, run.bold ?? base.bold, base.family)
  );
}

/** Larghezza di una sequenza di celle: i caratteri consecutivi con lo stesso stile si misurano insieme. */
function measureCells(cells: readonly TitleCell[]): number {
  let width = 0;
  let index = 0;
  while (index < cells.length) {
    const cell = cells[index];
    if (cell.kind === 'math') {
      width += cell.width;
      index++;
      continue;
    }
    let chunk = '';
    while (index < cells.length) {
      const next = cells[index];
      if (next.kind !== 'char' || next.size !== cell.size || next.bold !== cell.bold || next.family !== cell.family) {
        break;
      }
      chunk += next.ch;
      index++;
    }
    width += measureText(chunk, cell.size, cell.bold, cell.family);
  }
  return width;
}

function isSpace(cell: TitleCell): boolean {
  return cell.kind === 'char' && cell.ch === ' ';
}

/** Parola di un paragrafo e lo spazio che la separa dalla precedente (vuoto dopo un trattino). */
interface TitleWord {
  cells: TitleCell[];
  gap: TitleCell[];
}

/**
 * Divide un paragrafo in parole. Il browser va a capo anche dopo un trattino seguito
 * da testo, e in quel caso non c'è spazio da contare.
 */
function splitWords(cells: TitleCell[]): TitleWord[] {
  const words: TitleWord[] = [];
  let word: TitleCell[] = [];
  let gap: TitleCell[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (isSpace(cell)) {
      if (word.length > 0) {
        words.push({ cells: word, gap });
        word = [];
        gap = [];
      }
      gap.push(cell);
      continue;
    }
    word.push(cell);
    const next = cells[i + 1];
    if (cell.kind === 'char' && cell.ch === '-' && next !== undefined && !isSpace(next)) {
      words.push({ cells: word, gap });
      word = [];
      gap = [];
    }
  }
  if (word.length > 0) words.push({ cells: word, gap });
  return words;
}

/** Stato della riga in costruzione: larghezza, stile più grande e formula più alta che contiene. */
interface LineState {
  width: number;
  size: number;
  mathH: number;
  hasWord: boolean;
}

const EMPTY_LINE: LineState = { width: 0, size: 0, mathH: 0, hasWord: false };

function appendCells(line: LineState, cells: TitleCell[], width: number): LineState {
  let size = line.size;
  let mathH = line.mathH;
  for (const cell of cells) {
    if (cell.kind === 'char') size = Math.max(size, cell.size);
    else mathH = Math.max(mathH, cell.height);
  }
  return { width: line.width + width, size, mathH, hasWord: true };
}

/**
 * Altezza della riga: il minimo del blocco, o quanto serve al carattere più grande
 * (leading-snug del browser), o la formula inline più alta con la sua riserva.
 */
function lineHeight(line: LineState, base: TitleBase): number {
  const fontH = line.size > 0 ? Math.round(line.size * TITLE_LEADING_RATIO) + LINE_HEIGHT_EXTRA : 0;
  const mathH = line.mathH > 0 ? line.mathH + INLINE_MATH_GAP : 0;
  return Math.max(base.lineH, fontH, mathH);
}

/**
 * Righe di un paragrafo: a parole, e spezzato a caratteri se una parola è più larga
 * della riga (break-words). Restituisce sempre almeno una riga.
 */
function wrapParagraph(cells: TitleCell[], usableW: number, base: TitleBase): LineBox[] {
  const limit = usableW - LINE_FIT_MARGIN;
  const done: LineState[] = [];
  let line = EMPTY_LINE;

  for (const word of splitWords(cells)) {
    const wordW = measureCells(word.cells);
    const gapW = measureCells(word.gap);
    if (line.hasWord && line.width + gapW + wordW <= limit) {
      line = appendCells(line, word.cells, gapW + wordW);
      continue;
    }
    if (line.hasWord) {
      done.push(line);
      line = EMPTY_LINE;
    }
    if (wordW <= limit) {
      line = appendCells(line, word.cells, wordW);
      continue;
    }
    for (const cell of word.cells) {
      const cellW = measureCells([cell]);
      if (line.hasWord && line.width + cellW > limit) {
        done.push(line);
        line = EMPTY_LINE;
      }
      line = appendCells(line, [cell], cellW);
    }
  }
  done.push(line);
  return done.map((l) => ({ width: l.width, height: lineHeight(l, base) }));
}

/**
 * Paragrafi separati dagli a capo. L'ultimo a capo non apre una riga vuota, come nel browser.
 */
function splitParagraphs(cells: TitleCell[]): TitleCell[][] {
  const paragraphs: TitleCell[][] = [[]];
  for (const cell of cells) {
    if (cell.kind === 'char' && cell.ch === '\n') paragraphs.push([]);
    else paragraphs[paragraphs.length - 1].push(cell);
  }
  if (paragraphs[paragraphs.length - 1].length === 0) paragraphs.pop();
  return paragraphs;
}

function wrapTextChunk(cells: TitleCell[], usableW: number, base: TitleBase): LineBox[] {
  return splitParagraphs(cells).flatMap((paragraph) => wrapParagraph(paragraph, usableW, base));
}

/**
 * Righe del titolo. Le formule display (`$$…$$`) occupano una riga propria, come
 * blocchi in RichTitle: il testo prima e dopo di loro va a capo a parte.
 */
function wrapTitle(cells: TitleCell[], usableW: number, base: TitleBase): LineBox[] {
  const lines: LineBox[] = [];
  let chunk: TitleCell[] = [];
  for (const cell of cells) {
    if (cell.kind === 'math' && cell.display) {
      lines.push(...wrapTextChunk(chunk, usableW, base));
      chunk = [];
      lines.push({ width: cell.width, height: cell.height + DISPLAY_MATH_GAP });
    } else {
      chunk.push(cell);
    }
  }
  lines.push(...wrapTextChunk(chunk, usableW, base));
  return lines.length > 0 ? lines : [{ width: 0, height: base.lineH }];
}

export function estimateNodeSize(
  node: {
    depth: number;
    kind?: string;
    latex?: string;
    title?: string;
    displayTitle?: string;
    textStyle?: TextStyle;
    titleRuns?: TitleRun[];
    fontFamily?: string;
    hasNotes?: boolean;
    markers?: string[];
    labels?: string[];
    imageW?: number;
    imageH?: number;
    customWidth?: number;
  },
  overrideWidth?: number | null
): { w: number; h: number } {
  // 1. Formule LaTeX native (MathJax): il blocco misura la formula come la si disegna
  // (stessa scala delle formule nel testo), non l'immagine PNG salvata nel file.
  const effectiveLatex = node.latex;
  if (effectiveLatex) {
    try {
      const rendered = renderLatexToSvg(
        effectiveLatex,
        inlineMathFontSize(titleBaseFontPx(node.depth, node.textStyle))
      );
      if (!rendered.error) {
        const fw = Math.max(rendered.width + 36.0, 96.0);
        let fh = Math.max(rendered.height + 22.0, 38.0);
        if (
          node.hasNotes ||
          (node.markers && node.markers.length > 0) ||
          (node.labels && node.labels.length > 0)
        ) {
          fh += 18.0;
        }
        return { w: Math.min(fw, 650.0), h: Math.max(32.0, fh) };
      }
    } catch {}
  }

  // 2. Immagini con dimensioni note
  const imgW = node.imageW;
  const imgH = node.imageH;
  if (imgW !== undefined && imgH !== undefined) {
    const maxW = node.kind === 'equation' || node.latex ? 650.0 : 800.0;
    const scale = imgW > maxW ? maxW / imgW : 1.0;
    const fw = imgW * scale + 24.0;
    let fh = imgH * scale + 18.0;
    if (
      node.hasNotes ||
      (node.markers && node.markers.length > 0) ||
      (node.labels && node.labels.length > 0)
    ) {
      fh += 18.0;
    }
    return { w: Math.max(72.0, fw), h: Math.max(32.0, fh) };
  }
  if (node.kind === 'image') {
    const fw = 200.0 + 24.0;
    let fh = 150.0 + 18.0;
    if (
      node.hasNotes ||
      (node.markers && node.markers.length > 0) ||
      (node.labels && node.labels.length > 0)
    ) {
      fh += 18.0;
    }
    return { w: Math.max(72.0, fw), h: Math.max(32.0, fh) };
  }

  // 3. Testo ordinario
  const text = node.displayTitle || node.title || '';
  const isRoot = node.depth === 0;
  const isBranch = node.depth === 1;
  const baseFontSize = titleBaseFontPx(node.depth, node.textStyle);
  const baseBold = node.textStyle?.bold ?? (isRoot || isBranch);
  const base: TitleBase = {
    size: baseFontSize,
    bold: baseBold,
    lineH: isRoot ? 20.0 : 18.0,
    family: node.fontFamily,
  };

  const padX = isRoot ? 24.0 : 18.0;
  const noteW = node.hasNotes ? 20.0 : 0.0;
  const targetCustomWidth = overrideWidth !== undefined ? overrideWidth : node.customWidth;
  const hasCustom =
    targetCustomWidth !== null && targetCustomWidth !== undefined && targetCustomWidth > 0;

  let usableW: number;
  if (hasCustom) {
    usableW = Math.max(targetCustomWidth - padX - noteW, 20.0);
  } else {
    // Senza customWidth: limite massimo di 360 px prima di mandare a capo
    const maxBlockW = 360.0;
    usableW = Math.max(maxBlockW - padX - noteW, 20.0);
  }

  const lines = wrapTitle(titleCells(text, base, node.titleRuns), usableW, base);
  const maxLineWidth = lines.reduce((max, line) => Math.max(max, line.width), 0);
  const textH = lines.reduce((sum, line) => sum + line.height, 0);

  let w: number;
  if (hasCustom) {
    w = Math.max(40.0, targetCustomWidth);
  } else {
    // Default = adattamento perfetto al testo (nessuno spazio vuoto).
    // Per righe multiple, il blocco è largo quanto la riga più lunga (+ padding), non quanto il massimo.
    w = maxLineWidth + padX + noteW + 2.0;
    let badgesW = 0;
    if (node.markers && node.markers.length > 0) badgesW += node.markers.length * 20;
    if (node.labels && node.labels.length > 0) badgesW += node.labels.length * 32;
    if (badgesW > 0) {
      w = Math.max(w, badgesW + padX);
    }
    w = Math.max(40.0, Math.min(w, 360.0));
  }

  // Altezza = somma delle righe (ciascuna con il proprio font e le proprie formule) più il padding.
  let h = Math.max(textH + 16.0, 36.0);
  if ((node.markers && node.markers.length > 0) || (node.labels && node.labels.length > 0)) {
    h += 16.0;
  }

  return { w: Math.round(w), h: Math.round(h) };
}

export class EstimatedMetrics implements NodeMetrics {
  measure(node: MapNode): { w: number; h: number } {
    return estimateNodeSize(node);
  }
}

export const DEFAULT_LAYOUT_OPTS: LayoutOpts = {
  hGap: 50.0,
  vGap: 16.0,
  sheetGap: 80.0,
};

export function buildSheetTrees(sheet: SheetDto): { trees: MapNode[]; floating: MapNode[] } {
  const childrenMap = new Map<string, TopicView[]>();
  const roots: TopicView[] = [];
  const floating: TopicView[] = [];

  for (const t of sheet.topics) {
    if (t.group === 'detached') {
      floating.push(t);
    } else if (t.parentId) {
      const list = childrenMap.get(t.parentId) || [];
      list.push(t);
      childrenMap.set(t.parentId, list);
    } else {
      roots.push(t);
    }
  }

  if (roots.length === 0 && sheet.topics.length > 0) {
    roots.push(sheet.topics[0]);
  }

  const theme = sheet.theme;
  const trees = roots.map((r) => buildNodeRecursive(r, childrenMap, theme));
  const floatingNodes = floating.map((f) => buildNodeRecursive(f, childrenMap, theme));

  return { trees, floating: floatingNodes };
}

type Size = { w: number; h: number };
type Sizes = Map<string, Size>;

/** Distanza fra la colonna dei figli di una Tree Chart e il tronco. */
const TREE_STUB = 30.0;
/** Spazio fra il blocco radice e il primo ramo di una Tree Chart. */
const TREE_TOP_GAP = 26.0;
const SUMMARY_GAP_BEFORE = 16.0;
const SUMMARY_GAP_AFTER = 22.0;
/** Distanza orizzontale fra il bordo destro dei figli raccolti e il topic di sommario. */
const SUMMARY_OFFSET = SUMMARY_GAP_BEFORE + SUMMARY_BRACE_W + SUMMARY_GAP_AFTER;

function isTreeRight(structureClass?: string): boolean {
  return structureClass === TREE_RIGHT_STRUCTURE;
}

/** px per pt (1pt = 4/3 px). */
const PX_PER_PT = 4 / 3;

/**
 * Livello di stile del tema per un blocco: radice, rami principali, il resto.
 * I blocchi liberi e i sommari (stili `floatingTopic`/`summaryTopic`, non
 * modificati dall'editor) restano allo stile dell'app; i loro figli sono sub.
 */
function themeLevelOf(topic: TopicView): ThemeLevel | undefined {
  if (topic.depth === 0) return 'central';
  if (topic.group === 'detached' || topic.group === 'summary') return undefined;
  return topic.depth === 1 ? 'main' : 'sub';
}

/** Stile del testo del tema sotto quello del blocco: vince sempre il blocco. */
function withThemeText(own: TextStyle | undefined, level: ThemeLevelStyle | undefined): TextStyle | undefined {
  if (!level) return own;
  const fromTheme: TextStyle = {};
  if (level.fontSizePt !== undefined) fromTheme.fontSizePx = level.fontSizePt * PX_PER_PT;
  if (level.bold !== undefined) fromTheme.bold = level.bold;
  if (level.italic !== undefined) fromTheme.italic = level.italic;
  const merged = { ...fromTheme, ...own };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function buildNodeRecursive(
  topic: TopicView,
  childrenMap: Map<string, TopicView[]>,
  theme: SheetTheme | undefined,
  branchAccent?: string
): MapNode {
  const level = themeLevelOf(topic);
  const themeStyle = level ? theme?.levels[level] : undefined;
  const palette = theme?.branchColors ?? BRANCH_COLORS;
  // Il fill appartiene solo al topic che lo dichiara (o al suo livello del
  // tema); ciò che si eredita è l'accento del ramo, usato da connettori e decorazioni.
  const explicitFill = topic.fillColor ?? themeStyle?.fill;
  const accent = topic.fillColor || branchAccent;

  const rawChildren = childrenMap.get(topic.id) || [];
  const children: MapNode[] = [];
  const summaryTopics: MapNode[] = [];
  rawChildren.forEach((c, i) => {
    const childBranch =
      topic.depth === 0 && !c.fillColor ? palette[i % palette.length] : accent;
    const node = buildNodeRecursive(c, childrenMap, theme, childBranch);
    if (c.group === 'summary') {
      summaryTopics.push(node);
    } else {
      children.push(node);
    }
  });

  // Senza descrittore valido il sommario abbraccia l'intera colonna.
  const last = Math.max(children.length - 1, 0);
  const summaries: MapSummary[] = summaryTopics.map((node) => {
    const parsed = parseRange(topic.summaries.find((s) => s.id === node.id)?.range);
    const [start, end] = parsed ? [Math.min(parsed[0], last), Math.min(parsed[1], last)] : [0, last];
    return { start, end, node };
  });

  const effectiveLatex = topic.latex;

  return {
    id: topic.id,
    title: topic.title,
    displayTitle: topic.displayTitle,
    kind: effectiveLatex ? 'equation' : topic.kind,
    latex: effectiveLatex,
    fillColor: explicitFill,
    accent,
    imageSrc: topic.imageSrc,
    imageW: topic.imageW,
    imageH: topic.imageH,
    labels: topic.labels,
    markers: topic.markers,
    hasNotes: topic.notes.length > 0,
    notes: topic.notes,
    childCount: Math.max(topic.childCount, children.length + summaries.length),
    group: topic.group,
    depth: topic.depth,
    parentId: topic.parentId,
    sheetIndex: topic.sheetIndex,
    position: topic.position,
    customWidth: topic.customWidth,
    structureClass: topic.structureClass,
    textStyle: withThemeText(topic.textStyle, themeStyle),
    titleRuns: topic.titleRuns,
    fontFamily: themeStyle?.fontFamily,
    shape: themeStyle?.shape,
    themeTextColor: themeStyle?.textColor,
    branchLine: themeStyle?.line,
    branchLineWidth: themeStyle?.lineWidthPt !== undefined ? themeStyle.lineWidthPt * PX_PER_PT : undefined,
    children,
    summaries,
  };
}

export function layoutSheets(
  sheets: SheetDto[],
  collapsed: Set<string> = new Set(),
  metrics: NodeMetrics = new EstimatedMetrics(),
  opts: LayoutOpts = DEFAULT_LAYOUT_OPTS
): Layout {
  const out: Layout = {
    nodes: [],
    edges: [],
    summaries: [],
    relationships: [],
    width: 0,
    height: 0,
  };

  const left = 20.0;
  let top = 20.0;

  for (const sheet of sheets) {
    const { trees, floating } = buildSheetTrees(sheet);
    const sheetFirstNode = out.nodes.length;

    for (const tree of trees) {
      const sizes: Sizes = new Map();
      computeSizes(tree, collapsed, metrics, opts, sizes);
      const ctx: PlaceCtx = { collapsed, metrics, opts, sizes };

      let totalH: number;
      const asTree = opts.structure ? opts.structure === 'tree' : isTreeRight(tree.structureClass);
      if (asTree) {
        totalH = placeTreeRoot(tree, left, top, ctx, out);
      } else {
        placeSubtree(tree, left, top, undefined, ctx, out);
        totalH = sizes.get(tree.id)?.h ?? 0.0;
      }
      top += totalH + opts.sheetGap;
    }

    // Posizionamento dei topic liberi (detached)
    if (floating.length > 0) {
      const maxTreeX = out.nodes.reduce((max, n) => Math.max(max, n.x + n.w), 20.0);
      let floatYCursor = 20.0;
      const rootNode = out.nodes[sheetFirstNode];
      const rootCenter = rootNode
        ? { x: rootNode.x + rootNode.w / 2.0, y: rootNode.y + rootNode.h / 2.0 }
        : undefined;

      for (const floatNode of floating) {
        const floatSizes: Sizes = new Map();
        computeSizes(floatNode, collapsed, metrics, opts, floatSizes);
        const fMeasure = metrics.measure(floatNode);
        const floatSubH = floatSizes.get(floatNode.id)?.h ?? fMeasure.h;

        // Cerca relationship associata
        const relatedTarget = sheet.relationships.find(
          (rel) => rel.end2Id === floatNode.id || rel.end1Id === floatNode.id
        );
        const targetNode = relatedTarget
          ? out.nodes.find(
              (n) =>
                n.id ===
                (relatedTarget.end2Id === floatNode.id
                  ? relatedTarget.end1Id
                  : relatedTarget.end2Id)
            )
          : undefined;

        const positioned = floatNode.position !== undefined && rootCenter !== undefined;
        let fx: number;
        let fy: number;

        if (floatNode.position && rootCenter) {
          // `position` è il centro del topic relativo al centro della radice (XMind).
          const m = fMeasure;
          fx = rootCenter.x + floatNode.position.x - m.w / 2.0;
          fy = rootCenter.y + floatNode.position.y - m.h / 2.0 - (floatSubH - m.h) / 2.0;
        } else if (targetNode) {
          fx = Math.max(maxTreeX + 80.0, targetNode.x + targetNode.w + 60.0);
          const idealY = targetNode.y + (targetNode.h - floatSubH) / 2.0;
          fy = Math.max(idealY, floatYCursor);
        } else {
          fx = maxTreeX + 80.0;
          fy = floatYCursor;
        }

        if (!positioned) floatYCursor = fy + floatSubH + opts.vGap;
        const floatIdx = placeSubtree(
          floatNode,
          fx,
          fy,
          undefined,
          { collapsed, metrics, opts, sizes: floatSizes },
          out
        );
        out.nodes[floatIdx].floating = true;
        if (rootCenter) out.nodes[floatIdx].floatOrigin = { ...rootCenter };
      }
    }
  }

  // I topic liberi possono cadere a sinistra/sopra la radice: riporta tutto in positivo.
  const minX = out.nodes.reduce((min, n) => Math.min(min, n.x), Infinity);
  const minY = out.nodes.reduce((min, n) => Math.min(min, n.y), Infinity);
  const dx = out.nodes.length > 0 && minX < left ? left - minX : 0;
  const dy = out.nodes.length > 0 && minY < 20.0 ? 20.0 - minY : 0;
  if (dx !== 0 || dy !== 0) {
    for (const n of out.nodes) {
      n.x += dx;
      n.y += dy;
      if (n.floatOrigin) n.floatOrigin = { x: n.floatOrigin.x + dx, y: n.floatOrigin.y + dy };
    }
    for (const sm of out.summaries) {
      sm.x += dx;
      sm.y1 += dy;
      sm.y2 += dy;
    }
  }

  // Risoluzione relationships dopo l'eventuale traslazione dei topic liberi.
  for (const sheet of sheets) {
    for (const rel of sheet.relationships) {
      const fromIdx = out.nodes.findIndex((n) => n.id === rel.end1Id);
      const toIdx = out.nodes.findIndex((n) => n.id === rel.end2Id);
      if (fromIdx === -1 || toIdx === -1) continue;
      const accent = out.nodes[fromIdx].accent || out.nodes[toIdx].accent;
      out.relationships.push({
        id: rel.id,
        title: rel.title ? rel.title : undefined,
        from: fromIdx,
        to: toIdx,
        accent,
        style: rel.style,
        controlPoints: rel.controlPoints,
        geometry: relationshipGeometry(out.nodes[fromIdx], out.nodes[toIdx], rel.style, rel.controlPoints),
      });
    }
  }

  if (out.nodes.length > 0) {
    const maxX = out.nodes.reduce((max, n) => Math.max(max, n.x + n.w), 0);
    const maxY = out.nodes.reduce((max, n) => Math.max(max, n.y + n.h), 0);
    out.width = maxX + 40.0;
    out.height = maxY + 40.0;
  }

  return out;
}

function pushLayoutNode(
  out: Layout,
  node: MapNode,
  x: number,
  y: number,
  w: number,
  h: number,
  collapsed: boolean,
  childrenBelow: boolean
): number {
  const index = out.nodes.length;
  out.nodes.push({
    id: node.id,
    title: node.title,
    displayTitle: node.displayTitle,
    x,
    y,
    w,
    h,
    kind: node.kind,
    latex: node.latex,
    fill: node.fillColor,
    accent: node.accent,
    imageSrc: node.imageSrc,
    imageW: node.imageW,
    imageH: node.imageH,
    labels: node.labels,
    markers: node.markers,
    hasNotes: node.hasNotes,
    childCount: node.childCount,
    collapsed,
    group: node.group,
    depth: node.depth,
    sheetIndex: node.sheetIndex,
    position: node.position,
    customWidth: node.customWidth,
    textStyle: node.textStyle,
    titleRuns: node.titleRuns,
    fontFamily: node.fontFamily,
    shape: node.shape,
    themeTextColor: node.themeTextColor,
    branchLine: node.branchLine,
    branchLineWidth: node.branchLineWidth,
    childrenBelow,
  });
  return index;
}

/**
 * Colonna dei figli: offset verticale di ciascun figlio rispetto alla cima e
 * altezza totale. Se un sommario è più alto dei figli che raccoglie, la colonna
 * si allarga attorno all'intervallo così che non invada i fratelli vicini.
 */
interface Column {
  tops: number[];
  height: number;
}

function column(node: MapNode, sizes: Sizes, opts: LayoutOpts): Column {
  const n = node.children.length;
  const childH = (i: number): number => sizes.get(node.children[i].id)?.h ?? 0.0;
  const padBefore = new Array<number>(n).fill(0);
  const padAfter = new Array<number>(n).fill(0);

  for (const s of node.summaries) {
    if (s.end >= n) continue;
    let rangeH = opts.vGap * (s.end - s.start);
    for (let i = s.start; i <= s.end; i++) rangeH += childH(i);
    const sumH = sizes.get(s.node.id)?.h ?? 0.0;
    if (sumH > rangeH) {
      const extra = (sumH - rangeH) / 2.0;
      padBefore[s.start] = Math.max(padBefore[s.start], extra);
      padAfter[s.end] = Math.max(padAfter[s.end], extra);
    }
  }

  const tops: number[] = [];
  let cur = 0.0;
  for (let i = 0; i < n; i++) {
    if (i > 0) cur += opts.vGap;
    cur += padBefore[i];
    tops.push(cur);
    cur += childH(i) + padAfter[i];
  }
  return { tops, height: cur };
}

function maxWidth(nodes: MapNode[], sizes: Sizes): number {
  return nodes.reduce((max, c) => Math.max(max, sizes.get(c.id)?.w ?? 0.0), 0.0);
}

/** Larghezza occupata a destra della colonna dei figli, sommari compresi. */
function columnWidth(node: MapNode, sizes: Sizes): number {
  let width = maxWidth(node.children, sizes);
  for (const s of node.summaries) {
    const rangeW = maxWidth(node.children.slice(s.start, s.end + 1), sizes);
    const summaryW = sizes.get(s.node.id)?.w ?? 0.0;
    width = Math.max(width, rangeW + SUMMARY_OFFSET + summaryW);
  }
  return width;
}

function hasVisibleChildren(node: MapNode, collapsed: Set<string>): boolean {
  return !collapsed.has(node.id) && (node.children.length > 0 || node.summaries.length > 0);
}

/** Prima passata: dimensioni di ogni sotto-albero, sommari inclusi. */
function computeSizes(
  node: MapNode,
  collapsed: Set<string>,
  metrics: NodeMetrics,
  opts: LayoutOpts,
  sizes: Sizes
): Size {
  const self = metrics.measure(node);
  let size: Size = self;
  if (hasVisibleChildren(node, collapsed)) {
    for (const child of node.children) computeSizes(child, collapsed, metrics, opts, sizes);
    for (const s of node.summaries) computeSizes(s.node, collapsed, metrics, opts, sizes);
    const col = column(node, sizes, opts);
    size = {
      w: self.w + opts.hGap + columnWidth(node, sizes),
      h: Math.max(self.h, col.height),
    };
  }
  sizes.set(node.id, size);
  return size;
}

/** Parametri condivisi dalla seconda passata (posizionamento). */
interface PlaceCtx {
  collapsed: Set<string>;
  metrics: NodeMetrics;
  opts: LayoutOpts;
  sizes: Sizes;
}

/** Posiziona un sotto-albero nella fascia che inizia in (`left`, `top`). */
function placeSubtree(
  node: MapNode,
  left: number,
  top: number,
  parent: { index: number; kind: EdgeKind } | undefined,
  ctx: PlaceCtx,
  out: Layout
): number {
  const { w, h } = ctx.metrics.measure(node);
  const subH = ctx.sizes.get(node.id)?.h ?? h;

  // Il blocco è centrato verticalmente nella fascia del proprio sotto-albero.
  const index = pushLayoutNode(
    out,
    node,
    left,
    top + (subH - h) / 2.0,
    w,
    h,
    ctx.collapsed.has(node.id),
    false
  );

  if (parent) {
    out.edges.push({ parent: parent.index, child: index, group: node.group, kind: parent.kind });
  }

  if (hasVisibleChildren(node, ctx.collapsed)) {
    const col = column(node, ctx.sizes, ctx.opts);
    const colTop = top + (subH - col.height) / 2.0;
    placeChildren(node, index, left + w + ctx.opts.hGap, colTop, col, 'logic', ctx, out);
  }
  return index;
}

/**
 * Radice di una Tree Chart: blocco in alto, rami di primo livello in colonna
 * sotto di esso e spostati a destra del tronco. Ritorna l'altezza occupata.
 */
function placeTreeRoot(node: MapNode, left: number, top: number, ctx: PlaceCtx, out: Layout): number {
  const { w, h } = ctx.metrics.measure(node);
  const index = pushLayoutNode(out, node, left, top, w, h, ctx.collapsed.has(node.id), true);
  if (!hasVisibleChildren(node, ctx.collapsed)) return h;

  const col = column(node, ctx.sizes, ctx.opts);
  placeChildren(
    node,
    index,
    trunkX(out.nodes[index]) + TREE_STUB,
    top + h + TREE_TOP_GAP,
    col,
    'tree',
    ctx,
    out
  );
  return h + TREE_TOP_GAP + col.height;
}

/** Dispone la colonna dei figli e i sommari, con le graffe a destra dei figli raccolti. */
function placeChildren(
  node: MapNode,
  index: number,
  childX: number,
  colTop: number,
  col: Column,
  kind: EdgeKind,
  ctx: PlaceCtx,
  out: Layout
): void {
  node.children.forEach((child, i) => {
    placeSubtree(child, childX, colTop + col.tops[i], { index, kind }, ctx, out);
  });

  const heightOf = (c: MapNode): number => ctx.sizes.get(c.id)?.h ?? 0.0;
  for (const s of node.summaries) {
    if (s.end >= node.children.length) continue;
    const y1 = colTop + col.tops[s.start];
    const y2 = colTop + col.tops[s.end] + heightOf(node.children[s.end]);
    const rangeW = maxWidth(node.children.slice(s.start, s.end + 1), ctx.sizes);
    const braceX = childX + rangeW + SUMMARY_GAP_BEFORE;
    const sumTop = (y1 + y2) / 2.0 - heightOf(s.node) / 2.0;
    const topic = placeSubtree(
      s.node,
      braceX + SUMMARY_BRACE_W + SUMMARY_GAP_AFTER,
      sumTop,
      undefined,
      ctx,
      out
    );
    const summary: LayoutSummary = {
      x: braceX,
      y1,
      y2,
      topic,
      accent: s.node.accent ?? node.accent,
    };
    out.summaries.push(summary);
  }
}
