import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BRANCH_COLORS,
  BRANCH_LINES,
  TOPIC_SHAPES,
  type BranchLine,
  type SheetDto,
  type ThemeLevel,
  type ThemeLevelPatch,
  type ThemeLevelStyle,
  type ThemePatch,
  type TopicShape,
} from '@xmap/core';
import {
  Button,
  Field,
  Modal,
  SegmentedControl,
  Select,
  cn,
  type SegmentedControlItem,
  type SelectOption,
} from '@xmap/ui-kit';

export interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheets: SheetDto[];
  /** Foglio mostrato all'apertura. */
  initialSheetIndex: number;
  /** Applica subito la modifica (un passo di annullamento per modifica). */
  onApply: (sheetIndex: number, patch: ThemePatch) => void;
}

type ShapeChoice = 'auto' | TopicShape;
type TriState = 'auto' | 'on' | 'off';

interface BranchPalettePreset {
  id: string;
  label: string;
  colors: readonly string[];
}

const AUTO = 'auto';
const PICKER_HEX_LENGTH = 7;
const DEFAULT_PICKER_COLOR = '#ffffff';

const FONT_FAMILIES: readonly string[] = [
  'Nunito',
  'Inter',
  'Open Sans',
  'Roboto',
  'Lato',
  'Montserrat',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
];
const FONT_OPTIONS: SelectOption[] = [
  { value: AUTO, label: 'Automatico' },
  ...FONT_FAMILIES.map((family) => ({ value: family, label: family })),
];

/* Valori in stringa: le select lavorano con stringhe, la conversione è in un solo punto. */
const SIZE_OPTIONS_PT: readonly string[] = ['10', '11', '12', '13', '14', '16', '18', '20', '24', '28', '32', '36', '48'];
const SIZE_OPTIONS: SelectOption[] = [
  { value: AUTO, label: 'Automatica' },
  ...SIZE_OPTIONS_PT.map((pt) => ({ value: pt, label: `${pt} pt` })),
];

const LINE_WIDTH_OPTIONS_PT: readonly string[] = ['1', '2', '3', '4', '6'];
const LINE_WIDTH_OPTIONS: SelectOption[] = [
  { value: AUTO, label: 'Automatico' },
  ...LINE_WIDTH_OPTIONS_PT.map((pt) => ({ value: pt, label: `${pt} pt` })),
];

const SHAPE_LABELS: Record<TopicShape, string> = {
  roundedRect: 'Arrotondata',
  rect: 'Rettangolo',
  ellipse: 'Ellisse',
  underline: 'Sottolineata',
};
const SHAPE_ITEMS: SegmentedControlItem<ShapeChoice>[] = [
  { id: AUTO, label: 'Automatica' },
  ...TOPIC_SHAPES.map((shape) => ({ id: shape, label: SHAPE_LABELS[shape] })),
];

const LINE_LABELS: Record<BranchLine, string> = {
  curve: 'Curva',
  straight: 'Dritta',
  elbow: 'Gomito',
  roundedElbow: 'Gomito arrotondato',
};
const LINE_OPTIONS: SelectOption[] = [
  { value: AUTO, label: 'Automatica' },
  ...BRANCH_LINES.map((line) => ({ value: line, label: LINE_LABELS[line] })),
];

const TRI_STATE_ITEMS: SegmentedControlItem<TriState>[] = [
  { id: 'auto', label: 'Automatico' },
  { id: 'on', label: 'Sì' },
  { id: 'off', label: 'No' },
];

const LEVEL_ITEMS: SegmentedControlItem<ThemeLevel>[] = [
  { id: 'central', label: 'Centrale' },
  { id: 'main', label: 'Principali' },
  { id: 'sub', label: 'Sotto-blocchi' },
];

