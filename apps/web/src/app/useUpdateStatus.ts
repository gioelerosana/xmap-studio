import { useEffect, useState } from 'react';
import type { UpdateStatus } from './electronBridge.js';

/**
 * Stato degli aggiornamenti dell'app desktop.
 *
 * Restituisce `null` nel browser e finché il main process non risponde. Lo stato
 * iniziale può arrivare dopo una push: si tiene quello più recente (la push).
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let subscribed = true;
    const unsubscribe = api.onUpdateStatus((next) => {
      if (subscribed) setStatus(next);
    });
    const loadInitial = async (): Promise<void> => {
      const initial = await api.getUpdateStatus();
      if (subscribed) setStatus((current) => current ?? initial);
    };
    void loadInitial();
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, []);

  return status;
}

/** Vero quando c'è una versione nuova da installare o da riavviare. */
export function hasPendingUpdate(status: UpdateStatus | null): boolean {
  const phase = status?.state.phase;
  return phase === 'available' || phase === 'ready';
}
