/*
 * Linguette dei fogli sotto la mappa (mappa multilivello): selezione, aggiunta, rinomina
 * in place e gestione (duplica, sposta, elimina) dal menu contestuale.
 *
 * Perché il menu è quello della mappa: clic destro su desktop, pressione lunga su touch,
 * con la stessa chiusura su Esc e clic fuori e la stessa navigazione da tastiera.
 */
import { useEffect, useRef, useState, type FC, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SheetDto } from '@xmap/core';
import { Button, Input, cn, type MenuItem } from '@xmap/ui-kit';
import { ContextMenu } from './map/ContextMenu.js';

const LONG_PRESS_MS = 500;
/** Oltre questa distanza il tocco è uno scorrimento della barra, non una pressione lunga. */
const LONG_PRESS_SLOP_PX = 8;
const HAPTIC_MS = 12;

/** Indice della linguetta raggiunta con i tasti di navigazione (`active` = attiva, `last` = ultima). */
const NAVIGATION_TARGET: Partial<Record<string, (active: number, last: number) => number>> = {
  ArrowLeft: (active) => Math.max(0, active - 1),
  ArrowRight: (active, last) => Math.min(last, active + 1),
  Home: () => 0,
  End: (_active, last) => last,
};

export interface SheetTabsProps {
  sheets: readonly Pick<SheetDto, 'id' | 'title'>[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRename: (index: number, title: string) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

interface MenuState {
  x: number;
  y: number;
  index: number;
}

interface PressState {
  timer: number;
  x: number;
  y: number;
}

export const SheetTabs: FC<SheetTabsProps> = ({
  sheets,
  activeIndex,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
}) => {
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<PressState | null>(null);
  // Dopo una pressione lunga il clic che chiude il gesto non deve anche selezionare la linguetta.
  const suppressClickRef = useRef(false);
  const lastIndex = sheets.length - 1;

  const cancelPress = (): void => {
    if (!pressRef.current) return;
    window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  // Il timer non deve scattare dopo lo smontaggio della barra (es. ingresso in Zen durante la pressione).
  useEffect(
    () => () => {
      if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    },
    []
  );

  const onTabContextMenu = (event: MouseEvent<HTMLButtonElement>, index: number): void => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, index });
  };

  const onTabPointerDown = (event: PointerEvent<HTMLButtonElement>, index: number): void => {
    suppressClickRef.current = false;
    if (event.pointerType === 'mouse') return;
    cancelPress();
    const { clientX: x, clientY: y } = event;
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      suppressClickRef.current = true;
      navigator.vibrate?.(HAPTIC_MS);
      setMenu({ x, y, index });
    }, LONG_PRESS_MS);
    pressRef.current = { timer, x, y };
  };

  const onTabPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const press = pressRef.current;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };

  const onTabClick = (index: number): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (index !== activeIndex) onSelect(index);
  };

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'F2') {
      event.preventDefault();
      setRenamingIndex(activeIndex);
      return;
    }
    const targetFor = NAVIGATION_TARGET[event.key];
    if (!targetFor) return;
    const next = targetFor(activeIndex, lastIndex);
    event.preventDefault();
    if (next !== activeIndex) onSelect(next);
    tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]').item(next)?.focus();
  };

  const commitRename = (index: number, title: string): void => {
    setRenamingIndex(null);
    if (sheets[index]?.title !== title) onRename(index, title);
  };

  const menuItemsFor = (index: number): MenuItem[] => [
    { id: 'rename', label: 'Rinomina', icon: <Pencil className="size-4" />, onSelect: () => setRenamingIndex(index) },
    { id: 'duplicate', label: 'Duplica', icon: <Copy className="size-4" />, onSelect: () => onDuplicate(index) },
    {
      id: 'move-left',
      label: 'Sposta a sinistra',
      icon: <ChevronLeft className="size-4" />,
      disabled: index === 0,
      separatorBefore: true,
      onSelect: () => onMove(index, index - 1),
    },
    {
      id: 'move-right',
      label: 'Sposta a destra',
      icon: <ChevronRight className="size-4" />,
      disabled: index === lastIndex,
      onSelect: () => onMove(index, index + 1),
    },
    {
      id: 'delete',
      label: 'Elimina',
      icon: <Trash2 className="size-4" />,
      danger: true,
      separatorBefore: true,
      disabled: sheets.length <= 1,
      onSelect: () => onDelete(index),
    },
  ];

  const renderTab = (sheet: Pick<SheetDto, 'id' | 'title'>, index: number) => {
    const key = sheet.id ?? index;
    if (index === renamingIndex) {
      return (
        <SheetTitleInput
          key={key}
          initialTitle={sheet.title}
          onCommit={(title) => commitRename(index, title)}
          onCancel={() => setRenamingIndex(null)}
        />
      );
    }
    const selected = index === activeIndex;
    return (
      <Button
        key={key}
        role="tab"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        size="xs"
        variant={selected ? 'ghost' : 'ghost-muted'}
        title={sheet.title}
        className={cn(
          'max-w-48 shrink-0 coarse:h-9',
          selected && 'bg-sidebar-row-active shadow-control text-foreground font-medium',
        )}
        onClick={() => onTabClick(index)}
        onDoubleClick={() => setRenamingIndex(index)}
        onContextMenu={(event) => onTabContextMenu(event, index)}
        onPointerDown={(event) => onTabPointerDown(event, index)}
        onPointerMove={onTabPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
      >
        <span className="truncate">{sheet.title}</span>
      </Button>
    );
  };

  return (
    <div className="flex h-[calc(2.25rem+env(safe-area-inset-bottom))] coarse:h-[calc(2.75rem+env(safe-area-inset-bottom))] shrink-0 items-center gap-1 border-t bg-sidebar px-2 pb-[env(safe-area-inset-bottom)]">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Fogli"
        onKeyDown={onTablistKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {sheets.map((sheet, index) => renderTab(sheet, index))}
      </div>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        className="coarse:size-9"
        title="Nuovo foglio"
        aria-label="Nuovo foglio"
        onClick={onAdd}
      >
        <Plus />
      </Button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.index)}
          onClose={() => setMenu(null)}
          ariaLabel="Menu contestuale foglio"
        />
      )}
    </div>
  );
};

interface SheetTitleInputProps {
  initialTitle: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}

/** Titolo in place: Invio o perdita del focus confermano, Esc annulla, un titolo vuoto annulla. */
const SheetTitleInput: FC<SheetTitleInputProps> = ({ initialTitle, onCommit, onCancel }) => {
  const [draft, setDraft] = useState(initialTitle);
  // Invio, blur ed Esc possono susseguirsi (lo smontaggio toglie il focus): si chiude una sola volta.
  const settledRef = useRef(false);

  const settle = (commit: boolean): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    const title = draft.trim();
    if (commit && title) onCommit(title);
    else onCancel();
  };

  return (
    <Input
      autoFocus
      size="sm"
      aria-label="Titolo del foglio"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        // Il titolo non deve far scattare le scorciatoie della mappa (tasti, Ctrl+lettera, Esc).
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          settle(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settle(false);
        }
      }}
      className="w-40 shrink-0"
    />
  );
};