const BRANCH_PALETTE_PRESETS: readonly BranchPalettePreset[] = [
  { id: 'xmap', label: 'XMap', colors: BRANCH_COLORS },
  {
    id: 'pastel',
    label: 'Pastello',
    colors: ['#FF6B6B', '#FF9F69', '#97D3B6', '#88E2D7', '#6FD0F9', '#E18BEE'],
  },
  {
    id: 'sober',
    label: 'Sobrio',
    colors: ['#4A6FA5', '#6B8F71', '#B08D57', '#9A5B6F', '#5E7C8A', '#7A6C9D'],
  },
];

/** Restituisce `choice` solo se è uno dei valori ammessi: niente cast sugli input del menu. */
function choiceFromId<T extends string>(choices: readonly T[], id: string): T | undefined {
  return (choices as readonly string[]).includes(id) ? (id as T) : undefined;
}

/** Il menu mostra il valore attuale anche se non è tra le opzioni standard. */
function withCurrentOption(
  options: SelectOption[],
  current: string | undefined,
  labelOf: (value: string) => string,
): SelectOption[] {
  if (current === undefined || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: labelOf(current) }];
}

function triStateOf(flag: boolean | undefined): TriState {
  if (flag === undefined) return 'auto';
  return flag ? 'on' : 'off';
}

/** `null` riporta il campo ad Automatico, come nelle patch del tema. */
function flagOf(state: TriState): boolean | null {
  if (state === 'auto') return null;
  return state === 'on';
}

function sameColors(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((color, index) => color.toLowerCase() === b[index]?.toLowerCase());
}

interface ThemeSectionProps {
  title: string;
  children: ReactNode;
}

const ThemeSection: React.FC<ThemeSectionProps> = ({ title, children }) => {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
};

interface ColorFieldProps {
  /** Il `Field` padre lo assegna al selettore nativo, così l'etichetta lo collega. */
  id?: string;
  label: string;
  /** `#RRGGBB` o `#RRGGBBAA`; `undefined` vale come automatico. */
  value: string | undefined;
  /** Testo mostrato quando il valore è automatico, e testo del bottone di ripristino. */
  emptyLabel?: string;
  /** Solo il quadratino, senza il codice esadecimale. */
  compact?: boolean;
  /** Chiamato alla chiusura del selettore nativo, non a ogni movimento. */
  onCommit: (color: string) => void;
  /** Se presente, mostra il bottone che riporta il valore ad automatico. */
  onReset?: () => void;
}

/**
 * Selettore colore nativo. Durante il trascinamento il colore resta nel `draft`
 * locale (solo anteprima); la modifica vera parte dall'evento `change`, che il
 * browser emette alla chiusura: così una scelta vale un solo passo di annullamento.
 */
