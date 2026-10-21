import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@xmap/ui-kit';

import { FOCUS_RING, chipClass, swatchHairline, swatchSelected } from './classes.js';

// Selettore colore compatto: pulsante con il pallino del colore corrente che apre una griglia.
export const ColorPopover: React.FC<{
  label: string;
  value: string | null;
  colors: string[];
  noneLabel: string;
  onSelect: (value: string | null) => void;
}> = ({ label, value, colors, noneLabel, onSelect }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (c: string | null) => {
    onSelect(c);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label}: ${value ?? noneLabel}`}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className={cn('flex h-7 items-center gap-1 rounded-sm border px-1.5 hover:bg-accent', FOCUS_RING)}
      >
        <span
          className={cn('size-4 rounded-full', swatchHairline, !value && 'bg-foreground/80')}
          style={value ? { backgroundColor: value } : undefined}
        />
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="group"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-1 flex w-44 flex-col gap-2 rounded-md border bg-background p-2 shadow-dialog"
        >
          <button
            type="button"
            aria-pressed={!value}
            onClick={() => pick(null)}
            className={cn(chipClass(!value), 'flex h-6 items-center justify-center px-2')}
          >
            {noneLabel}
          </button>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`${label} ${c}`}
                aria-pressed={value?.toLowerCase() === c.toLowerCase()}
                onClick={() => pick(c)}
                className={cn(
                  'size-5 rounded-full',
                  FOCUS_RING,
                  value?.toLowerCase() === c.toLowerCase() ? swatchSelected : swatchHairline
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
