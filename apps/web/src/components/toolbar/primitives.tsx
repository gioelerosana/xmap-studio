import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { cn } from '@xmap/ui-kit';

import { FOCUS_RING } from './classes.js';

// Primitive della barra flottante: tutte impediscono il furto del focus, così i comandi
// agiscono sulla selezione dell'editor in place senza chiuderlo (vedi map/editorBridge.ts).
const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

export interface ToolbarButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Nome accessibile e tooltip (obbligatorio: il bottone mostra solo l'icona). */
  label: string;
  /** Stato attivo (toggle): sfondo `accent`, `aria-pressed`. */
  active?: boolean;
  children: React.ReactNode;
}

/** Bottone quadrato 36px (44px su touch) con icona Lucide `size-[18px]`. */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { label, active, className, children, onMouseDown, onPointerDown, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onPointerDown={(e) => {
        keepFocus(e);
        onPointerDown?.(e);
      }}
      onMouseDown={(e) => {
        keepFocus(e);
        onMouseDown?.(e);
      }}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors coarse:size-11',
        'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-disabled',
        FOCUS_RING,
        active && 'bg-accent text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/** Separatore verticale tra gruppi di comandi. */
export const ToolbarSeparator: React.FC = () => <div role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-border" />;

export interface ToolbarPopoverProps {
  /** Bottone che apre il pannello; riceve lo stato e il toggle. */
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
  /** Contenuto del pannello; `close` lo chiude (es. dopo una scelta). */
  children: (close: () => void) => React.ReactNode;
  /** Classi del pannello (larghezza, padding). */
  panelClassName?: string;
  /** Allineamento orizzontale del pannello rispetto al trigger. */
  align?: 'start' | 'center' | 'end';
  /** Se il pannello contiene campi di testo deve poter prendere il focus (default false). */
  focusable?: boolean;
}

/**
 * Pannello ancorato a un bottone della barra: si apre sotto il trigger (sopra quando la barra
 * è agganciata in basso, tramite la classe `group-data-[dock=bottom]` sul contenitore),
 * si chiude con clic fuori o Esc.
 */
export const ToolbarPopover: React.FC<ToolbarPopoverProps> = ({
  trigger,
  children,
  panelClassName,
  align = 'center',
  focusable = false,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="dialog"
          onPointerDown={focusable ? undefined : keepFocus}
          onMouseDown={focusable ? undefined : keepFocus}
          className={cn(
            'absolute top-full z-40 mt-2 animate-pop-in rounded-xl border bg-popover p-2 text-popover-foreground shadow-dialog',
            'group-data-[dock=bottom]:bottom-full group-data-[dock=bottom]:top-auto group-data-[dock=bottom]:mb-2 group-data-[dock=bottom]:mt-0',
            align === 'start' && 'left-0',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            align === 'end' && 'right-0',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
};
