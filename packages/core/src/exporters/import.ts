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

export function parseOutline(format: 'markdown' | 'opml' | string, text: string): OutlineNode {
  let root: OutlineNode;
  if (format === 'markdown') {
    root = parseMarkdown(text);
  } else if (format === 'opml') {
    root = parseOPML(text);
  } else {
    throw new XmapError(CODE_FORMAT, `Formato non supportato: ${format}`);
  }

  if (root.children.length === 0 && !root.title && !root.latex) {
    throw new XmapError(CODE_FORMAT, 'Nessun argomento riconosciuto nel file.');
  }

  return root;
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
  const rootNode = parseOutline(format, text);
  const rootTopic = await nodeToTopic(rootNode, applyEq);

  return {
    id: newTopicId(),
    class: 'sheet',
    title: rootTopic.title || 'Mappa importata',
    rootTopic,
  };
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
    const numMatch = rest.match(/^(\d+)\.\s*(.*)$/);
    if (numMatch) {
      content = numMatch[2];
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

function splitLatex(s: string): { title: string; latex?: string } {
  const trimmed = s.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('$') && trimmed.endsWith('$')) {
    const inner = trimmed.slice(1, -1);
    if (inner.length > 0) {
      return { title: '', latex: inner };
    }
  }
  const close = trimmed.lastIndexOf('$');
  if (close > 0) {
    const open = trimmed.lastIndexOf('$', close - 1);
    if (open !== -1) {
      const before = trimmed.slice(0, open);
      if (before.length > 0 && before.endsWith(' ') && close > open + 1) {
        return {
          title: before.trim(),
          latex: trimmed.slice(open + 1, close),
        };
      }
    }
  }
  return { title: trimmed };
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
  const headTitle = titleMatch ? titleMatch[1].trim() : '';

  const arena: OutlineNode[] = [{ title: headTitle, labels: [], children: [] }];
  const childrenMap: number[][] = [[]];
  const stack: number[] = [];

  const regex = /<(\/)?outline([^>]*?)(\/)?>/gi;
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
