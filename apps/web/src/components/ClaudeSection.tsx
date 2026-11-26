import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@xmap/ui-kit';
import type { McpServerStatus } from '../app/electronBridge.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';

/** Quanto resta visibile il messaggio dopo "Copia". */
const COPY_FEEDBACK_MS = 2000;
/** Intervallo di rilettura dello stato mentre il server è in avvio (il main process non invia aggiornamenti). */
const STARTING_RETRY_MS = 1000;
/** Letture ripetute al massimo mentre il server è in avvio: oltre, resta "In avvio…" fino a una riapertura della sezione. */
const STARTING_MAX_RETRIES = 5;

type CopyTarget = 'url' | 'command' | 'json';
type Feedback = { target: CopyTarget; tone: 'ok' | 'error'; text: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stateLabel(status: McpServerStatus): { text: string; tone: 'normal' | 'error' } {
  if (status.state === 'error') return { text: status.error ?? 'Errore sconosciuto', tone: 'error' };
  if (status.state === 'starting') return { text: 'In avvio…', tone: 'normal' };
  return { text: 'In ascolto', tone: 'normal' };
}

/** Sezione "Claude" delle impostazioni: solo nell'app desktop, se il main process espone il server MCP. */
export function ClaudeSection() {
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<Feedback | null>(null);
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), []);

  // Il main process non invia un aggiornamento di stato: mentre il server è in avvio si rilegge ogni secondo, per un numero limitato di volte.
  useEffect(() => {
    if (typeof window.electronAPI?.getMcpServer !== 'function') return;

    let cancelled = false;
    let retries = 0;
    let timer: number | undefined;

    const read = () => {
      window.electronAPI?.getMcpServer?.().then(
        (next) => {
          if (cancelled) return;
          setStatus(next);
          setReadError(null);
          if (next.state === 'starting' && retries < STARTING_MAX_RETRIES) {
            retries += 1;
            timer = window.setTimeout(read, STARTING_RETRY_MS);
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          setReadError(`Impossibile leggere lo stato del server MCP: ${messageOf(err)}`);
        },
      );
    };

    read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (status === null) {
    return (
      <SettingsSection title="Claude">
        {readError ? (
          <p role="alert" className="py-2.5 text-sm text-destructive">
            {readError}
          </p>
        ) : (
          <p className="py-2.5 text-sm text-muted-foreground">Verifica dello stato in corso…</p>
        )}
      </SettingsSection>
    );
  }

  const url = status.url;
  const state = stateLabel(status);
  const connectionReady = status.state !== 'error';
  const addCommand = `claude mcp add --transport http xmap-studio ${url}`;
  const clientConfig = JSON.stringify({ mcpServers: { 'xmap-studio': { type: 'http', url } } }, null, 2);

  const flashCopy = (feedback: Feedback) => {
    setCopyFeedback(feedback);
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
  };

  // Niente `await` prima di `writeText`: Safari accetta gli appunti solo durante il gesto dell'utente.
  const copy = (target: CopyTarget, text: string) => {
    if (!navigator.clipboard) {
      flashCopy({ target, tone: 'error', text: 'Copia non riuscita: appunti non disponibili in questo contesto' });
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => flashCopy({ target, tone: 'ok', text: 'Copiato' }),
      (err: unknown) => flashCopy({ target, tone: 'error', text: `Copia non riuscita: ${messageOf(err)}` }),
    );
  };

  const feedbackFor = (target: CopyTarget) =>
    copyFeedback?.target === target ? (
      <p
        role="status"
        className={cn('text-2xs', copyFeedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
      >
        {copyFeedback.text}
      </p>
    ) : null;

  return (
    <SettingsSection title="Claude">
      <p className="py-2.5 text-sm text-muted-foreground">
        Permette a Claude Code (o a un altro client MCP) di leggere e modificare la mappa aperta in XMap Studio, tramite un
        server MCP su questo computer.
      </p>
      <SettingRow label="Stato">
        <span className={cn('text-sm', state.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
          {state.text}
        </span>
      </SettingRow>
      {connectionReady ? (
        <>
          <div className="flex min-w-0 flex-col gap-2 py-2.5">
            <div className="text-sm">Indirizzo del server</div>
            <code className="block min-w-0 break-all font-mono text-sm">{url}</code>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => copy('url', url)}>
                Copia
              </Button>
            </div>
            {feedbackFor('url')}
          </div>
          <div className="flex min-w-0 flex-col gap-2 py-2.5">
            <div className="text-sm">Claude Code</div>
            <code className="block min-w-0 break-all font-mono text-sm">{addCommand}</code>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => copy('command', addCommand)}>
                Copia
              </Button>
            </div>
            {feedbackFor('command')}
          </div>
          <div className="flex min-w-0 flex-col gap-2 py-2.5">
            <div className="text-sm">Altri client</div>
            <pre className="max-w-full overflow-x-auto rounded-control border bg-muted p-3 font-mono text-xs">
              {clientConfig}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => copy('json', clientConfig)}>
                Copia
              </Button>
            </div>
            {feedbackFor('json')}
          </div>
        </>
      ) : null}
      <p className="py-2.5 text-2xs text-muted-foreground">
        Il server è senza autenticazione e risponde solo da questo computer (127.0.0.1). XMap Studio deve restare aperto
        mentre Claude lavora sulla mappa.
      </p>
    </SettingsSection>
  );
}
