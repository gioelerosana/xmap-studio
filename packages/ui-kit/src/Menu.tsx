import React, { useEffect, useRef, useState } from 'react';
import { cn } from './utils.js';

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  items: MenuItem[];
  trigger: React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
  widthClass?: string;
}

/**
 * Menu a comparsa minimale. Il chiamante posiziona il wrapper (relative).
 */
export const Menu: React.FC<MenuProps> = ({
  items,
  trigger,
  align = 'end',
  className,
  widthClass = 'w-60',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-[calc(100%+6px)] z-50 py-1.5 rounded-lg border border-[var(--adw-card-border)] bg-[var(--adw-card-bg)] shadow-[var(--adw-shadow-md)] text-[13px]',
            widthClass,
            align === 'end' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.separatorBefore && (
                <div className="my-1.5 h-px bg-[var(--adw-hairline)]" />
              )}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors disabled:opacity-35 disabled:cursor-not-allowed',
                  item.danger
                    ? 'text-[var(--adw-destructive-color)] hover:bg-[color-mix(in_srgb,var(--adw-destructive-color)_10%,transparent)]'
                    : 'text-[var(--adw-fg-color)] hover:bg-[var(--adw-button-hover)]'
                )}
              >
                {item.icon && <span className="shrink-0 flex items-center opacity-80">{item.icon}</span>}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <span className="text-[11px] text-[var(--adw-muted-color)] font-mono">{item.shortcut}</span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
