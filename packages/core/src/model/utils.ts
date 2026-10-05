import {
  CHILD_GROUPS,
  MATHJAX_PROVIDER,
  RESOURCE_PREFIX,
  Sheet,
  Topic,
} from './types.js';

/**
 * Genera un UUID v4 nel formato standard di XMind.
 */
export function newTopicId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback con Math.random se WebCrypto non è disponibile
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * DFS pre-order sull'albero di un topic (incluso se stesso).
 */
export function walkTopic(topic: Topic, callback: (t: Topic) => void): void {
  callback(topic);
  if (!topic.children) return;
  for (const group of CHILD_GROUPS) {
    const list = topic.children[group];
    if (Array.isArray(list)) {
      for (const child of list) {
        walkTopic(child, callback);
      }
    }
  }
}

/**
 * Restituisce tutti i figli immediati di un topic, ordinati per gruppi noti.
 */
export function topicAllChildren(topic: Topic): Topic[] {
  if (!topic.children) return [];
  const res: Topic[] = [];
  for (const group of CHILD_GROUPS) {
    const list = topic.children[group];
    if (Array.isArray(list)) {
      res.push(...list);
    }
  }
  return res;
}

/**
 * Trova un topic per ID all'interno delle sheets.
 */
export function findTopic(sheets: Sheet[], id: string): Topic | undefined {
  for (const sheet of sheets) {
    if (sheet.rootTopic) {
      let found: Topic | undefined;
      walkTopic(sheet.rootTopic, (t) => {
        if (!found && t.id === id) {
          found = t;
        }
      });
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Restituisce l'indice della sheet che contiene il topic specificato.
 */
export function sheetIndexOf(sheets: Sheet[], topicId: string): number {
  return sheets.findIndex((sheet) => {
    if (!sheet.rootTopic) return false;
    let found = false;
    walkTopic(sheet.rootTopic, (t) => {
      if (t.id === topicId) found = true;
    });
    return found;
  });
}

/**
 * Rileva se una stringa è molto probabilmente una formula o espressione LaTeX.
 */
export function isLikelyLatex(title?: string): boolean {
  if (!title || typeof title !== 'string') return false;
  const t = title.trim();
  if (!t) return false;
  if (t.startsWith('$') && t.endsWith('$') && t.length > 2) return true;
  if (/\\\\[a-zA-Z]{1,20}/.test(t)) return true;
  if (/[a-zA-Z0-9]\^\{?[0-9a-zA-Z+\\-]/.test(t)) return true;
  if (/[a-zA-Z0-9]_\{?[0-9a-zA-Z+\\-]/.test(t)) return true;
  return false;
}

/**
 * Estrae la formula LaTeX se presente come estensione org.xmind.ui.mathJax
 * oppure direttamente dal titolo del topic se contiene sintassi LaTeX valida.
 */
export function topicLatex(topic: Topic): string | undefined {
  if (topic.extensions) {
    const ext = topic.extensions.find((e) => e.provider === MATHJAX_PROVIDER);
    if (ext && ext.content && typeof ext.content === 'object' && 'content' in ext.content) {
      const c = (ext.content as { content?: unknown }).content;
      if (typeof c === 'string' && c.trim().length > 0) return c;
    }
  }

  const title = topic.title?.trim();
  if (title && isLikelyLatex(title)) {
    if (title.startsWith('$') && title.endsWith('$') && title.length > 2) {
      return title.slice(1, -1).trim();
    }
    return title;
  }

  return undefined;
}

export function topicIsEquation(topic: Topic): boolean {
  return topicLatex(topic) !== undefined;
}

export function topicIsPlainImage(topic: Topic): boolean {
  return Boolean(topic.image && !topic.image.isMathJaxImage && topic.image.src);
}

export function topicImageSrc(topic: Topic): string | undefined {
  return topic.image?.src;
}

export function topicTitle(topic: Topic): string {
  return topic.title ?? '';
}

/**
 * Restituisce il testo delle note (preferisce plain, ripiega su realHTML).
 */
export function topicNotesText(topic: Topic): string | undefined {
  if (!topic.notes) return undefined;
  const plain = topic.notes.plain?.content;
  if (plain && plain.length > 0) return plain;
  const html = topic.notes.realHTML?.content;
  if (html && html.length > 0) return html;
  return undefined;
}

export function topicLabels(topic: Topic): string[] {
  return topic.labels ?? [];
}

export function topicMarkerIds(topic: Topic): string[] {
  if (!topic.markers) return [];
  return topic.markers.map((m) => m.markerId).filter((id): id is string => Boolean(id));
}

export function topicHref(topic: Topic): string | undefined {
  if (!topic.href || topic.href.trim() === '') return undefined;
  return topic.href;
}

/**
 * Colore di riempimento del ramo (style.properties['svg:fill']).
 */
export function topicFillColor(topic: Topic): string | undefined {
  const style = topic['style'] as { properties?: Record<string, unknown> } | undefined;
  const fill = style?.properties?.['svg:fill'];
  return typeof fill === 'string' ? fill : undefined;
}

/**
 * Posizione esplicita dichiarata per topic liberi.
 */
export function topicPosition(topic: Topic): { x: number; y: number } | undefined {
  const pos = topic['position'] as { x?: unknown; y?: unknown } | undefined;
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    return { x: pos.x, y: pos.y };
  }
  return undefined;
}

/**
 * Larghezza custom del topic impostata in XMind.
 */
export function topicCustomWidth(topic: Topic): number | undefined {
  const cw = topic['customWidth'];
  if (typeof cw === 'number') return cw;
  return undefined;
}

/**
 * Interpreta '(start,end)' in una coppia ordinata [start, end].
 */
export function parseRange(rangeStr?: string): [number, number] | undefined {
  if (!rangeStr) return undefined;
  const match = rangeStr.match(/^\((\d+)\s*,\s*(\d+)\)$/);
  if (!match) return undefined;
  const a = parseInt(match[1], 10);
  const b = parseInt(match[2], 10);
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Formatta indici inclusivi come range di XMind '(start,end)'.
 */
export function formatRange(start: number, end: number): string {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  return `(${a},${b})`;
}

/**
 * Imposta o rimuove il colore di riempimento del topic senza alterare le altre proprietà di stile.
 */
export function setFillColor(topic: Topic, color?: string | null): void {
  const clean = color?.trim();
  let style = topic['style'] as { id?: string; properties?: Record<string, unknown> } | undefined;

  if (!clean) {
    if (style?.properties && 'svg:fill' in style.properties) {
      delete style.properties['svg:fill'];
      if (Object.keys(style.properties).length === 0) {
        delete topic['style'];
      }
    }
    return;
  }

  if (!style || typeof style !== 'object') {
    style = { properties: {} };
    topic['style'] = style;
  }
  if (!style.properties || typeof style.properties !== 'object') {
    style.properties = {};
  }
  style.properties['svg:fill'] = clean;
}

/**
 * Dimensione font del titolo del topic in px CSS (fo:font-size in style.properties).
 */
export function fontSizePx(topic: Topic): number | undefined {
  const style = topic['style'] as { properties?: Record<string, unknown> } | undefined;
  const fontSize = style?.properties?.['fo:font-size'];
  if (!fontSize) return undefined;

  let pt: number | undefined;
  if (typeof fontSize === 'number') {
    pt = fontSize;
  } else if (typeof fontSize === 'string') {
    const num = parseFloat(fontSize);
    if (!isNaN(num) && num > 0) {
      pt = num;
    }
  }

  if (pt && pt > 0) {
    // 1pt = 96/72 px
    return (pt * 96.0) / 72.0;
  }
  return undefined;
}

/**
 * Riassegna tutti gli id di un albero di sheet, aggiornando i riferimenti noti
 * (`id`, `topicId`, `end1Id`, `end2Id`) e i link interni `xmind:#<id>`.
 *
 * Serve all'unione di file creati in modo indipendente, dove due workbook
 * possono condividere gli stessi UUID radice.
 */
export function remapIds(sheets: Sheet[]): void {
  const idMap = new Map<string, string>();

  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'id' && typeof val === 'string' && val.length > 0 && !idMap.has(val)) {
          idMap.set(val, newTopicId());
        }
        collect(val);
      }
    }
  };
  collect(sheets);

  const rewrite = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) rewrite(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (
        (key === 'id' || key === 'topicId' || key === 'end1Id' || key === 'end2Id') &&
        typeof val === 'string' &&
        idMap.has(val)
      ) {
        obj[key] = idMap.get(val);
      } else if (typeof val === 'string' && val.startsWith('xmind:#')) {
        const oldId = val.slice('xmind:#'.length);
        if (idMap.has(oldId)) obj[key] = `xmind:#${idMap.get(oldId)}`;
      } else {
        rewrite(val);
      }
    }
  };
  rewrite(sheets);
}

/**
 * Conta i topic di un albero (inclusi i figli in tutti i gruppi).
 */
export function countTopics(sheets: Sheet[]): number {
  let count = 0;
  for (const sheet of sheets) {
    if (sheet.rootTopic) {
      walkTopic(sheet.rootTopic, () => {
        count++;
      });
    }
  }
  return count;
}

/**
 * Raccoglie tutti i riferimenti xap:resources/<nome> in qualsiasi valore JSON (content.json, manifest, theme).
 */
export function collectResourceRefs(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith(RESOURCE_PREFIX)) {
      out.add(value.slice(RESOURCE_PREFIX.length));
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectResourceRefs(item, out);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const val of Object.values(value as Record<string, unknown>)) {
      collectResourceRefs(val, out);
    }
  }
}
