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
