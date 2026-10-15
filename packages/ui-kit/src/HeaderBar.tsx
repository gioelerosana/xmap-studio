/*
 * Barra superiore dell'app (CSD in Electron, normale nel browser).
 *
 * Perché il titolo è un overlay centrato: deve restare al centro della finestra
 * qualunque sia la larghezza dei gruppi di sinistra e destra, senza spingerli.
 * Le regioni trascinabili sono gestite da `.app-drag-region` (theme.css): i
 * gruppi interattivi sono `app-no-drag`, lo spazio vuoto in mezzo trascina.
 */
import type { ReactNode } from 'react';
import { cn } from './utils.js';
import { WindowControls, type WindowControlsProps } from './WindowControls.js';

export interface HeaderBarProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  leftContent?: ReactNode;
  centerContent?: ReactNode;
  rightContent?: ReactNode;
  showWindowControls?: boolean;
  windowControlProps?: WindowControlsProps;
  className?: string;
}

export function HeaderBar({
  title,
  subtitle,
  leftContent,
  centerContent,
  rightContent,
  showWindowControls = false,
  windowControlProps,
  className,
}: HeaderBarProps) {
  return (
    <header
      className={cn(
        'app-drag-region relative flex h-topbar shrink-0 select-none items-center gap-3 border-b bg-background px-3 text-foreground',
        className,
      )}
    >
      {/* Sinistra: identità file + azioni primarie */}
      <div className="app-no-drag flex min-w-0 items-center gap-1.5">{leftContent}</div>

      {/* Destra: switcher, azioni secondarie, controlli finestra */}
      <div className="app-no-drag ml-auto flex min-w-0 items-center gap-1.5">
        {centerContent}
        {rightContent}
        {showWindowControls && <WindowControls {...windowControlProps} />}
      </div>

      {/* Titolo centrato in overlay, non occupa spazio nel flusso */}
      {title ? (
        <div className="pointer-events-none absolute left-1/2 flex max-w-[40%] -translate-x-1/2 flex-col items-center">
          <span className="max-w-full truncate text-sm font-medium">{title}</span>
          {subtitle ? (
            <span className="max-w-full truncate text-2xs text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
