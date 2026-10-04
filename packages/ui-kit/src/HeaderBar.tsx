import React from 'react';
import { cn } from './utils.js';
import { WindowControls, WindowControlsProps } from './WindowControls.js';

export interface HeaderBarProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  leftContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  showWindowControls?: boolean;
  windowControlProps?: WindowControlsProps;
  className?: string;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  title,
  subtitle,
  leftContent,
  centerContent,
  rightContent,
  showWindowControls = false,
  windowControlProps,
  className,
}) => {
  return (
    <header
      className={cn(
        'app-drag-region h-12 flex items-center justify-between px-3 border-b select-none transition-colors duration-150',
        'bg-[var(--adw-headerbar-bg)] border-[var(--adw-headerbar-border)] text-[var(--adw-fg-color)]',
        className
      )}
    >
      {/* Sinistra: Azioni Principali */}
      <div className="app-no-drag flex items-center space-x-1.5 min-w-[200px]">
        {leftContent}
      </div>

      {/* Centro: Titolo / Outliner Switcher */}
      <div className="flex-1 flex flex-col items-center justify-center pointer-events-none px-4 overflow-hidden">
        {centerContent ? (
          <div className="app-no-drag pointer-events-auto">{centerContent}</div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center truncate max-w-full">
            {title && (
              <span className="text-sm font-semibold truncate tracking-tight">
                {title}
              </span>
            )}
            {subtitle && (
              <span className="text-[11px] opacity-60 truncate">
                {subtitle}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Destra: Azioni secondarie e Window Controls */}
      <div className="app-no-drag flex items-center space-x-1.5 min-w-[200px] justify-end">
        {rightContent}
        {showWindowControls && (
          <WindowControls {...windowControlProps} />
        )}
      </div>
    </header>
  );
};
