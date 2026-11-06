import { CODE_FORMAT, XmapError } from '../errors.js';
import { setLabels, setNotes } from '../model/edit.js';
import { Sheet, Topic } from '../model/types.js';
import { newTopicId } from '../model/utils.js';

export interface OutlineNode {
  title: string;
  latex?: string;
  notes?: string;
  labels: string[];
  children: OutlineNode[];
}

/** Prima radice di `parseOutlineSheets`. */
export function parseOutline(format: 'markdown' | 'opml' | string, text: string): OutlineNode {
  return parseOutlineSheets(format, text)[0];
}

/**
 * Radici dell'outline, una per foglio. Un Markdown con più intestazioni `# ` di
 * primo livello (come lo scrive `toMarkdown` per più fogli) dà una radice per
 * intestazione; con una sola, una radice. In OPML un solo `outline` di primo
 * livello è la radice (il titolo dell'intestazione si ignora, come lo scrive
 * `toOPML` per un foglio); con più `outline` la radice è il titolo dell'intestazione.
 */
export function parseOutlineSheets(format: 'markdown' | 'opml' | string, text: string): OutlineNode[] {
  let roots: OutlineNode[];
  if (format === 'markdown') {
    roots = splitMarkdownSheets(text).map(parseMarkdown);
  } else if (format === 'opml') {
    const root = parseOPML(text);
    roots = [root.children.length === 1 ? root.children[0] : root];
  } else {
    throw new XmapError(CODE_FORMAT, `Formato non supportato: ${format}`);
  }

  for (const root of roots) {
    if (root.children.length === 0 && !root.title && !root.latex) {
      throw new XmapError(CODE_FORMAT, 'Nessun argomento riconosciuto nel file.');
    }
  }

  return roots;
}

/**
 * Spezza il testo in un pezzo per intestazione `# ` (stesso criterio di
 * `parseMarkdown`). Con una sola intestazione, o nessuna, il testo resta intero;
 * le righe prima della prima intestazione vanno col primo pezzo.
 */
function splitMarkdownSheets(text: string): string[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim().startsWith('# ')) starts.push(i);
  });
  if (starts.length <= 1) return [text];
  return starts.map((start, k) => {
    const from = k === 0 ? 0 : start;
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    return lines.slice(from, to).join('\n');
  });
}

export async function nodeToTopic(
  node: OutlineNode,
  applyEq?: (topic: Topic, latex: string) => Promise<void> | void
): Promise<Topic> {
  const topic: Topic = {
    id: newTopicId(),
    title: node.title,
  };

  if (node.latex && applyEq) {
    await applyEq(topic, node.latex);
  }

  if (node.notes) {
    setNotes(topic, node.notes);
  }

  if (node.labels.length > 0) {
    setLabels(topic, node.labels);
  }

  if (node.children.length > 0) {
    const attached: Topic[] = [];
    for (const child of node.children) {
      attached.push(await nodeToTopic(child, applyEq));
    }
    topic.children = { attached };
  }

  return topic;
}

export async function importToSheet(
  format: 'markdown' | 'opml' | string,
  text: string,
  applyEq?: (topic: Topic, latex: string) => Promise<void> | void
): Promise<Sheet> {
  return (await importToSheets(format, text, applyEq))[0];
}

/** Un foglio per ogni radice di `parseOutlineSheets`, nell'ordine del file. */
export async function importToSheets(
  format: 'markdown' | 'opml' | string,
  text: string,
  applyEq?: (topic: Topic, latex: string) => Promise<void> | void
): Promise<Sheet[]> {
  const sheets: Sheet[] = [];
  for (const rootNode of parseOutlineSheets(format, text)) {
    const rootTopic = await nodeToTopic(rootNode, applyEq);
    sheets.push({
      id: newTopicId(),
      class: 'sheet',
      title: rootTopic.title || 'Mappa importata',
      rootTopic,
    });
  }
  return sheets;
}

