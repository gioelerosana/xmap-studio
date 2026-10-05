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
        'app-drag-region relative h-12 shrink-0 flex items-center gap-3 px-3 border-b select-none',
        'bg-[var(--adw-headerbar-bg)] border-[var(--adw-headerbar-border)] text-[var(--adw-fg-color)]',
        className
      )}
    >
      {/* Sinistra: identità file + azioni primarie */}
      <div className="app-no-drag flex items-center gap-2 min-w-0">
        {leftContent}
      </div>

      {/* Destra: switcher, azioni secondarie, controlli finestra */}
      <div className="app-no-drag flex items-center gap-2 min-w-0 ml-auto">
        {centerContent}
        {rightContent}
        {showWindowControls && <WindowControls {...windowControlProps} />}
      </div>

      {/* Titolo centrato in overlay, non occupa spazio nel flusso */}
      {title && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 flex flex-col items-center max-w-[40%]">
          <span className="text-[13px] font-semibold truncate max-w-full">{title}</span>
          {subtitle && (
            <span className="text-[11px] text-[var(--adw-muted-color)] truncate max-w-full -mt-0.5">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </header>
  );
};
