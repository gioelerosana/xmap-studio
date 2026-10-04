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
        'inline-flex p-0.5 rounded-lg bg-[rgba(0,0,0,0.06)] dark:bg-[rgba(255,255,255,0.08)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]',
        className
      )}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              'flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all select-none focus:outline-none',
              isActive
                ? 'bg-white dark:bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] shadow-sm font-semibold'
                : 'text-[var(--adw-fg-color)] opacity-70 hover:opacity-100 hover:bg-[rgba(0,0,0,0.03)] dark:hover:bg-[rgba(255,255,255,0.04)]'
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
