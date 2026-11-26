import { useCallback, useEffect, useState } from 'react';
import type { ClaudeLinkStatus } from './electronBridge.js';

export interface ClaudeLinkControls {
  /** `null` finché il main process non ha risposto (o nel browser). */
  status: ClaudeLinkStatus | null;
  /** Ultimo errore di un'azione o della lettura iniziale; `null` se tutto è andato a buon fine. */
  error: string | null;
  regenerateKey: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stato del collegamento con Claude Desktop e Claude Code (socket locale del main process).
 *
 * La rigenerazione della chiave passa dal main process: il nuovo stato torna come risposta e come push
 * (`onClaudeLinkStatus`), che resta la fonte di verità. Gli errori restano visibili
 * in `error` finché l'azione successiva non riesce.
 */
export function useClaudeLink(): ClaudeLinkControls {
  const [status, setStatus] = useState<ClaudeLinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    const getLink = api?.getClaudeLink;
    const onStatus = api?.onClaudeLinkStatus;
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
        if (subscribed) setError(`Impossibile leggere lo stato di Claude: ${messageOf(err)}`);
      },
    );
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, []);

  const regenerateKey = useCallback(async (): Promise<void> => {
    const regenerate = window.electronAPI?.regenerateClaudeLinkKey;
    if (!regenerate) return;
    try {
      const next = await regenerate();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(`Impossibile generare una nuova chiave: ${messageOf(err)}`);
    }
  }, []);

  return { status, error, regenerateKey };
}
