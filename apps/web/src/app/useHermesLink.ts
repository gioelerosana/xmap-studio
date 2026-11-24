import { useCallback, useEffect, useState } from 'react';
import type { HermesLinkStatus } from './electronBridge.js';

export interface HermesLinkControls {
  /** `null` finché il main process non ha risposto (o nel browser). */
  status: HermesLinkStatus | null;
  /** Ultimo errore di un'azione o della lettura iniziale; `null` se tutto è andato a buon fine. */
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<void>;
  regenerateToken: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stato del collegamento con Hermes Desktop (server WebSocket del main process).
 *
 * Le azioni passano dal main process: il nuovo stato torna come risposta e come push
 * (`onHermesLinkStatus`), che resta la fonte di verità. Gli errori restano visibili
 * in `error` finché l'azione successiva non riesce.
 */
export function useHermesLink(): HermesLinkControls {
  const [status, setStatus] = useState<HermesLinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    const getLink = api?.getHermesLink;
    const onStatus = api?.onHermesLinkStatus;
    if (!getLink || !onStatus) return;

    let subscribed = true;
    const unsubscribe = onStatus((next) => {
      if (subscribed) setStatus(next);
    });
    getLink().then(
      (initial) => {
        if (subscribed) setStatus((current) => current ?? initial);
      },
      (err: unknown) => {
        if (subscribed) setError(`Impossibile leggere lo stato di Hermes: ${messageOf(err)}`);
      },
    );
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, []);

  const setEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    const set = window.electronAPI?.setHermesLinkEnabled;
    if (!set) return;
    try {
      const next = await set(enabled);
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(`Impossibile ${enabled ? 'accendere' : 'spegnere'} il collegamento: ${messageOf(err)}`);
    }
  }, []);

  const regenerateToken = useCallback(async (): Promise<void> => {
    const regenerate = window.electronAPI?.regenerateHermesLinkToken;
    if (!regenerate) return;
    try {
      const next = await regenerate();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(`Impossibile generare un nuovo token: ${messageOf(err)}`);
    }
  }, []);

  return { status, error, setEnabled, regenerateToken };
}
