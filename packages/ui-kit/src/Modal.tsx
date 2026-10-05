import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from './utils.js';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
      <div
        className={cn(
          'w-full rounded-xl shadow-[var(--adw-shadow-md)] border flex flex-col overflow-hidden',
          'bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] border-[var(--adw-card-border)]',
          maxWidth
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--adw-hairline)]">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight truncate">{title}</h2>
            {description && (
              <p className="text-xs text-[var(--adw-muted-color)] mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="shrink-0 p-1 rounded-md text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)] hover:bg-[var(--adw-button-hover)] focus:outline-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[75vh]">{children}</div>

        {footer && (
          <div className="flex items-center gap-2 px-5 py-3.5 bg-[var(--adw-surface)] border-t border-[var(--adw-hairline)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
