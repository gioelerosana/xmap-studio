import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@xmap/ui-kit';
import type { ClaudeInstallResult, ClaudeLinkStatus } from '../app/electronBridge.js';
import { useClaudeLink } from '../app/useClaudeLink.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';

/** Quanto resta visibile il messaggio dopo "Copia". */
const COPY_FEEDBACK_MS = 2000;
const REGENERATE_CONFIRM =
  "L'estensione di Claude Desktop smetterà di funzionare finché non la aggiungi di nuovo. Continuare?";

type Feedback = { tone: 'ok' | 'error'; text: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusText(status: ClaudeLinkStatus): { text: string; tone: 'normal' | 'error' } {
  if (status.state === 'error') return { text: status.error ?? 'Errore sconosciuto', tone: 'error' };
  if (status.state === 'starting') return { text: 'In avvio…', tone: 'normal' };
  if (status.clients > 0) return { text: `Collegato (${status.clients})`, tone: 'normal' };
  return { text: 'Pronto — nessun client collegato', tone: 'normal' };
}

/** Sezione "Claude" delle impostazioni: solo nell'app desktop, se il main process espone il collegamento. */
export function ClaudeSection() {
  const { status, error, regenerateKey } = useClaudeLink();
  const [copyFeedback, setCopyFeedback] = useState<Feedback | null>(null);
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<ClaudeInstallResult | null>(null);

  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), []);

  if (status === null) {
    return (
      <SettingsSection title="Claude">
        {error ? (
          <p role="alert" className="py-2.5 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p className="py-2.5 text-sm text-muted-foreground">Verifica dello stato in corso…</p>
        )}
      </SettingsSection>
    );
  }

  const command = status.claudeCodeCommand;
  const stateLabel = statusText(status);
  const failedInstall = installResult && !installResult.ok ? installResult : null;
  const failedPath = failedInstall?.path ?? null;

  const flashCopy = (feedback: Feedback) => {
    setCopyFeedback(feedback);
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
  };

  // Niente `await` prima di `writeText`: Safari accetta gli appunti solo durante il gesto dell'utente.
  const copyCommand = () => {
    if (!navigator.clipboard) {
      flashCopy({ tone: 'error', text: 'Copia non riuscita: appunti non disponibili in questo contesto' });
      return;
    }
    navigator.clipboard.writeText(command).then(
      () => flashCopy({ tone: 'ok', text: 'Copiato' }),
      (err: unknown) => flashCopy({ tone: 'error', text: `Copia non riuscita: ${messageOf(err)}` }),
    );
  };

  const installExtension = () => {
    const install = window.electronAPI?.installClaudeDesktopExtension;
    if (!install) return;
    setInstalling(true);
    setInstallResult(null);
    install()
      .then(
        (result) => setInstallResult(result),
        (err: unknown) =>
          setInstallResult({ ok: false, error: `Installazione non avviata: ${messageOf(err)}`, path: null }),
      )
      .finally(() => setInstalling(false));
  };

  const revealExtension = (path: string) => {
    const reveal = window.electronAPI?.revealClaudeExtension;
    if (!reveal) return;
    reveal().catch((err: unknown) =>
      setInstallResult({ ok: false, error: `Impossibile mostrare il file: ${messageOf(err)}`, path }),
    );
  };

  const regenerate = () => {
    if (!window.confirm(REGENERATE_CONFIRM)) return;
    void regenerateKey();
  };

  return (
    <SettingsSection title="Claude">
      <p className="py-2.5 text-sm text-muted-foreground">
        Permette a Claude Desktop e a Claude Code di leggere e modificare la mappa aperta in XMap Studio. Il collegamento
        resta su questo computer: niente porte di rete, solo un canale locale protetto da una chiave.
      </p>
      <SettingRow label="Stato">
        <span className={cn('text-sm', stateLabel.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
          {stateLabel.text}
        </span>
      </SettingRow>
      {status.desktopSupported ? (
        <div className="flex min-w-0 flex-col">
          <SettingRow label="Claude Desktop" hint="Claude Desktop chiede conferma e aggiunge l'estensione XMap Studio.">
            <Button variant="outline" size="sm" disabled={installing} onClick={installExtension}>
              Aggiungi a Claude Desktop
            </Button>
          </SettingRow>
          {installResult?.ok ? (
            <p role="status" className="-mt-1 pb-2.5 text-2xs text-muted-foreground">
              Estensione aperta in Claude Desktop: conferma l'installazione.
            </p>
          ) : null}
          {failedInstall ? (
            <div className="-mt-1 flex min-w-0 flex-col gap-2 pb-2.5">
              <p role="alert" className="min-w-0 break-words text-2xs text-destructive">
                {failedInstall.error}
              </p>
              {failedPath !== null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => revealExtension(failedPath)}>
                    Mostra il file
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2 py-2.5">
        <div className="text-sm">Claude Code</div>
        <code className="block min-w-0 break-all font-mono text-sm">{command}</code>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyCommand}>
            Copia
          </Button>
        </div>
        {copyFeedback ? (
          <p
            role="status"
            className={cn('text-2xs', copyFeedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
          >
            {copyFeedback.text}
          </p>
        ) : null}
      </div>
      <SettingRow
        label="Chiave di collegamento"
        hint="Rigenerarla scollega l'estensione di Claude Desktop finché non la aggiungi di nuovo; Claude Code la rilegge da solo."
      >
        <Button variant="outline" size="sm" onClick={regenerate}>
          Rigenera
        </Button>
      </SettingRow>
      {error ? (
        <p role="alert" className="py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="py-2.5 text-2xs text-muted-foreground">
        XMap Studio deve restare aperto mentre Claude lavora sulla mappa.
      </p>
    </SettingsSection>
  );
}
