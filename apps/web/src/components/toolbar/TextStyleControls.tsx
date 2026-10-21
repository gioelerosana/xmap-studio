import React from 'react';
import { Baseline, Bold, Italic, Strikethrough, Underline } from 'lucide-react';
import type { TopicView } from '@xmap/core';
import { cn } from '@xmap/ui-kit';

import { COMPACT_QUERY } from '../../app/constants.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import type { TopicActions } from '../../app/useTopicActions.js';
import type { InlineToggleStyle } from '../map/editorBridge.js';
import { ColorPopover, sameColor } from './ColorPopover.js';
import { FOCUS_RING, swatchHairline, swatchSelected } from './classes.js';
import { BRANCH_COLORS } from './constants.js';
import { ToolbarButton } from './primitives.js';
import { setTextColor, toggleTextStyle } from './useTextStyleShortcuts.js';

const STYLE_BUTTONS: { style: InlineToggleStyle; label: string; Icon: React.ElementType }[] = [
  { style: 'bold', label: 'Grassetto (Ctrl+B)', Icon: Bold },
  { style: 'italic', label: 'Corsivo (Ctrl+I)', Icon: Italic },
  { style: 'underline', label: 'Sottolineato (Ctrl+U)', Icon: Underline },
  { style: 'strikethrough', label: 'Barrato', Icon: Strikethrough },
];

// Rosso, verde e azzurro della tavolozza: gli accessi rapidi accanto al "predefinito".
const QUICK_TEXT_COLORS = [BRANCH_COLORS[0], BRANCH_COLORS[3], BRANCH_COLORS[4]].filter(
  (color): color is string => color !== undefined,
);

interface TextStyleControlsProps {
  topic: TopicView | null;
  isEditingText: boolean;
  actions: TopicActions;
}

const Swatch: React.FC<{
  label: string;
  color: string | null;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}> = ({ label, color, selected, disabled, onPick }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={selected}
    disabled={disabled}
    // Il clic non deve togliere il focus all'editor in place.
    onPointerDown={(e) => e.preventDefault()}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onPick}
    className={cn('flex size-6 shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-disabled coarse:size-8', FOCUS_RING)}
  >
    <span
      className={cn(
        'block size-4 rounded-full transition-shadow',
        selected ? swatchSelected : swatchHairline,
        !color && 'bg-foreground',
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  </button>
);

// Stile e colore del testo: valgono per il blocco di testo selezionato, o per la selezione
// dell'editor in place mentre si scrive (vedi map/editorBridge.ts).
export const TextStyleControls: React.FC<TextStyleControlsProps> = ({ topic, isEditingText, actions }) => {
  const enabled = topic?.kind === 'text';
  const target = { topic, isEditingText, actions };
  // Durante la modifica in place lo stato della selezione parziale non è noto: nessun pulsante risulta attivo.
  const style = isEditingText ? undefined : topic?.textStyle;
  const color = style?.color ?? null;
  // Sugli schermi stretti i pallini rapidi lasciano posto a un solo pulsante con il colore attuale.
  const compact = useMediaQuery(COMPACT_QUERY);

  return (
    <>
      {STYLE_BUTTONS.map(({ style: key, label, Icon }) => (
        <ToolbarButton
          key={key}
          label={label}
          active={Boolean(style?.[key])}
          disabled={!enabled}
          onClick={() => toggleTextStyle(target, key)}
        >
          <Icon className="size-[18px]" />
        </ToolbarButton>
      ))}
      <div role="group" aria-label="Colore del testo" className="ml-1 flex items-center">
        {!compact && (
          <>
            <Swatch
              label="Colore del testo predefinito"
              color={null}
              selected={enabled && !isEditingText && color === null}
              disabled={!enabled}
              onPick={() => setTextColor(target, null)}
            />
            {QUICK_TEXT_COLORS.map((c) => (
              <Swatch
                key={c}
                label={`Colore del testo ${c}`}
                color={c}
                selected={sameColor(color, c)}
                disabled={!enabled}
                onPick={() => setTextColor(target, c)}
              />
            ))}
          </>
        )}
        <ColorPopover
          label="Colore del testo"
          value={color}
          colors={BRANCH_COLORS}
          noneLabel="Predefinito"
          disabled={!enabled}
          icon={compact ? <Baseline className="size-4" /> : undefined}
          onSelect={(c) => setTextColor(target, c)}
        />
      </div>
    </>
  );
};
