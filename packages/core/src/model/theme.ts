/**
 * Tema del foglio XMind (`sheet.theme`): lettura per la vista e modifica non
 * distruttiva dall'editor dei temi.
 *
 * Struttura (file reali di XMind 26.x): `theme` è un oggetto di sezioni
 * (`map`, `centralTopic`, `mainTopic`, `subTopic`, `floatingTopic`,
 * `relationship`, …) più chiavi scalari (`colorThemeId`, `skeletonThemeId`).
 * Ogni sezione è `{ id, properties }`; le proprietà usano le chiavi di stile di
 * XMind (`svg:fill`, `fill-pattern`, `fo:*`, `shape-class`, `line-class`,
 * `line-width`) e il valore `inherited` per "decide il livello sopra". I
 * colori dei rami principali sono in `map.properties["multi-line-colors"]`
 * (stessa lista in `color-list`), separati da spazi.
 *
 * Le scritture toccano solo le chiavi modificate: sezioni, proprietà e chiavi
 * sconosciute restano come sono.
 */
import type { BranchLine, SheetTheme, ThemeLevel, ThemeLevelStyle, TopicShape } from '../state/types.js';
import type { Sheet } from './types.js';
import { newTopicId } from './utils.js';

/** Sezione di `sheet.theme` per ogni livello. */
export const THEME_LEVEL_SECTION: Record<ThemeLevel, string> = {
  central: 'centralTopic',
  main: 'mainTopic',
  sub: 'subTopic',
};

export const THEME_LEVELS: readonly ThemeLevel[] = ['central', 'main', 'sub'];

export const TOPIC_SHAPES: readonly TopicShape[] = ['roundedRect', 'rect', 'ellipse', 'underline'];
export const BRANCH_LINES: readonly BranchLine[] = ['curve', 'straight', 'elbow', 'roundedElbow'];

const SHAPE_PREFIX = 'org.xmind.topicShape.';
const LINE_PREFIX = 'org.xmind.branchConnection.';
const INHERITED = 'inherited';

/** Modifica parziale di un livello: `null` torna al default, `undefined` lascia com'è. */
export type ThemeLevelPatch = { [K in keyof ThemeLevelStyle]?: ThemeLevelStyle[K] | null };

export interface ThemePatch {
  branchColors?: string[] | null;
  background?: string | null;
  levels?: Partial<Record<ThemeLevel, ThemeLevelPatch>>;
}

type Bag = Record<string, unknown>;

/** Colore esadecimale a 6 o 8 cifre: accetta `"#FF6B6B"` e `"#00000066"`, rifiuta `"red"` e `"#FFF"`. */
const HEX_RE = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Misura con unità facoltativa: accetta `"14pt"`, `"2"`, `"18.5px"`, rifiuta `"inherited"` e `"-3pt"`. */
const MEASURE_RE = /^\s*([0-9]*\.?[0-9]+)\s*(pt|px)?\s*$/i;
/** Virgolette attorno a un nome di font: in `"'Nunito'"` toglie gli apici, `"Nunito"` resta uguale. */
const QUOTES_RE = /^["']|["']$/g;
/** Separatore della lista di colori: in `"#FF6B6B #FF9F69"` divide sugli spazi. */
const SPACES_RE = /\s+/;
/** Peso da cui un font conta come grassetto: il 600 dei rami principali (semi-grassetto) resta normale. */
const BOLD_MIN_WEIGHT = 700;
/** Rapporto px → pt (1pt = 4/3 px). */
const PT_PER_PX = 3 / 4;
/** Dimensioni e spessori si scrivono arrotondati al decimo di pt. */
const PT_DECIMALS = 10;
/** Limite di buon senso per dimensioni e spessori scritti dall'editor. */
const MAX_PT = 400;

function asBag(value: unknown): Bag | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : undefined;
}

function hexFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return HEX_RE.test(trimmed) ? trimmed : undefined;
}

/** `14pt`, `14` o `14px` → pt; `0` è valido solo per gli spessori. */
function ptFrom(value: unknown, allowZero = false): number | undefined {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string') return undefined;
  const m = MEASURE_RE.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return undefined;
  return m[2]?.toLowerCase() === 'px' ? n * PT_PER_PX : n;
}

