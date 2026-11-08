import { useCallback, useState } from 'react';
import type { ToastMessage } from '@xmap/ui-kit';
import { logEvent, type LogLevel } from '../debugLog.js';

/**
 * Mostra un toast e lo registra nel log di debug. `cause` è l'errore originale:
 * non si mostra, ma nel log porta stack, codice e catena di cause.
 */
export type AddToast = (type: ToastMessage['type'], message: string, cause?: unknown) => void;

const LOG_LEVEL: Record<ToastMessage['type'], LogLevel> = {
  error: 'error',
  warning: 'warn',
  info: 'info',
  success: 'info',
};

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback<AddToast>((type, message, cause) => {
    logEvent(LOG_LEVEL[type], message, cause, 'toast');
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
