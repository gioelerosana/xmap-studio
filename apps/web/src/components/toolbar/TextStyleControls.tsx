import React from 'react';
import { Bold, ChevronDown, Italic, Strikethrough, Underline } from 'lucide-react';
import type { TopicView } from '@xmap/core';
import { cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import type { InlineToggleStyle } from '../map/editorBridge.js';
import { sameColor } from './ColorPopover.js';
import { FOCUS_RING, chipClass, swatchHairline, swatchSelected } from './classes.js';
import { BRANCH_COLORS } from './constants.js';
import { ToolbarButton, ToolbarPopover, useToolbarOrientation } from './primitives.js';
import { setTextColor, toggleTextStyle } from './useTextStyleShortcuts.js';

// Stili nel pannello "Altri stili": il grassetto resta sempre visibile sulla barra.
const POPOVER_STYLE_BUTTONS: { style: InlineToggleStyle; label: string; Icon: React.ElementType }[] = [
  { style: 'italic', label: 'Corsivo (Ctrl+I)', Icon: Italic },
  { style: 'underline', label: 'Sottolineato (Ctrl+U)', Icon: Underline },
  { style: 'strikethrough', label: 'Barrato', Icon: Strikethrough },
];

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
    </>
  );
};