function boldFrom(value: unknown): boolean | undefined {
  if (typeof value === 'number') return value >= BOLD_MIN_WEIGHT;
  if (typeof value !== 'string') return undefined;
  const s = value.trim().toLowerCase();
  if (s === 'bold' || s === 'bolder') return true;
  if (s === 'normal' || s === 'lighter') return false;
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n >= BOLD_MIN_WEIGHT : undefined;
}

function italicFrom(value: unknown): boolean | undefined {
  if (value === 'italic' || value === 'oblique') return true;
  return value === 'normal' ? false : undefined;
}

function prefixed<T extends string>(value: unknown, prefix: string, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return undefined;
  const name = value.slice(prefix.length);
  return (allowed as readonly string[]).includes(name) ? (name as T) : undefined;
}

/** Primo font della lista `fo:font-family`, senza virgolette. */
function familyFrom(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === INHERITED) return undefined;
  const first = value.split(',')[0]?.trim().replace(QUOTES_RE, '');
  return first ? first : undefined;
}

function propertiesOf(theme: Bag | undefined, section: string): Bag {
  return asBag(asBag(theme?.[section])?.properties) ?? {};
}

function readLevel(props: Bag): ThemeLevelStyle {
  const out: ThemeLevelStyle = {};
  const fill = hexFrom(props['svg:fill']);
  if (fill && props['fill-pattern'] !== 'none') out.fill = fill;
  const textColor = hexFrom(props['fo:color']);
  if (textColor) out.textColor = textColor;
  const family = familyFrom(props['fo:font-family']);
  if (family) out.fontFamily = family;
  const size = ptFrom(props['fo:font-size']);
  if (size !== undefined) out.fontSizePt = size;
  const bold = boldFrom(props['fo:font-weight']);
  if (bold !== undefined) out.bold = bold;
  const italic = italicFrom(props['fo:font-style']);
  if (italic !== undefined) out.italic = italic;
  const shape = prefixed(props['shape-class'], SHAPE_PREFIX, TOPIC_SHAPES);
  if (shape) out.shape = shape;
  const line = prefixed(props['line-class'], LINE_PREFIX, BRANCH_LINES);
  if (line) out.line = line;
  const width = ptFrom(props['line-width'], true);
  if (width !== undefined) out.lineWidthPt = width;
  return out;
}

function colorList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const colors = value.split(SPACES_RE).filter((c) => HEX_RE.test(c));
  return colors.length > 0 ? colors : undefined;
}

/** Tema del foglio nella forma che la vista sa disegnare. */
export function readSheetTheme(sheet: Sheet): SheetTheme {
  const theme = asBag(sheet.theme);
  const map = propertiesOf(theme, 'map');
  const out: SheetTheme = {
    levels: {
      central: readLevel(propertiesOf(theme, THEME_LEVEL_SECTION.central)),
      main: readLevel(propertiesOf(theme, THEME_LEVEL_SECTION.main)),
      sub: readLevel(propertiesOf(theme, THEME_LEVEL_SECTION.sub)),
    },
  };
  const branchColors = colorList(map['multi-line-colors']) ?? colorList(map['color-list']);
  if (branchColors) out.branchColors = branchColors;
  const background = hexFrom(map['svg:fill']);
  if (background) out.background = background;
  return out;
}

function formatPt(pt: number): string {
  return `${Math.round(pt * PT_DECIMALS) / PT_DECIMALS}pt`;
}

function requireHex(value: string, what: string): string {
  const hex = hexFrom(value);
  if (!hex) throw new Error(`${what} non valido: usa un colore #RRGGBB`);
  return hex;
}

function requirePt(value: number, what: string, allowZero = false): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || value > MAX_PT) {
    throw new Error(`${what} non valido`);
  }
  return value;
}

/** Proprietà della sezione, creando `theme`, sezione e `properties` se mancano. */
function ensureProperties(sheet: Sheet, section: string): Bag {
  let theme = asBag(sheet.theme);
  if (!theme) {
    theme = {};
    sheet.theme = theme;
  }
  let holder = asBag(theme[section]);
  if (!holder) {
    holder = { id: newTopicId(), properties: {} };
    theme[section] = holder;
  }
  let props = asBag(holder.properties);
  if (!props) {
    props = {};
    holder.properties = props;
  }
  return props;
}