const ColorField: React.FC<ColorFieldProps> = ({
  id,
  label,
  value,
  emptyLabel,
  compact = false,
  onCommit,
  onReset,
}) => {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const shown = draft ?? value;
  // `<input type="color">` accetta solo `#rrggbb`: l'eventuale canale alfa si tronca.
  const pickerValue = shown?.slice(0, PICKER_HEX_LENGTH).toLowerCase() ?? DEFAULT_PICKER_COLOR;

  useEffect(() => {
    setDraft(undefined);
  }, [value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handleChange = (): void => {
      setDraft(undefined);
      onCommitRef.current(input.value);
    };
    const handleResetDraft = (): void => {
      setDraft(undefined);
    };
    input.addEventListener('change', handleChange);
    input.addEventListener('cancel', handleResetDraft);
    input.addEventListener('blur', handleResetDraft);
    return () => {
      input.removeEventListener('change', handleChange);
      input.removeEventListener('cancel', handleResetDraft);
      input.removeEventListener('blur', handleResetDraft);
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-input bg-background shadow-control focus-within:ring-2 focus-within:ring-ring',
          compact ? 'size-8 justify-center' : 'h-8 min-w-0 px-2',
        )}
      >
        <span
          aria-hidden
          className={cn('size-5 shrink-0 rounded-sm border border-border', shown === undefined && 'bg-muted')}
          style={{ backgroundColor: shown }}
        />
        {compact ? null : (
          <span className="truncate text-sm">{shown === undefined ? emptyLabel : shown.toUpperCase()}</span>
        )}
        <input
          ref={inputRef}
          id={id}
          type="color"
          aria-label={label}
          title={label}
          value={pickerValue}
          onChange={(event) => setDraft(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </div>
      {onReset ? (
        <Button variant="outline" size="sm" disabled={value === undefined} onClick={onReset}>
          {emptyLabel}
        </Button>
      ) : null}
    </div>
  );
};

/**
 * Editor del tema di un foglio. Ogni modifica committata chiama `onApply` con
 * la sola parte cambiata; i valori mostrati vengono sempre da `sheets`, quindi
 * l'annullamento del genitore si riflette qui senza copie locali.
 */
export const ThemeEditorModal: React.FC<ThemeEditorModalProps> = ({
  isOpen,
  onClose,
  sheets,
  initialSheetIndex,
  onApply,
}) => {
  const [sheetPosition, setSheetPosition] = useState(initialSheetIndex);
  const [level, setLevel] = useState<ThemeLevel>('central');

  useEffect(() => {
    if (isOpen) setSheetPosition(initialSheetIndex);
  }, [isOpen, initialSheetIndex]);

  const sheet = sheets.at(sheetPosition);
  const theme = sheet?.theme;
  const palette = theme?.branchColors ?? BRANCH_COLORS;
  const style: ThemeLevelStyle = theme?.levels[level] ?? {};
  const sizeKey = style.fontSizePt === undefined ? undefined : String(style.fontSizePt);
  const lineWidthKey = style.lineWidthPt === undefined ? undefined : String(style.lineWidthPt);

  const applyPatch = (patch: ThemePatch): void => {
    if (sheet) onApply(sheet.index, patch);
  };
  const applyLevel = (patch: ThemeLevelPatch): void => {
    applyPatch({ levels: { [level]: patch } });
  };

  const activePresetId = useMemo(
    () => BRANCH_PALETTE_PRESETS.find((preset) => sameColors(palette, preset.colors))?.id,
    [palette],
  );

  const sheetOptions: SelectOption[] = useMemo(
    () =>
      sheets.map((item, position) => ({
        value: String(position),
        label: item.title,
      })),
    [sheets],
  );

  const fontOptions = useMemo(
    () => withCurrentOption(FONT_OPTIONS, style.fontFamily, (family) => family),
    [style.fontFamily],
  );

  const sizeOptions = useMemo(
    () => withCurrentOption(SIZE_OPTIONS, sizeKey, (value) => `${value} pt`),
    [sizeKey],
  );

  const lineWidthOptions = useMemo(
    () => withCurrentOption(LINE_WIDTH_OPTIONS, lineWidthKey, (value) => `${value} pt`),
    [lineWidthKey],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Tema del foglio"
      description="Le modifiche valgono per tutto il foglio e si salvano nel file: XMind le mostra uguali."
      size="lg"
      footer={
        <Button variant="default" onClick={onClose}>
          Chiudi
        </Button>
      }
    >
      {sheet ? (
        <div className="flex flex-col gap-6">
          {sheets.length > 1 ? (
            <Field label="Foglio">
              <Select
                size="sm"
                options={sheetOptions}
                value={String(sheetPosition)}
                onChange={(event) => setSheetPosition(Number(event.target.value))}
              />
            </Field>
          ) : null}

          <ThemeSection title="Colori dei rami">
            <div className="flex flex-wrap gap-2">
              {palette.map((color, index) => (
                <ColorField
                  key={index}
                  label={`Colore del ramo ${index + 1}`}
                  value={color}
                  compact
                  onCommit={(hex) =>
                    applyPatch({ branchColors: palette.map((current, position) => (position === index ? hex : current)) })
                  }
                />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {BRANCH_PALETTE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={preset.id === activePresetId}
                  onClick={() => applyPatch({ branchColors: [...preset.colors] })}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent aria-pressed:bg-accent"
                >
                  <span>{preset.label}</span>
                  <span className="flex shrink-0">
                    {preset.colors.map((color) => (
                      <span
                        key={color}
                        aria-hidden
                        className="-ml-1 size-3.5 rounded-full border border-background first:ml-0"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={theme?.branchColors === undefined}
              onClick={() => applyPatch({ branchColors: null })}
            >
              Ripristina
            </Button>
          </ThemeSection>

          <ThemeSection title="Sfondo della mappa">
            <ColorField
              label="Sfondo della mappa"
              value={theme?.background}
              emptyLabel="Nessuno"
              onCommit={(hex) => applyPatch({ background: hex })}
              onReset={() => applyPatch({ background: null })}
            />
            <p className="text-2xs text-muted-foreground">
              Lo sfondo si vede in XMind; nell'app la mappa segue il tema chiaro/scuro.
            </p>
          </ThemeSection>

          <ThemeSection title="Stile dei blocchi">
            <SegmentedControl
              items={LEVEL_ITEMS}
              activeId={level}
              onChange={setLevel}
              aria-label="Livello del blocco"
              className="max-w-full overflow-x-auto"
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Riempimento">
                <ColorField
                  label="Riempimento"
                  value={style.fill}
                  emptyLabel="Automatico"
                  onCommit={(hex) => applyLevel({ fill: hex })}
                  onReset={() => applyLevel({ fill: null })}
                />
              </Field>

              <Field label="Colore del testo">
                <ColorField
                  label="Colore del testo"
                  value={style.textColor}
                  emptyLabel="Automatico"
                  onCommit={(hex) => applyLevel({ textColor: hex })}
                  onReset={() => applyLevel({ textColor: null })}
                />
              </Field>

              <Field label="Font">
                <Select
                  size="sm"
                  options={fontOptions}
                  value={style.fontFamily ?? AUTO}
                  onChange={(event) =>
                    applyLevel({ fontFamily: event.target.value === AUTO ? null : event.target.value })
                  }
                />
              </Field>

              <Field label="Dimensione">
                <Select
                  size="sm"
                  options={sizeOptions}
                  value={sizeKey ?? AUTO}
                  onChange={(event) =>
                    applyLevel({ fontSizePt: event.target.value === AUTO ? null : Number(event.target.value) })
                  }
                />
              </Field>

              <Field label="Grassetto">
                <SegmentedControl
                  size="sm"
                  items={TRI_STATE_ITEMS}
                  activeId={triStateOf(style.bold)}
                  onChange={(state) => applyLevel({ bold: flagOf(state) })}
                  aria-label="Grassetto"
                />
              </Field>

              <Field label="Corsivo">
                <SegmentedControl
                  size="sm"
                  items={TRI_STATE_ITEMS}
                  activeId={triStateOf(style.italic)}
                  onChange={(state) => applyLevel({ italic: flagOf(state) })}
                  aria-label="Corsivo"
                />
              </Field>

              <Field label="Forma" className="sm:col-span-2">
                <SegmentedControl
                  size="sm"
                  items={SHAPE_ITEMS}
                  activeId={style.shape ?? AUTO}
                  onChange={(id) => applyLevel({ shape: id === AUTO ? null : id })}
                  aria-label="Forma del blocco"
                  className="max-w-full overflow-x-auto"
                />
              </Field>

              <Field label="Linea verso i figli">
                <Select
                  size="sm"
                  options={LINE_OPTIONS}
                  value={style.line ?? AUTO}
                  onChange={(event) => {
                    const line = event.target.value === AUTO ? null : choiceFromId(BRANCH_LINES, event.target.value);
                    if (line !== undefined) applyLevel({ line });
                  }}
                />
              </Field>

              <Field label="Spessore della linea">
                <Select
                  size="sm"
                  options={lineWidthOptions}
                  value={lineWidthKey ?? AUTO}
                  onChange={(event) =>
                    applyLevel({ lineWidthPt: event.target.value === AUTO ? null : Number(event.target.value) })
                  }
                />
              </Field>
            </div>
          </ThemeSection>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nessun foglio da modificare.</p>
      )}
    </Modal>
  );
};
