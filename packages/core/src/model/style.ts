/**
 * Stile del testo dei blocchi: lettura di `style.properties` e
 * `attributedTitle`, scrittura non distruttiva delle proprietà `fo:*`.
 */
import type { TextStyle, TitleRun } from '../state/types.js';
import type { Topic } from './types.js';
import { newTopicId } from './utils.js';

/** Modifica parziale: `null` rimuove la proprietà, `undefined` la lascia com'è. */
export type TextStylePatch = { [K in keyof TextStyle]?: TextStyle[K] | null };

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Interpreta `fo:font-weight`: "bold" o peso numerico >= 600. */
function parseBold(v: unknown): boolean | undefined {
  if (typeof v === 'number') return v >= 600;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'bold' || s === 'bolder') return true;
  if (s === 'normal' || s === 'lighter') return false;
  const n = Number(s);
  return Number.isFinite(n) ? n >= 600 : undefined;
}

function parseItalic(v: unknown): boolean | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'italic' || s === 'oblique') return true;
  if (s === 'normal') return false;
  return undefined;
}

function parseDecoration(v: unknown): { underline: boolean; strikethrough: boolean } | undefined {
  if (typeof v !== 'string') return undefined;
  const parts = v.trim().toLowerCase().split(/\s+/);
  return { underline: parts.includes('underline'), strikethrough: parts.includes('line-through') };
}

/** `14pt` → px (pt * 4/3); `14px` e numeri nudi sono già px. */
function parseFontSizePx(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(pt|px)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!(n > 0)) return undefined;
  return m[2]?.toLowerCase() === 'pt' ? (n * 4) / 3 : n;
}

const COLOR_RE = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Legge le proprietà `fo:*` da un oggetto (`style.properties` o un frammento). */
function readFo(bag: Bag): TextStyle {
  const out: TextStyle = {};
  const bold = parseBold(bag['fo:font-weight']);
  if (bold !== undefined) out.bold = bold;
  const italic = parseItalic(bag['fo:font-style']);
  if (italic !== undefined) out.italic = italic;
  const deco = parseDecoration(bag['fo:text-decoration']);
  if (deco) {
    out.underline = deco.underline;
    out.strikethrough = deco.strikethrough;
  }
  const color = bag['fo:color'];
  if (typeof color === 'string' && COLOR_RE.test(color.trim())) out.color = color.trim();
  const size = parseFontSizePx(bag['fo:font-size']);
  if (size !== undefined) out.fontSizePx = size;
  return out;
}

