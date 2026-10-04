import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from './utils.js';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={cn(
          'w-full rounded-2xl shadow-2xl border flex flex-col overflow-hidden animate-in zoom-in-95 duration-150',
          'bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] border-[var(--adw-card-border)]',
          maxWidth
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--adw-card-border)]">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full opacity-60 hover:opacity-100 hover:bg-[rgba(0,0,0,0.06)] dark:hover:bg-[rgba(255,255,255,0.08)] focus:outline-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[75vh]">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end space-x-2 px-5 py-3 bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.02)] border-t border-[var(--adw-card-border)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
