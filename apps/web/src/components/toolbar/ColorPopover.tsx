import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@xmap/ui-kit';

import { FOCUS_RING, chipClass, swatchHairline, swatchSelected } from './classes.js';
import { ToolbarButton, ToolbarPopover, useToolbarOrientation } from './primitives.js';

export const sameColor = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

interface ColorPopoverProps {
  label: string;
  value: string | null;
  colors: string[];
  noneLabel: string;
  onSelect: (value: string | null) => void;
  disabled?: boolean;
  /**
   * Icona del trigger: con l'icona il pulsante è quadrato e mostra il colore corrente in una
   * barretta sotto di essa; senza, è un piccolo chevron accanto a pallini già presenti nella barra.
   */
  icon?: React.ReactNode;
}

// Selettore colore della barra: pannello con "Predefinito" e la tavolozza completa.
export const ColorPopover: React.FC<ColorPopoverProps> = ({
  label,
  value,
  colors,
  noneLabel,
  onSelect,
  disabled,
  icon,
}) => {
  const orientation = useToolbarOrientation();
  // In verticale il chevron diventa un pulsante corto e largo sotto il controllo precedente.
  const chevronClass =
    orientation === 'vertical' ? 'h-5 w-8 coarse:h-6 coarse:w-10' : 'w-5 coarse:w-6';

  return (
    <ToolbarPopover
      align="center"
      panelClassName="flex w-44 flex-col gap-2"
      trigger={({ open, toggle }) => (
        <ToolbarButton
          label={`${label}: ${value ?? noneLabel}`}
          active={open}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(!icon && chevronClass)}
        >
          {icon ? (
            <span className="flex flex-col items-center gap-0.5">
              {icon}
              <span
                className={cn('h-[3px] w-4 rounded-full', swatchHairline, !value && 'bg-foreground/30')}
                style={value ? { backgroundColor: value } : undefined}
              />
            </span>
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </ToolbarButton>
      )}
    >
      {(close) => (
        <>
          <button
            type="button"
            aria-pressed={!value}
            onClick={() => {
              onSelect(null);
              close();
            }}
            className={cn(chipClass(!value), 'flex h-6 items-center justify-center px-2')}
          >
            {noneLabel}
          </button>
          <div role="group" aria-label={label} className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const selected = sameColor(value, c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`${label} ${c}`}
                  aria-pressed={selected}
                  onClick={() => {
                    onSelect(c);
                    close();
                  }}
                  className={cn('size-5 rounded-full', FOCUS_RING, selected ? swatchSelected : swatchHairline)}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
        </>
      )}
    </ToolbarPopover>
  );
};
