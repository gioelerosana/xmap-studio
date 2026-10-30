/*
 * Menu a tendina con lo stile dei campi, disegnato dall'app (listbox personalizzato).
 *
 * Perché non più `<select>` nativo: l'elenco aperto lo disegna il browser con i
 * suoi colori di sistema e ignora il tema dell'app (in scuro risultava bianco
 * con testo bianco). Qui l'elenco è un `role="listbox"` in un portale su `body`,
 * con il tema dell'app e la tastiera gestita a mano (frecce, Home/End,
 * typeahead, Invio, Esc, Tab).
 *
 * Perché i listener in cattura: l'elenco esce dal DOM del campo, quindi il clic
 * fuori va verificato a mano. L'Esc è intercettato in cattura su `window` così
 * chiude solo l'elenco, non anche un Modal o un popover che lo contiene. Il
 * `pointerdown` dell'elenco non risale a `window`: altrimenti la barra flottante
 * chiuderebbe il suo pannello al clic su una voce.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './utils.js';
import { CONTROL_FIELD, CONTROL_HEIGHT, controlShell, type ControlSize } from './shared.js';

export interface SelectOption<T extends string | number = string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number = string | number> {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  size?: ControlSize;
  invalid?: boolean;
  disabled?: boolean;
  /** Classi del contenitore, come per gli altri campi. */
  className?: string;
  id?: string;
  'aria-label'?: string;
  /** Mostrato se nessuna opzione corrisponde a `value`. */
  placeholder?: string;
}

const PADDING: Record<ControlSize, string> = {
  sm: 'pl-[9px] pr-7',
  default: 'pl-[11px] pr-8',
  lg: 'pl-[13px] pr-9',
};

/** Altezza massima dell'elenco (16rem): oltre, scorre. */
const LIST_MAX_HEIGHT_PX = 256;
/** Distanza tra trigger ed elenco, e margine dai bordi della finestra. */
const LIST_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;
/** Tasti che aprono l'elenco dal trigger; il default si annulla per non far scattare un clic sintetico. */
const OPEN_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Enter', ' '];

function isSelectable<T extends string | number>(option: SelectOption<T> | undefined): option is SelectOption<T> {
  return option !== undefined && option.disabled !== true;
}

/** Indici delle opzioni selezionabili, in ordine. */
function selectableIndices<T extends string | number>(options: readonly SelectOption<T>[]): number[] {
  return options.flatMap((option, index) => (isSelectable(option) ? [index] : []));
}

function firstSelectable<T extends string | number>(options: readonly SelectOption<T>[]): number {
  return selectableIndices(options)[0] ?? -1;
}

function lastSelectable<T extends string | number>(options: readonly SelectOption<T>[]): number {
  return selectableIndices(options).at(-1) ?? -1;
}

/** Opzione selezionabile successiva in una direzione, senza uscire dall'elenco. */
function stepSelectable<T extends string | number>(
  options: readonly SelectOption<T>[],
  from: number,
  step: 1 | -1,
): number {
  const indices = selectableIndices(options);
  const candidates = step === 1 ? indices.filter((index) => index > from) : indices.filter((index) => index < from).reverse();
  return candidates[0] ?? from;
}

/** Prima opzione selezionabile che inizia con il carattere digitato, cercando dopo `from` e poi dall'inizio. */
function typeaheadIndex<T extends string | number>(
  options: readonly SelectOption<T>[],
  from: number,
  char: string,
): number {
  const needle = char.toLocaleLowerCase();
  const matches = selectableIndices(options).filter((index) =>
    options[index].label.toLocaleLowerCase().startsWith(needle),
  );
  return matches.find((index) => index > from) ?? matches[0] ?? -1;
}

/** Il carattere digitato va al typeahead: niente Ctrl/Cmd/Alt, e un solo carattere (non "ArrowDown" ecc.). */
function isTypeaheadKey(event: KeyboardEvent<HTMLDivElement>): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

interface ListPlacement {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxHeight: number;
}

/**
 * Posizione `fixed` dell'elenco: sotto il trigger, o sopra se sotto manca spazio
 * e sopra ce n'è di più. La larghezza minima è quella del trigger.
 */
function placeList(
  anchor: DOMRect,
  listWidth: number,
  viewport: { width: number; height: number },
): ListPlacement {
  const roomBelow = viewport.height - anchor.bottom - LIST_GAP_PX - VIEWPORT_MARGIN_PX;
  const roomAbove = anchor.top - LIST_GAP_PX - VIEWPORT_MARGIN_PX;
  const width = Math.max(listWidth, anchor.width);
  const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, viewport.width - VIEWPORT_MARGIN_PX - width));
  const above = roomBelow < LIST_MAX_HEIGHT_PX && roomAbove > roomBelow;
  const room = above ? roomAbove : roomBelow;
  const shared = { left, minWidth: anchor.width, maxHeight: Math.max(0, Math.min(LIST_MAX_HEIGHT_PX, room)) };
  return above
    ? { ...shared, bottom: viewport.height - anchor.top + LIST_GAP_PX }
    : { ...shared, top: anchor.bottom + LIST_GAP_PX };
}

