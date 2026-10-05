import React from 'react';
import { cn } from './utils.js';

export interface ViewSwitcherItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export interface ViewSwitcherProps<T extends string> {
  items: ViewSwitcherItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
}

export function ViewSwitcher<T extends string>({
  items,
  activeId,
  onChange,
  className,
}: ViewSwitcherProps<T>): React.ReactElement {
  return (
    <div
      className={cn(
        'inline-flex items-center p-0.5 rounded-lg bg-[var(--adw-surface)] border border-[var(--adw-card-border)]',
        className
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors select-none focus:outline-none',
              active
                ? 'bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] shadow-[var(--adw-shadow-sm)]'
                : 'text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
            )}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