export function parseMarkdown(text: string): OutlineNode {
  const arena: OutlineNode[] = [{ title: '', labels: [], children: [] }];
  const childrenMap: number[][] = [[]];
  const stack: { indent: number; idx: number }[] = [];
  let last: number | null = null;
  let rootTitle = '';
  const rootNotes: string[] = [];
  let rootLatex: string | undefined;
  let rootLabels: string[] = [];
  let seenHeading = false;

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trimStart();

    if (trimmed.startsWith('# ')) {
      if (!seenHeading) {
        rootTitle = trimmed.slice(2).trim();
        seenHeading = true;
      }
      continue;
    }
    if (trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('>')) {
      const note = trimmed.slice(1).trimStart();
      if (last !== null) {
        arena[last].notes = arena[last].notes ? `${arena[last].notes}\n${note}` : note;
      } else {
        rootNotes.push(note);
      }
      continue;
    }

    const bullet = parseBullet(line);
    if (bullet) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= bullet.indent) {
        stack.pop();
      }
      const parent = stack.length > 0 ? stack[stack.length - 1].idx : 0;
      const idx = arena.length;
      arena.push(parseItem(bullet.content));
      childrenMap.push([]);
      childrenMap[parent].push(idx);
      stack.push({ indent: bullet.indent, idx });
      last = idx;
      continue;
    }

    if (last === null) {
      const latex = bareLatex(trimmed);
      if (latex) {
        rootLatex = latex;
        continue;
      }
      const labels = bareLabels(trimmed);
      if (labels) {
        rootLabels = labels;
      }
    }
  }

  function assemble(idx: number): OutlineNode {
    const node = arena[idx];
    const childIndices = childrenMap[idx] || [];
    node.children = childIndices.map(assemble);
    return node;
  }

  const root = assemble(0);
  root.title = rootTitle;
  root.latex = rootLatex;
  if (rootNotes.length > 0) {
    root.notes = rootNotes.join('\n');
  }
  root.labels = rootLabels;
  return root;
}

function parseBullet(line: string): { indent: number; content: string } | null {
  let indent = 0;
  let rest = line;
  while (rest.startsWith(' ') || rest.startsWith('\t')) {
    if (rest.startsWith(' ')) {
      indent += 1;
      rest = rest.slice(1);
    } else {
      indent += 4;
      rest = rest.slice(1);
    }
  }

  let content: string | null = null;
  if (rest.startsWith('- ')) {
    content = rest.slice(2);
  } else if (rest === '-') {
    content = '';
  } else if (rest.startsWith('* ')) {
    content = rest.slice(2);
  } else if (rest === '*') {
    content = '';
  } else if (rest.startsWith('+ ')) {
    content = rest.slice(2);
  } else if (rest === '+') {
    content = '';
  } else {
    // Elenco numerato: "1. testo" o "1." da solo; "3.14" è testo, non un elemento.
    const numMatch = rest.match(/^\d+\.(?:\s+(.*))?$/);
    if (numMatch) {
      content = numMatch[1] ?? '';
    }
  }

  if (content === null) return null;
  return { indent, content: content.trim() };
}

function parseItem(content: string): OutlineNode {
  const { rest, labels } = splitLabels(content);
  const { title, latex } = splitLatex(rest);
  return {
    title,
    latex,
    labels,
    children: [],
  };
}

function splitLabels(s: string): { rest: string; labels: string[] } {
  let rest = s.trimEnd();
  const labels: string[] = [];
  while (rest.endsWith('`')) {
    const lastTick = rest.length - 1;
    // "\`" è un backtick del titolo (vedi `escapeMarkdownTitle`), non la fine di un'etichetta.
    if (isEscaped(rest, lastTick)) break;
    const openTick = rest.lastIndexOf('`', lastTick - 1);
    if (openTick === -1) break;
    const label = rest.slice(openTick + 1, lastTick);
    const before = rest.slice(0, openTick);
    if (label.length === 0 || !(before.length === 0 || before.endsWith(' '))) {
      break;
    }
    labels.push(label);
    rest = before.trimEnd();
  }
  labels.reverse();
  return { rest: rest.trim(), labels };
}

/** Vero se il carattere in `i` è preceduto da un numero dispari di backslash. */
function isEscaped(s: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) n++;
  return n % 2 === 1;
}

