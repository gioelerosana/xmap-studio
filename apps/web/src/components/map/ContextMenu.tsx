import React, {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { MenuItem, Separator, Shortcut, cn } from '@xmap/ui-kit';

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  items,
  onClose,
  ariaLabel = 'Menu contestuale',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Aggiusta le coordinate affinché il menu rimanga sempre interamente dentro la finestra
  useLayoutEffect(() => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const PADDING = 8;

    let left = x;
    let top = y;

    if (left + rect.width > winW - PADDING) {
      left = Math.max(PADDING, winW - rect.width - PADDING);
    }
    if (top + rect.height > winH - PADDING) {
      top = Math.max(PADDING, winH - rect.height - PADDING);
    }

    setCoords({ left, top });
  }, [x, y]);

  const enabledItems = useCallback(() => {
    return Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
  }, []);

  // All'apertura porta il focus sul primo elemento abilitato
  useEffect(() => {
    const list = enabledItems();
    list[0]?.focus();
  }, [enabledItems]);

  // Gestione tastiera per la navigazione tra le voci (frecce, Home, End, Invio)
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = enabledItems();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    let target: HTMLElement | undefined;

    switch (event.key) {
      case 'ArrowDown':
        target = list[(index + 1) % list.length];
        break;
      case 'ArrowUp':
        target = list[(index - 1 + list.length) % list.length];
        break;
      case 'Home':
        target = list[0];
        break;
      case 'End':
        target = list[list.length - 1];
        break;
      case 'Tab':
      case 'Escape':
        event.preventDefault();
        onClose();
        return;
      default:
        return;
    }

    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  // Chiusura al click fuori, tasto Esc o scroll
  useEffect(() => {
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const onGlobalKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onClose();
      }
    };

    const onScroll = () => {
      onClose();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onGlobalKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onGlobalKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ left: coords.left, top: coords.top }}
      className={cn(
        'surface-glass fixed z-50 min-w-[14rem] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)]',
        'animate-pop-in overflow-y-auto rounded-lg border p-1 text-sm text-popover-foreground shadow-dialog',
      )}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <Separator className="my-1" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              'flex h-8 coarse:h-9 w-full select-none items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors',
              'disabled:pointer-events-none disabled:opacity-disabled',
              item.danger
                ? 'text-error-foreground hover:bg-error/8 focus-visible:bg-error/8 dark:hover:bg-error/16 dark:focus-visible:bg-error/16'
                : 'text-foreground hover:bg-accent focus-visible:bg-accent',
            )}
          >
            {item.icon ? (
              <span
                className={cn(
                  'flex shrink-0 items-center [&_svg:not([class*=size-]):not([class*=w-])]:size-4',
                  item.danger ? 'text-error-foreground' : 'text-muted-foreground',
                )}
              >
                {item.icon}
              </span>
            ) : null}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut ? (
              <Shortcut
                keys={item.shortcut}
                className="shrink-0 ml-3 text-xs max-sm:hidden coarse:hidden"
              />
            ) : null}
          </button>
        </Fragment>
      ))}
    </div>
  );
};