function optionDomId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

interface SelectListboxProps<T extends string | number> {
  listboxId: string;
  ariaLabel?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  options: readonly SelectOption<T>[];
  selectedValue: T;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (index: number) => void;
  onDismiss: (restoreFocus: boolean) => void;
}

function SelectListbox<T extends string | number>({
  listboxId,
  ariaLabel,
  triggerRef,
  options,
  selectedValue,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onDismiss,
}: SelectListboxProps<T>): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ListPlacement | null>(null);

  // Prima del paint: posizione calcolata dal trigger, poi il focus va all'elenco per la tastiera.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    setPlacement(
      placeList(trigger.getBoundingClientRect(), list.offsetWidth, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
    list.focus({ preventScroll: true });
  }, [triggerRef]);

  useEffect(() => {
    const isInside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (listRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true);
    const onPointerDown = (event: PointerEvent): void => {
      if (!isInside(event.target)) onDismiss(false);
    };
    // Lo scroll dentro l'elenco non lo chiude; lo scroll di un antenato sì, il trigger si sposterebbe.
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && listRef.current?.contains(event.target) === true) return;
      onDismiss(false);
    };
    const onResize = (): void => onDismiss(false);
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss(true);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onDismiss, triggerRef]);

  // Vedi nota in testa: il pointerdown dell'elenco non deve arrivare ai popover antenati.
  useEffect(() => {
    const list = listRef.current;
    const stopPointerDown = (event: Event): void => event.stopPropagation();
    list?.addEventListener('pointerdown', stopPointerDown);
    return () => list?.removeEventListener('pointerdown', stopPointerDown);
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionDomId(listboxId, activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listboxId]);

  const keyActions: Partial<Record<string, () => void>> = {
    ArrowDown: () => onActiveIndexChange(stepSelectable(options, activeIndex, 1)),
    ArrowUp: () => onActiveIndexChange(stepSelectable(options, activeIndex, -1)),
    Home: () => onActiveIndexChange(firstSelectable(options)),
    End: () => onActiveIndexChange(lastSelectable(options)),
    Enter: () => onPick(activeIndex),
    ' ': () => onPick(activeIndex),
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Niente preventDefault: il Tab successivo parte dal trigger, dove è tornato il focus.
    if (event.key === 'Tab') {
      onDismiss(true);
      return;
    }
    const action = keyActions[event.key];
    if (action) {
      event.preventDefault();
      action();
      return;
    }
    if (isTypeaheadKey(event)) {
      const index = typeaheadIndex(options, activeIndex, event.key);
      if (index >= 0) onActiveIndexChange(index);
    }
  };

  return createPortal(
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-activedescendant={activeIndex >= 0 ? optionDomId(listboxId, activeIndex) : undefined}
      onKeyDown={onKeyDown}
      style={placement ?? { left: 0, top: 0 }}
      className="fixed z-[70] flex animate-pop-in flex-col overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-dialog outline-none"
    >
      {options.map((option, index) => {
        const selected = option.value === selectedValue;
        return (
          <div
            key={String(option.value)}
            id={optionDomId(listboxId, index)}
            role="option"
            aria-selected={selected}
            aria-disabled={option.disabled === true || undefined}
            onClick={() => onPick(index)}
            onPointerMove={() => onActiveIndexChange(index)}
            className={cn(
              'flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 rounded-md px-2',
              index === activeIndex && 'bg-accent',
              option.disabled === true && 'pointer-events-none opacity-disabled',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <Check aria-hidden className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function Select<T extends string | number>({
  value,
  onValueChange,
  options,
  size = 'default',
  invalid = false,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
  placeholder,
}: SelectProps<T>): ReactElement {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const closeList = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openList = (): void => {
    const current =
      selectedIndex >= 0 && isSelectable(options[selectedIndex]) ? selectedIndex : firstSelectable(options);
    setActiveIndex(current);
    setOpen(true);
  };

  const pickIndex = (index: number): void => {
    const option = options[index];
    if (!isSelectable(option)) return;
    onValueChange(option.value);
    closeList(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (open || !OPEN_KEYS.includes(event.key)) return;
    event.preventDefault();
    openList();
  };

  return (
    <span className={cn(controlShell(invalid, disabled), 'items-center', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? closeList(true) : openList())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          CONTROL_FIELD,
          'flex w-full cursor-pointer items-center text-left',
          CONTROL_HEIGHT[size],
          PADDING[size],
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', selected === undefined && 'text-muted-foreground')}>
          {selected?.label ?? placeholder ?? ''}
        </span>
      </button>
      <ChevronDown
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
          open && 'rotate-180',
        )}
      />
      {open ? (
        <SelectListbox
          listboxId={listboxId}
          ariaLabel={ariaLabel}
          triggerRef={triggerRef}
          options={options}
          selectedValue={value}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onPick={pickIndex}
          onDismiss={closeList}
        />
      ) : null}
    </span>
  );
}
