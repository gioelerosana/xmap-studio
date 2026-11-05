/*
 * Sezione Nextcloud nelle impostazioni: collegamento con Login Flow v2.
 *
 * Perché il popup si apre subito nel gesto dell'utente: iOS blocca le finestre
 * aperte dopo un `await`. Il popup nasce vuoto e vi si carica la pagina di
 * accesso solo quando il server ha risposto. Se il browser lo blocca comunque,
 * il link "Apri la pagina di accesso" resta come alternativa.
 */
import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Input, Spinner, buttonVariants } from '@xmap/ui-kit';
import {
  normalizeServerUrl,
  pollLoginFlow,
  startLoginFlow,
  type LoginFlow,
  type NextcloudAccount,
} from '@xmap/core';
import { nextcloudAvailable, nextcloudTransport, useNextcloudAccount } from '../adapters/nextcloud.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';

const POLL_INTERVAL_MS = 2000;
const LOGIN_TIMEOUT_MS = 20 * 60 * 1000;

interface PendingLogin {
  server: string;
  flow: LoginFlow;
  startedAt: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Errore imprevisto. Riprova.';
}

/** Solo l'host per la riga di stato: `cloud.esempio.it` invece dell'URL completo. */
function hostOf(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

export function NextcloudSection(): React.JSX.Element {
  const { account, connect, disconnect } = useNextcloudAccount();
  const [serverInput, setServerInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  // Ogni tentativo ha un numero: una risposta arrivata dopo l'annullamento o lo smontaggio viene ignorata.
  const attemptRef = useRef(0);
  const popupRef = useRef<Window | null>(null);

  useEffect(
    () => () => {
      attemptRef.current += 1;
      popupRef.current?.close();
      popupRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!pending) return undefined;
    let cancelled = false;
    let timer: number | undefined;

    const stop = (message: string | null) => {
      popupRef.current?.close();
      popupRef.current = null;
      setPending(null);
      setError(message);
    };

    // Un poll alla volta: il successivo parte solo quando il precedente è risolto.
    const tick = async () => {
      if (Date.now() - pending.startedAt >= LOGIN_TIMEOUT_MS) {
        stop('Tempo scaduto: riprova.');
        return;
      }
      let granted: NextcloudAccount | null;
      try {
        granted = await pollLoginFlow(pending.server, pending.flow, nextcloudTransport());
      } catch (err) {
        if (!cancelled) stop(errorMessage(err));
        return;
      }
      if (cancelled) return;
      if (granted) {
        stop(null);
        connect(granted);
        return;
      }
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pending, connect]);

  const onConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    let server: string;
    try {
      server = normalizeServerUrl(serverInput);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }

    // Deve restare prima di qualsiasi `await`: vedi il commento in testa al file.
    // Niente `opener = null`: senza il legame con la finestra il browser non permette più di portarla
    // alla pagina di accesso (la finestra resterebbe vuota).
    const popup = window.open('', '_blank');

    const attempt = ++attemptRef.current;
    setStarting(true);
    try {
      const flow = await startLoginFlow(server, nextcloudTransport());
      if (attempt !== attemptRef.current) {
        popup?.close();
        return;
      }
      if (popup) popup.location.href = flow.loginUrl;
      popupRef.current = popup;
      setPending({ server, flow, startedAt: Date.now() });
    } catch (err) {
      popup?.close();
      if (attempt === attemptRef.current) setError(errorMessage(err));
    } finally {
      if (attempt === attemptRef.current) setStarting(false);
    }
  };

  const cancel = () => {
    attemptRef.current += 1;
    popupRef.current?.close();
    popupRef.current = null;
    setPending(null);
    setError(null);
  };

  const onDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  // Nell'app desktop la sezione non compare: il controllo è qui, dopo gli hook.
  if (!nextcloudAvailable()) return <></>;

  return (
    <SettingsSection title="Nextcloud">
      <p className="py-2.5 text-sm text-muted-foreground">
        Facoltativo: collegando un account puoi aprire e salvare le mappe .xmind direttamente su Nextcloud. Il
        collegamento usa una app password dedicata, revocabile in qualsiasi momento da Nextcloud › Impostazioni ›
        Sicurezza, e resta solo in questo browser. Le richieste passano dal sito di XMap Studio soltanto per aggirare
        l’assenza di CORS su Nextcloud: lì non viene memorizzato nulla.
      </p>

      {account ? (
        <div aria-live="polite">
          <SettingRow
            label={`Collegato come ${account.displayName || account.userId}`}
            hint={`Server: ${hostOf(account.server)}`}
          >
            <Button variant="destructive-outline" size="sm" loading={disconnecting} onClick={() => void onDisconnect()}>
              Scollega
            </Button>
          </SettingRow>
        </div>
      ) : pending ? (
        <div role="status" className="flex flex-col gap-3 py-2.5">
          <p className="flex items-center gap-2 text-sm">
            <Spinner />
            Autorizza XMap Studio nella pagina di Nextcloud…
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={pending.flow.loginUrl}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Apri la pagina di accesso
            </a>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Annulla
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onConnect} className="flex flex-col gap-3 py-2.5">
          <Field label="Indirizzo del server" error={error ?? undefined}>
            <Input
              value={serverInput}
              onChange={(event) => setServerInput(event.target.value)}
              placeholder="cloud.esempio.it"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div>
            <Button type="submit" loading={starting}>
              Collega
            </Button>
          </div>
        </form>
      )}
    </SettingsSection>
  );
}
