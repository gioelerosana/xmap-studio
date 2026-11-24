import { useEffect, useRef, useState } from 'react';
import { Button, Switch, cn } from '@xmap/ui-kit';
import type { HermesLinkStatus } from '../app/electronBridge.js';
import { useHermesLink } from '../app/useHermesLink.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';

/** Quanto resta visibile il messaggio dopo "Copia". */
const COPY_FEEDBACK_MS = 2000;
/** Caratteri finali del token lasciati visibili quando è mascherato. */
const TOKEN_VISIBLE_TAIL = 4;
const TOKEN_MASK = '••••••••';
const REGENERATE_CONFIRM =
  'I plugin già collegati verranno scollegati e dovrai inserire il nuovo token in Hermes Desktop. Continuare?';

type Feedback = { tone: 'ok' | 'error'; text: string };

function statusText(status: HermesLinkStatus): { text: string; tone: 'normal' | 'error' } {
  if (status.state === 'error') return { text: status.error ?? 'Errore sconosciuto', tone: 'error' };
  if (status.state === 'off') return { text: 'Spento', tone: 'normal' };
  if (status.clients > 0) return { text: `Collegato (${status.clients} plugin)`, tone: 'normal' };
  return { text: 'In ascolto — nessun plugin collegato', tone: 'normal' };
}

function maskToken(token: string): string {
  return `${TOKEN_MASK}${token.slice(-TOKEN_VISIBLE_TAIL)}`;
}

/** Sezione "Hermes" delle impostazioni: solo nell'app desktop, se il main process espone il collegamento. */
export function HermesSection() {
  const { status, error, setEnabled, regenerateToken } = useHermesLink();
  const [revealed, setRevealed] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<Feedback | null>(null);
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), []);

  if (status === null) {
    return (
      <SettingsSection title="Hermes">
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

  const token = status.token;
  const stateLabel = statusText(status);

  const flashCopy = (feedback: Feedback) => {
    setCopyFeedback(feedback);
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
  };

  // Niente `await` prima di `writeText`: Safari accetta gli appunti solo durante il gesto dell'utente.
  const copyToken = () => {
    if (!token) return;
    if (!navigator.clipboard) {
      flashCopy({ tone: 'error', text: 'Copia non riuscita: appunti non disponibili in questo contesto' });
      return;
    }
    navigator.clipboard.writeText(token).then(
      () => flashCopy({ tone: 'ok', text: 'Copiato' }),
      (err: unknown) =>
        flashCopy({ tone: 'error', text: `Copia non riuscita: ${err instanceof Error ? err.message : String(err)}` }),
    );
  };

  const regenerate = () => {
    if (!window.confirm(REGENERATE_CONFIRM)) return;
    void regenerateToken();
  };

  return (
    <SettingsSection title="Hermes">
      <p className="py-2.5 text-sm text-muted-foreground">
        Permette all'agente di Hermes, anche su un server remoto, di leggere e modificare la mappa aperta, passando dal
        plugin "xmap-studio" di Hermes Desktop su questo computer. Ascolta solo su questo computer (127.0.0.1) ed è
        spento di default.
      </p>
      <SettingRow label="Collega a Hermes">
        <Switch aria-label="Collega a Hermes" checked={status.enabled} onCheckedChange={(on) => void setEnabled(on)} />
      </SettingRow>
      <SettingRow label="Stato">
        <span className={cn('text-sm', stateLabel.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
          {stateLabel.text}
        </span>
      </SettingRow>
      <SettingRow label="Porta" hint="Su 127.0.0.1">
        <span className="font-mono text-sm tabular-nums">{status.port}</span>
      </SettingRow>
      <div className="flex flex-col gap-2 py-2.5">
        <div className="text-sm">Token</div>
        {token ? (
          <>
            <code className="break-all font-mono text-sm">{revealed ? token : maskToken(token)}</code>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevealed((value) => !value)}>
                {revealed ? 'Nascondi' : 'Mostra'}
              </Button>
              <Button variant="outline" size="sm" onClick={copyToken}>
                Copia
              </Button>
              <Button variant="outline" size="sm" onClick={regenerate}>
                Rigenera
              </Button>
            </div>
            {copyFeedback ? (
              <p
                role="status"
                className={cn(
                  'text-2xs',
                  copyFeedback.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {copyFeedback.text}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-2xs text-muted-foreground">Viene creato alla prima accensione.</p>
        )}
      </div>
      <p className="py-2.5 text-2xs text-muted-foreground">
        In Hermes Desktop: Impostazioni → Plugin → XMap Studio, inserisci porta e token.
      </p>
      {error ? (
        <p role="alert" className="py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </SettingsSection>
  );
}
