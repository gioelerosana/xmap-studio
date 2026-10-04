import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { cn } from './utils.js';

export interface WindowControlsProps {
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
  className?: string;
}

export const WindowControls: React.FC<WindowControlsProps> = ({
  onMinimize,
  onMaximize,
  onClose,
  isMaximized = false,
  className,
}) => {
  return (
    <div className={cn('app-no-drag flex items-center space-x-2 pl-3', className)}>
      <button
        type="button"
        title="Riduci a icona"
        aria-label="Riduci a icona"
        onClick={onMinimize}
        className="gnome-window-btn focus:outline-none"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title={isMaximized ? 'Ripristina' : 'Massimizza'}
        aria-label={isMaximized ? 'Ripristina' : 'Massimizza'}
        onClick={onMaximize}
        className="gnome-window-btn focus:outline-none"
      >
        <Square className="w-3 h-3" />
      </button>

      <button
        type="button"
        title="Chiudi"
        aria-label="Chiudi"
        onClick={onClose}
        className="gnome-window-btn gnome-window-btn-close focus:outline-none"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
