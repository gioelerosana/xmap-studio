import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from './utils.js';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const icons = {
    info: <Info className="w-4 h-4 text-[var(--adw-accent-color)] shrink-0" />,
    success: <CheckCircle2 className="w-4 h-4 text-[var(--adw-success-color)] shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-[var(--adw-warning-color)] shrink-0" />,
    error: <AlertCircle className="w-4 h-4 text-[var(--adw-destructive-color)] shrink-0" />,
  };

  return (
    <div
      role="status"
      className={cn(
        'flex items-center space-x-2.5 px-4 py-2.5 rounded-full shadow-lg border text-xs font-medium select-none pointer-events-auto transition-all animate-in fade-in slide-in-from-bottom-2',
        'bg-white dark:bg-[#383838] text-[var(--adw-fg-color)] border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.15)] shadow-[0_4px_16px_rgba(0,0,0,0.2)]'
      )}
    >
      {icons[toast.type]}
      <span className="max-w-md truncate">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="opacity-50 hover:opacity-100 p-0.5 rounded-full focus:outline-none"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 inset-x-0 flex flex-col items-center space-y-2 pointer-events-none z-50">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
