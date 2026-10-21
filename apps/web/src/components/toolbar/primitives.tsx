import React, { createContext, forwardRef, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@xmap/ui-kit';

import { FOCUS_RING, swatchHairline, swatchSelected } from './classes.js';

// Primitive della barra flottante: tutte impediscono il furto del focus, così i comandi
// agiscono sulla selezione dell'editor in place senza chiuderlo (vedi map/editorBridge.ts).
const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

/** Orientamento della barra: `vertical` quando è agganciata a un lato (sinistro o destro). */
export type ToolbarOrientation = 'horizontal' | 'vertical';

/** Fornito dalla radice della barra (`FloatingToolbar`); i controlli lo leggono per ruotarsi. */
export const ToolbarOrientationContext = createContext<ToolbarOrientation>('horizontal');

export const useToolbarOrientation = (): ToolbarOrientation => useContext(ToolbarOrientationContext);

export interface ToolbarButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Nome accessibile e tooltip (obbligatorio: il bottone mostra solo l'icona). */
  label: string;
  /** Stato attivo (toggle): sfondo `accent`, `aria-pressed`. */
  active?: boolean;
  children: React.ReactNode;
}

/** Bottone quadrato 32px (40px su touch) con icona Lucide `size-4`. */
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
        'flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors coarse:size-10',
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

/** Separatore tra gruppi di comandi: verticale nella barra orizzontale, orizzontale in quella a colonna. */
export const ToolbarSeparator: React.FC = () => {
  const orientation = useToolbarOrientation();
  if (orientation === 'vertical') {
    return <div role="separator" aria-orientation="horizontal" className="my-0.5 h-px w-4 shrink-0 bg-border" />;
  }
  return <div role="separator" aria-orientation="vertical" className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
};

export interface ToolbarSwatchProps {
  label: string;
  /** `null` = "predefinito": pallino pieno `emptyClassName` (default colore del testo). */
  color: string | null;
  selected: boolean;
  disabled?: boolean;
  onPick: () => void;
  /** Aspetto del pallino senza colore (es. tratteggiato per "nessun colore del ramo"). */
  emptyClassName?: string;
}

/** Pallino di colore cliccabile della barra (24px, 32px su touch): non ruba il focus. */
export const ToolbarSwatch: React.FC<ToolbarSwatchProps> = ({ label, color, selected, disabled, onPick, emptyClassName }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={selected}
    disabled={disabled}
    onPointerDown={keepFocus}
    onMouseDown={keepFocus}
    onClick={onPick}
    className={cn('flex size-6 shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-disabled coarse:size-8', FOCUS_RING)}
  >
    <span
      className={cn(
        'block size-4 rounded-full transition-shadow',
        selected ? swatchSelected : swatchHairline,
        !color && (emptyClassName ?? 'bg-foreground'),
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  </button>
);

export interface ToolbarPopoverProps {
  /** Bottone che apre il pannello; riceve lo stato e il toggle. */
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
  /** Contenuto del pannello; `close` lo chiude (es. dopo una scelta). */
  children: (close: () => void) => React.ReactNode;
  /** Classi del pannello (larghezza, padding). */
  panelClassName?: string;
  /** Allineamento orizzontale del pannello rispetto al trigger (solo barra in alto/in basso; ignorato sui lati). */
  align?: 'start' | 'center' | 'end';
  /** Se il pannello contiene campi di testo deve poter prendere il focus (default false). */
  focusable?: boolean;
}

const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 8;

interface PanelPlacement {
  left: number;
  top?: number;
  bottom?: number;
}

const HALF = 0.5;

/** Ascissa sinistra del pannello (larghezza `width`) rispetto al rettangolo del trigger. */
const alignedLeft = (align: 'start' | 'center' | 'end', anchor: DOMRect, width: number): number => {
  if (align === 'start') return anchor.left;
  if (align === 'end') return anchor.right - width;
  return anchor.left + (anchor.width - width) * HALF;
};

/** Ascissa di un pannello di larghezza `size` tenuta dentro la finestra con il margine minimo. */
const clampToViewport = (value: number, size: number, viewportSize: number): number =>
  Math.max(VIEWPORT_MARGIN, Math.min(value, viewportSize - size - VIEWPORT_MARGIN));

/**
 * Ascissa del pannello quando la barra è agganciata a un lato: `left` lo mette a destra del trigger,
 * `right` a sinistra. Se il lato preferito non ha spazio si passa all'altro, se c'è.
 */
const sideLeft = (dock: 'left' | 'right', anchor: DOMRect, width: number): number => {
  const rightOfTrigger = anchor.right + PANEL_GAP;
  const leftOfTrigger = anchor.left - PANEL_GAP - width;
  const preferred = dock === 'left' ? rightOfTrigger : leftOfTrigger;
  const other = dock === 'left' ? leftOfTrigger : rightOfTrigger;
  const fits = (left: number): boolean => left >= VIEWPORT_MARGIN && left + width <= window.innerWidth - VIEWPORT_MARGIN;
  return fits(preferred) || !fits(other) ? preferred : other;
};

/**
 * Pannello ancorato a un bottone della barra: si apre sotto il trigger (sopra quando la barra
 * è agganciata in basso, `data-dock="bottom"` sul contenitore). Agganciata a un lato
 * (`data-dock="left"` o `"right"`) si apre accanto al trigger, con il bordo superiore allineato
 * a quello del trigger. Si chiude con clic fuori o Esc.
 * Il pannello è reso in un portale con posizione `fixed` calcolata dal trigger: così l'`overflow`
 * della barra (scorrimento orizzontale su schermi stretti) non lo taglia.
 */
export const ToolbarPopover: React.FC<ToolbarPopoverProps> = ({
  trigger,
  children,
  panelClassName,
  align = 'center',
  focusable = false,
}) => {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    // La posizione si calcola all'apertura: se la finestra cambia misura il pannello si chiude.
    const onResize = () => setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!open || !root || !panel) {
      setPlacement(null);
      return;
    }
    const anchor = root.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const dock = root.closest<HTMLElement>('[data-dock]')?.dataset.dock;
    if (dock === 'left' || dock === 'right') {
      setPlacement({
        left: sideLeft(dock, anchor, width),
        top: clampToViewport(anchor.top, height, window.innerHeight),
      });
      return;
    }
    const roomBelow = window.innerHeight - anchor.bottom - PANEL_GAP - VIEWPORT_MARGIN;
    const roomAbove = anchor.top - PANEL_GAP - VIEWPORT_MARGIN;
    const docked = dock === 'bottom';
    // Lato preferito dall'ancoraggio della barra; si inverte solo se non c'è spazio e l'altro lato ne ha di più.
    const up = docked ? roomAbove >= height || roomAbove > roomBelow : roomBelow < height && roomAbove > roomBelow;
    const left = clampToViewport(alignedLeft(align, anchor, width), width, window.innerWidth);
    setPlacement(
      up ? { left, bottom: window.innerHeight - anchor.top + PANEL_GAP } : { left, top: anchor.bottom + PANEL_GAP },
    );
  }, [open, align]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            onPointerDown={focusable ? undefined : keepFocus}
            onMouseDown={focusable ? undefined : keepFocus}
            style={placement ?? { left: 0, top: 0, visibility: 'hidden' }}
            className={cn(
              'fixed z-40 animate-pop-in rounded-xl border bg-popover p-2 text-popover-foreground shadow-dialog',
              panelClassName,
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
};