/** Indice dell'ultimo `$` non escapato in `s` fino a `from` incluso, o -1. */
function lastUnescapedDollar(s: string, from: number): number {
  for (let i = from; i >= 0; i--) {
    if (s[i] === '$' && !isEscaped(s, i)) return i;
  }
  return -1;
}

/** Inverso di `escapeMarkdownTitle` (exporters/markdown.ts): `\\`, `` \` `` e `\$` tornano letterali. */
function unescapeTitle(s: string): string {
  return s.replace(/\\([\\`$])/g, '$1');
}

function splitLatex(s: string): { title: string; latex?: string } {
  const trimmed = s.trim();
  const last = trimmed.length - 1;
  if (trimmed.length >= 2 && trimmed.startsWith('$') && trimmed.endsWith('$') && !isEscaped(trimmed, last)) {
    const inner = trimmed.slice(1, -1);
    if (inner.length > 0) {
      return { title: '', latex: inner };
    }
  }
  // I `$` escapati sono testo del titolo, non delimitatori della formula.
  const close = lastUnescapedDollar(trimmed, last);
  if (close > 0) {
    const open = lastUnescapedDollar(trimmed, close - 1);
    if (open !== -1) {
      const before = trimmed.slice(0, open);
      if (before.length > 0 && before.endsWith(' ') && close > open + 1) {
        return {
          title: unescapeTitle(before.trim()),
          latex: trimmed.slice(open + 1, close),
        };
      }
    }
  }
  return { title: unescapeTitle(trimmed) };
}

function bareLatex(s: string): string | undefined {
  const trimmed = s.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('$') && trimmed.endsWith('$')) {
    const inner = trimmed.slice(1, -1);
    if (inner.length > 0) return inner;
  }
  return undefined;
}

function bareLabels(s: string): string[] | undefined {
  const trimmed = s.trim();
  if (trimmed.length === 0) return undefined;
  const tokens = trimmed.split(/\s+/);
  const labels: string[] = [];
  for (const t of tokens) {
    if (t.length >= 2 && t.startsWith('`') && t.endsWith('`')) {
      labels.push(t.slice(1, -1));
    } else {
      return undefined;
    }
  }
  return labels.length > 0 ? labels : undefined;
}

export function parseOPML(text: string): OutlineNode {
  const titleMatch = text.match(/<title>([^<]*)<\/title>/i);
  const headTitle = titleMatch ? unescapeXml(titleMatch[1]).trim() : '';

  const arena: OutlineNode[] = [{ title: headTitle, labels: [], children: [] }];
  const childrenMap: number[][] = [[]];
  const stack: number[] = [];

  // Gli attributi tra virgolette possono contenere '>' letterali (XML lo ammette).
  const regex = /<(\/)?outline\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const isClose = Boolean(match[1]);
    const rawAttrs = match[2];
    const isSelfClosing = Boolean(match[3]);

    if (isClose) {
      stack.pop();
      continue;
    }

    const attrs = parseAttrs(rawAttrs);
    const node: OutlineNode = {
      title: attrs['text'] || '',
      latex: attrs['_equation'],
      notes: attrs['_note'],
      labels: attrs['_labels']
        ? attrs['_labels'].split(',').map((x) => x.trim()).filter((x) => x.length > 0)
        : [],
      children: [],
    };

    const parent = stack.length > 0 ? stack[stack.length - 1] : 0;
    const idx = arena.length;
    arena.push(node);
    childrenMap.push([]);
    childrenMap[parent].push(idx);

    if (!isSelfClosing) {
      stack.push(idx);
    }
  }

  function assemble(idx: number): OutlineNode {
    const node = arena[idx];
    const childIndices = childrenMap[idx] || [];
    node.children = childIndices.map(assemble);
    return node;
  }

  return assemble(0);
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(raw)) !== null) {
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : m[3];
    attrs[key] = unescapeXml(val);
  }
  return attrs;
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decodifica le entità XML in un solo passaggio, così `&amp;lt;` resta il
 * testo letterale `&lt;`. Gestisce anche i riferimenti numerici
 * (`&#233;`, `&#xE9;`); le entità sconosciute restano intatte.
 */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return XML_ENTITIES[body] ?? match;
  });
}