/** Stile del blocco intero da `style.properties`; `undefined` se non c'è nulla. */
export function readTextStyle(topic: Topic): TextStyle | undefined {
  const style = topic.style;
  if (!isBag(style) || !isBag(style.properties)) return undefined;
  const out = readFo(style.properties);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Frammenti di `attributedTitle`, solo se la loro concatenazione è uguale a `title`. */
export function readTitleRuns(topic: Topic): TitleRun[] | undefined {
  const raw = topic.attributedTitle;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const runs: TitleRun[] = [];
  for (const item of raw) {
    if (!isBag(item) || typeof item.text !== 'string') return undefined;
    runs.push({ text: item.text, ...readFo(item) });
  }
  if (runs.map((r) => r.text).join('') !== (topic.title ?? '')) return undefined;
  const styled = runs.some((r) => Object.keys(r).length > 1);
  return styled ? runs : undefined;
}

function shallowEqualBags(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

interface ParsedRunItem {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  fontSizePx?: number;
  rawWeight?: unknown;
  extra: Record<string, unknown>;
}

/**
 * Imposta il titolo e la formattazione parziale (`attributedTitle`) del blocco.
 * - Scrive `title` = concatenazione del testo dei frammenti.
 * - `attributedTitle` = frammenti normalizzati (unisce frammenti adiacenti con stile identico;
 *   se nessun frammento ha stile, rimuove `attributedTitle` e lascia solo `title`).
 * - Preserva le chiavi sconosciute dei frammenti.
 * - Rimuove `titleUnedited`.
 */
export function setTitleRuns(topic: Topic, runs: TitleRun[]): void {
  delete topic.titleUnedited;

  if (!Array.isArray(runs) || runs.length === 0) {
    topic.title = '';
    delete topic.attributedTitle;
    return;
  }

  // Estrae e normalizza i frammenti in ingresso.
  const parsedItems: ParsedRunItem[] = [];
  for (const item of runs) {
    if (!item) continue;
    const text = typeof item.text === 'string' ? item.text : '';
    if (text === '') continue;

    const raw = item as unknown as Record<string, unknown>;
    const bold =
      item.bold !== undefined
        ? item.bold
          ? true
          : undefined
        : raw['fo:font-weight'] !== undefined
        ? parseBold(raw['fo:font-weight'])
        : undefined;

    const italic =
      item.italic !== undefined
        ? item.italic
          ? true
          : undefined
        : raw['fo:font-style'] !== undefined
        ? parseItalic(raw['fo:font-style'])
        : undefined;

    const rawDeco =
      raw['fo:text-decoration'] !== undefined ? parseDecoration(raw['fo:text-decoration']) : undefined;
    const underline =
      item.underline !== undefined
        ? item.underline
          ? true
          : undefined
        : rawDeco?.underline || undefined;

    const strikethrough =
      item.strikethrough !== undefined
        ? item.strikethrough
          ? true
          : undefined
        : rawDeco?.strikethrough || undefined;

    let color: string | undefined = undefined;
    if (typeof item.color === 'string' && COLOR_RE.test(item.color.trim())) {
      color = item.color.trim();
    } else if (typeof raw['fo:color'] === 'string' && COLOR_RE.test(raw['fo:color'].trim())) {
      color = raw['fo:color'].trim();
    }

    let fontSizePx: number | undefined = undefined;
    if (typeof item.fontSizePx === 'number' && item.fontSizePx > 0) {
      fontSizePx = item.fontSizePx;
    } else if (raw['fo:font-size'] !== undefined) {
      fontSizePx = parseFontSizePx(raw['fo:font-size']);
    }

    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (
        ![
          'text',
          'bold',
          'italic',
          'underline',
          'strikethrough',
          'color',
          'fontSizePx',
          'fo:font-weight',
          'fo:font-style',
          'fo:text-decoration',
          'fo:color',
          'fo:font-size',
        ].includes(k)
      ) {
        extra[k] = v;
      }
    }

    parsedItems.push({
      text,
      bold,
      italic,
      underline,
      strikethrough,
      color,
      fontSizePx,
      rawWeight: raw['fo:font-weight'],
      extra,
    });
  }

  // Unisce frammenti adiacenti con stile identico.
  const merged: ParsedRunItem[] = [];
  for (const cur of parsedItems) {
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      const sameStyle =
        prev.bold === cur.bold &&
        prev.italic === cur.italic &&
        prev.underline === cur.underline &&
        prev.strikethrough === cur.strikethrough &&
        prev.color === cur.color &&
        prev.fontSizePx === cur.fontSizePx &&
        shallowEqualBags(prev.extra, cur.extra);

      if (sameStyle) {
        prev.text += cur.text;
        continue;
      }
    }
    merged.push(cur);
  }

  const title = merged.map((m) => m.text).join('');
  topic.title = title;

  const hasStyle = merged.some(
    (m) =>
      m.bold !== undefined ||
      m.italic !== undefined ||
      m.underline !== undefined ||
      m.strikethrough !== undefined ||
      m.color !== undefined ||
      m.fontSizePx !== undefined ||
      Object.keys(m.extra).length > 0
  );

  if (!hasStyle || merged.length === 0) {
    delete topic.attributedTitle;
    return;
  }

  const fragments = merged.map((item) => {
    const frag: Record<string, unknown> = {
      text: item.text,
      ...item.extra,
    };
    if (item.bold) {
      frag['fo:font-weight'] =
        typeof item.rawWeight === 'string' && parseBold(item.rawWeight) ? item.rawWeight : 'bold';
    }
    if (item.italic) {
      frag['fo:font-style'] = 'italic';
    }
    if (item.underline || item.strikethrough) {
      const parts = [item.underline ? 'underline' : '', item.strikethrough ? 'line-through' : ''].filter(
        Boolean
      );
      frag['fo:text-decoration'] = parts.join(' ');
    }
    if (item.color) {
      frag['fo:color'] = item.color;
    }
    if (item.fontSizePx) {
      frag['fo:font-size'] = `${Math.round(item.fontSizePx * 0.75 * 100) / 100}pt`;
    }
    return frag;
  });

  topic.attributedTitle = fragments;
}

/** Applica `patch` a `style.properties` conservando ogni altra chiave. */
export function setTextStyle(topic: Topic, patch: TextStylePatch): void {
  if (!isBag(topic.style)) topic.style = { id: newTopicId() };
  const style = topic.style as Bag;
  if (!isBag(style.properties)) style.properties = {};
  const props = style.properties as Bag;

  const put = (key: string, value: string | null | undefined): void => {
    if (value === undefined) return;
    if (value === null) delete props[key];
    else props[key] = value;
  };

  // false scrive il valore esplicito per sovrascrivere un eventuale default del tema.
  if (patch.bold !== undefined) {
    put('fo:font-weight', patch.bold === null ? null : patch.bold ? '700' : '400');
  }
  if (patch.italic !== undefined) {
    put('fo:font-style', patch.italic === null ? null : patch.italic ? 'italic' : 'normal');
  }
  if (patch.color !== undefined) put('fo:color', patch.color);
  if (patch.fontSizePx !== undefined) {
    put(
      'fo:font-size',
      patch.fontSizePx === null ? null : `${Math.round(patch.fontSizePx * 0.75 * 100) / 100}pt`,
    );
  }

  if (patch.underline !== undefined || patch.strikethrough !== undefined) {
    const current = parseDecoration(props['fo:text-decoration']) ?? {
      underline: false,
      strikethrough: false,
    };
    const underline = patch.underline === undefined ? current.underline : patch.underline === true;
    const strikethrough =
      patch.strikethrough === undefined ? current.strikethrough : patch.strikethrough === true;
    const parts = [underline ? 'underline' : '', strikethrough ? 'line-through' : ''].filter(Boolean);
    // Rimuove la proprietà solo se tutte le parti toccate sono null e nulla resta attivo.
    const removing =
      parts.length === 0 &&
      (patch.underline === null || patch.underline === undefined) &&
      (patch.strikethrough === null || patch.strikethrough === undefined);
    if (removing) delete props['fo:text-decoration'];
    else props['fo:text-decoration'] = parts.length > 0 ? parts.join(' ') : 'none';
  }
}