function setOrDelete(props: Bag, key: string, value: string | undefined): void {
  if (value === undefined) delete props[key];
  else props[key] = value;
}

function applyLevelPatch(props: Bag, patch: ThemeLevelPatch): void {
  if (patch.fill !== undefined) {
    if (patch.fill === null) {
      props['svg:fill'] = INHERITED;
    } else {
      props['svg:fill'] = requireHex(patch.fill, 'Riempimento');
      props['fill-pattern'] = 'solid';
    }
  }
  if (patch.textColor !== undefined) {
    props['fo:color'] = patch.textColor === null ? INHERITED : requireHex(patch.textColor, 'Colore del testo');
  }
  if (patch.fontFamily !== undefined) {
    const family = patch.fontFamily?.trim();
    setOrDelete(props, 'fo:font-family', family ? family : undefined);
  }
  if (patch.fontSizePt !== undefined) {
    setOrDelete(
      props,
      'fo:font-size',
      patch.fontSizePt === null ? undefined : formatPt(requirePt(patch.fontSizePt, 'Dimensione del testo'))
    );
  }
  if (patch.bold !== undefined) {
    setOrDelete(props, 'fo:font-weight', patch.bold === null ? undefined : patch.bold ? '700' : '400');
  }
  if (patch.italic !== undefined) {
    setOrDelete(props, 'fo:font-style', patch.italic === null ? undefined : patch.italic ? 'italic' : 'normal');
  }
  if (patch.shape !== undefined) {
    if (patch.shape !== null && !TOPIC_SHAPES.includes(patch.shape)) throw new Error('Forma del blocco non valida');
    setOrDelete(props, 'shape-class', patch.shape === null ? undefined : SHAPE_PREFIX + patch.shape);
  }
  if (patch.line !== undefined) {
    if (patch.line !== null && !BRANCH_LINES.includes(patch.line)) throw new Error('Linea dei rami non valida');
    setOrDelete(props, 'line-class', patch.line === null ? undefined : LINE_PREFIX + patch.line);
  }
  if (patch.lineWidthPt !== undefined) {
    setOrDelete(
      props,
      'line-width',
      patch.lineWidthPt === null ? undefined : formatPt(requirePt(patch.lineWidthPt, 'Spessore della linea', true))
    );
  }
}

/**
 * Applica `patch` a `sheet.theme`. Valida tutto prima di scrivere: se un valore
 * non è valido lancia e il foglio resta com'era. Ritorna `true` se è cambiato
 * qualcosa.
 */
export function setSheetTheme(sheet: Sheet, patch: ThemePatch): boolean {
  const before = JSON.stringify(sheet.theme ?? null);
  const draft: Sheet = { theme: sheet.theme === undefined ? undefined : JSON.parse(before) };

  if (patch.branchColors !== undefined || patch.background !== undefined) {
    const mapExists = Boolean(asBag(asBag(draft.theme)?.map)?.properties);
    const hasSetting =
      (patch.branchColors !== undefined && patch.branchColors !== null && patch.branchColors.length > 0) ||
      (patch.background !== undefined && patch.background !== null);
    if (mapExists || hasSetting) {
      const map = ensureProperties(draft, 'map');
      if (patch.branchColors !== undefined) {
        if (patch.branchColors === null || patch.branchColors.length === 0) {
          delete map['multi-line-colors'];
          delete map['color-list'];
        } else {
          const list = patch.branchColors.map((c) => requireHex(c, 'Colore del ramo')).join(' ');
          map['multi-line-colors'] = list;
          map['color-list'] = list;
        }
      }
      if (patch.background !== undefined) {
        setOrDelete(map, 'svg:fill', patch.background === null ? undefined : requireHex(patch.background, 'Sfondo'));
      }
    }
  }
  THEME_LEVELS.forEach((level) => {
    const levelPatch = patch.levels?.[level];
    if (levelPatch) applyLevelPatch(ensureProperties(draft, THEME_LEVEL_SECTION[level]), levelPatch);
  });

  if (JSON.stringify(draft.theme ?? null) === before) return false;
  sheet.theme = draft.theme;
  return true;
}
