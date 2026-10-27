import React, { useEffect, useState } from 'react';
import { ALargeSmall, Bold, ChevronDown, Italic, Minus, Plus, Strikethrough, Underline } from 'lucide-react';
import { titleBaseFontPx, type TopicView } from '@xmap/core';
import { cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import { MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX, type InlineToggleStyle } from '../map/editorBridge.js';
import { sameColor } from './ColorPopover.js';
import { FOCUS_RING, chipClass, swatchHairline, swatchSelected } from './classes.js';
import { BRANCH_COLORS } from './constants.js';
import { ToolbarButton, ToolbarPopover, useToolbarOrientation } from './primitives.js';
import { setTextColor, setTextFontSize, stepTextFontSize, toggleTextStyle } from './useTextStyleShortcuts.js';

// Stili nel pannello "Altri stili": il grassetto resta sempre visibile sulla barra.
const POPOVER_STYLE_BUTTONS: { style: InlineToggleStyle; label: string; Icon: React.ElementType }[] = [
  { style: 'italic', label: 'Corsivo (Ctrl+I)', Icon: Italic },
  { style: 'underline', label: 'Sottolineato (Ctrl+U)', Icon: Underline },
  { style: 'strikethrough', label: 'Barrato', Icon: Strikethrough },
];

// Dimensioni rapide in px, come nel menu delle dimensioni di XMind.
const FONT_SIZE_PRESETS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
const FONT_SIZE_STEP = 1;

interface TextStyleControlsProps {
  topic: TopicView | null;
  isEditingText: boolean;
  actions: TopicActions;
}

// Stile e colore del testo: valgono per il blocco di testo selezionato, o per la selezione
// dell'editor in place mentre si scrive (vedi map/editorBridge.ts).
export const TextStyleControls: React.FC<TextStyleControlsProps> = ({ topic, isEditingText, actions }) => {
  const enabled = topic?.kind === 'text';
  const orientation = useToolbarOrientation();
  const chevronClass = orientation === 'vertical' ? 'h-5 w-8 coarse:h-6 coarse:w-10' : 'w-5 coarse:w-6';
  const target = { topic, isEditingText, actions };
  // Durante la modifica in place lo stato della selezione parziale non è noto: nessun pulsante risulta attivo.
  const style = isEditingText ? undefined : topic?.textStyle;
  const color = style?.color ?? null;
  // Il chevron resta acceso anche a pannello chiuso se uno stile nascosto o il colore è impostato.
  const hiddenStyleActive = Boolean(style?.italic || style?.underline || style?.strikethrough) || color !== null;

  return (
    <>
      <ToolbarButton
        label="Grassetto (Ctrl+B)"
        active={Boolean(style?.bold)}
        disabled={!enabled}
        onClick={() => toggleTextStyle(target, 'bold')}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarPopover
        align="center"
        panelClassName="flex w-44 flex-col gap-2"
        trigger={({ open, toggle }) => (
          <ToolbarButton
            label="Altri stili del testo"
            active={open || hiddenStyleActive}
            disabled={!enabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={toggle}
            className={chevronClass}
          >
            <ChevronDown className="size-3.5" />
          </ToolbarButton>
        )}
      >
        {(close) => (
          <>
            <div className="flex gap-1">
              {POPOVER_STYLE_BUTTONS.map(({ style: key, label, Icon }) => (
                <ToolbarButton
                  key={key}
                  label={label}
                  active={Boolean(style?.[key])}
                  disabled={!enabled}
                  onClick={() => toggleTextStyle(target, key)}
                >
                  <Icon className="size-4" />
                </ToolbarButton>
              ))}
            </div>
            <div role="group" aria-label="Colore del testo" className="flex flex-col gap-2">
              <span className="text-2xs text-muted-foreground">Colore del testo</span>
              <button
                type="button"
                aria-pressed={color === null}
                // Il clic non deve togliere il focus all'editor in place.
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTextColor(target, null);
                  close();
                }}
                className={cn(chipClass(color === null), 'flex h-6 items-center justify-center px-2')}
              >
                Predefinito
              </button>
              <div className="flex flex-wrap gap-2">
                {BRANCH_COLORS.map((c) => {
                  const selected = sameColor(color, c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colore del testo ${c}`}
                      aria-pressed={selected}
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setTextColor(target, c);
                        close();
                      }}
                      className={cn('size-5 rounded-full', FOCUS_RING, selected ? swatchSelected : swatchHairline)}
                      style={{ backgroundColor: c }}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
      </ToolbarPopover>
      <FontSizePopover topic={topic} isEditingText={isEditingText} actions={actions} />
    </>
  );
};

type FontSizePopoverProps = TextStyleControlsProps;

// Dimensione del testo in px: −/+ di un pixel, valore scritto a mano o dimensioni rapide.
// Durante la modifica in place vale per la selezione; il campo numerico ruberebbe il focus
// all'editor (che si chiuderebbe), quindi lì restano attivi solo i pulsanti.
const FontSizePopover: React.FC<FontSizePopoverProps> = ({ topic, isEditingText, actions }) => {
  const enabled = topic?.kind === 'text';
  const target = { topic, isEditingText, actions };
  // `fo:font-size` è in pt: il ritorno in px può avere decimali spuri.
  const stored = isEditingText ? undefined : topic?.textStyle?.fontSizePx;
  const custom = stored === undefined ? undefined : Math.round(stored * 10) / 10;
  const current = topic ? titleBaseFontPx(topic.depth, topic.textStyle) : undefined;

  return (
    <ToolbarPopover
      align="center"
      focusable={!isEditingText}
      panelClassName="flex w-52 flex-col gap-2"
      trigger={({ open, toggle }) => (
        <ToolbarButton
          label="Dimensione del testo"
          active={open || custom !== undefined}
          disabled={!enabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <ALargeSmall className="size-4" />
        </ToolbarButton>
      )}
    >
      {(close) => (
        <div role="group" aria-label="Dimensione del testo" className="flex flex-col gap-2">
          <span className="text-2xs text-muted-foreground">
            Dimensione del testo{isEditingText ? ' (selezione)' : ''}
          </span>
          <div className="flex items-center gap-1">
            <ToolbarButton
              label="Riduci il testo"
              disabled={!enabled}
              onClick={() => stepTextFontSize(target, -FONT_SIZE_STEP)}
            >
              <Minus className="size-4" />
            </ToolbarButton>
            <FontSizeInput
              key={topic?.id}
              value={isEditingText ? undefined : current}
              disabled={!enabled || isEditingText}
              onCommit={(px) => setTextFontSize(target, px)}
            />
            <ToolbarButton
              label="Ingrandisci il testo"
              disabled={!enabled}
              onClick={() => stepTextFontSize(target, FONT_SIZE_STEP)}
            >
              <Plus className="size-4" />
            </ToolbarButton>
          </div>
          <div className="flex flex-wrap gap-1">
            {FONT_SIZE_PRESETS.map((px) => (
              <button
                key={px}
                type="button"
                aria-pressed={custom === px}
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setTextFontSize(target, px)}
                className={cn(chipClass(custom === px), 'min-w-8 tabular-nums')}
              >
                {px}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={!isEditingText && custom === undefined}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setTextFontSize(target, null);
              close();
            }}
            className={cn(chipClass(!isEditingText && custom === undefined), 'flex h-6 items-center justify-center px-2')}
          >
            Predefinita
          </button>
        </div>
      )}
    </ToolbarPopover>
  );
};

interface FontSizeInputProps {
  value: number | undefined;
  disabled: boolean;
  onCommit: (px: number) => void;
}

// Campo in px: si applica con Invio o all'uscita; un valore non valido torna a quello attuale.
const FontSizeInput: React.FC<FontSizeInputProps> = ({ value, disabled, onCommit }) => {
  const shown = value === undefined ? '' : String(Math.round(value * 10) / 10);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const px = Number(draft.replace(',', '.'));
    if (draft.trim() === '' || !Number.isFinite(px) || px <= 0 || draft === shown) {
      setDraft(shown);
      return;
    }
    onCommit(px);
  };

  return (
    <label className="flex h-8 flex-1 items-center gap-1 rounded-control border bg-background px-2 text-xs coarse:h-10">
      <input
        type="number"
        inputMode="numeric"
        min={MIN_FONT_SIZE_PX}
        max={MAX_FONT_SIZE_PX}
        step={1}
        aria-label="Dimensione del testo in pixel"
        placeholder="—"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className="w-full min-w-0 bg-transparent tabular-nums outline-none disabled:opacity-disabled [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="text-muted-foreground">px</span>
    </label>
  );
};
