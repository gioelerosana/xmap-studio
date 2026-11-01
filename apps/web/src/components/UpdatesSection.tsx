import { Button, Switch, cn } from '@xmap/ui-kit';
import type { UpdateInstallMode, UpdateRelease, UpdateState, UpdateStatus, UpdateStep } from '../app/electronBridge.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';

interface UpdatesSectionProps {
  /** `null` finché il main process non ha risposto. */
  status: UpdateStatus | null;
}

type ReadyState = Extract<UpdateState, { phase: 'ready' }>;

const INSTALL_MODE_LABELS: Record<UpdateInstallMode, string> = {
  appimage: 'Installazione AppImage',
  portable: 'Exe portable',
  manual: 'Installazione gestita dal sistema',
};

const INSTALL_ACTIONS: Record<UpdateInstallMode, { label: string; hint: string }> = {
  appimage: { label: 'Aggiorna ora', hint: "Scarica solo le parti cambiate (zsync) e sostituisce l'AppImage." },
  portable: { label: 'Scarica', hint: 'Scarica il nuovo exe portable accanto a quello in uso, verificato con SHA-256.' },
  manual: {
    label: 'Apri la pagina della release',
    hint: 'Questa installazione si aggiorna dal gestore di pacchetti o scaricando la release.',
  },
};

const STEP_LABELS: Record<UpdateStep, string> = {
  scanning: 'Confronto con la versione installata…',
  downloading: 'Download…',
  verifying: 'Verifica…',
  installing: 'Installazione…',
};

const CHECKED_AT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const BYTES_PER_MEGABYTE = 1_048_576;
const PERCENT = 100;

function formatCheckedAt(lastCheckedAt: number | null): string {
  return lastCheckedAt === null ? 'mai' : new Date(lastCheckedAt).toLocaleString('it-IT', CHECKED_AT_FORMAT);
}

function formatMegabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Release collegata allo stato, se esiste: il link e le note si mostrano solo in quel caso. */
function releaseOf(state: UpdateState): UpdateRelease | null {
  return 'release' in state ? state.release : null;
}

/* Le azioni passano dal main process: il nuovo stato torna con la push di `useUpdateStatus`. */
function setAutoCheck(enabled: boolean): void {
  void window.electronAPI?.setUpdateAutoCheck(enabled);
}

function checkNow(): void {
  void window.electronAPI?.checkForUpdates();
}

function installNow(): void {
  void window.electronAPI?.installUpdate();
}

function restartNow(): void {
  window.electronAPI?.restartToUpdate();
}

function UpdateProgress({ progress, label }: { progress: number | null; label: string }) {
  const percent = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * PERCENT);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={PERCENT}
      aria-valuenow={percent ?? undefined}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn('h-full rounded-full bg-primary', percent === null && 'w-1/3 animate-pulse')}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

function ReadyMessage({ state, mode }: { state: ReadyState; mode: UpdateInstallMode }) {
  if (mode !== 'appimage') {
    return (
      <p className="text-sm">
        Versione {state.release.version} scaricata in <span className="break-all font-mono text-2xs">{state.path}</span>.
        Il vecchio exe resta dov'è: puoi eliminarlo dopo il riavvio.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">Versione {state.release.version} installata: riavvia per usarla.</p>
      {state.reusedBytes > 0 ? (
        <p className="text-2xs text-muted-foreground">
          Scaricati {formatMegabytes(state.downloadedBytes)} MB, riusati {formatMegabytes(state.reusedBytes)} MB
        </p>
      ) : null}
    </div>
  );
}

function UpdateStateMessage({ state, mode }: { state: UpdateState; mode: UpdateInstallMode }) {
  if (state.phase === 'checking') return <p className="text-sm text-muted-foreground">Controllo in corso…</p>;
  if (state.phase === 'upToDate') return <p className="text-sm text-muted-foreground">Hai già la versione più recente.</p>;
  if (state.phase === 'available') return <p className="text-sm">Disponibile la versione {state.release.version}.</p>;
  if (state.phase === 'downloading') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">{STEP_LABELS[state.step]}</p>
        <UpdateProgress progress={state.progress} label={STEP_LABELS[state.step]} />
      </div>
    );
  }
  if (state.phase === 'ready') return <ReadyMessage state={state} mode={mode} />;
  if (state.phase === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }
  return null;
}

function PrimaryUpdateAction({ state, mode }: { state: UpdateState; mode: UpdateInstallMode }) {
  if (state.phase === 'available') {
    return (
      <Button size="sm" onClick={installNow}>
        {INSTALL_ACTIONS[mode].label}
      </Button>
    );
  }
  if (state.phase === 'ready') {
    return (
      <Button size="sm" onClick={restartNow}>
        {mode === 'appimage' ? 'Riavvia ora' : 'Chiudi e avvia la nuova versione'}
      </Button>
    );
  }
  if (state.phase === 'error' && state.release) {
    return (
      <Button size="sm" onClick={installNow}>
        Riprova
      </Button>
    );
  }
  return null;
}

function ReleaseDetails({ release }: { release: UpdateRelease }) {
  const notes = release.notes.trim();
  return (
    <div className="flex flex-col gap-2">
      <a
        href={release.url}
        target="_blank"
        rel="noreferrer"
        className="self-start text-sm text-primary underline-offset-4 hover:underline"
      >
        Note della release
      </a>
      {notes ? (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted p-3 font-sans text-2xs text-muted-foreground">
          {notes}
        </pre>
      ) : null}
    </div>
  );
}

/** Sezione "Aggiornamenti" delle impostazioni: solo nell'app desktop (vedi SettingsPage). */
export function UpdatesSection({ status }: UpdatesSectionProps) {
  if (status === null) {
    return (
      <SettingsSection title="Aggiornamenti">
        <p className="py-2.5 text-sm text-muted-foreground">Verifica dello stato in corso…</p>
      </SettingsSection>
    );
  }

  const { state, mode } = status;
  const release = releaseOf(state);
  const busy = state.phase === 'checking' || state.phase === 'downloading';

  return (
    <SettingsSection title="Aggiornamenti">
      <SettingRow label="Versione installata" hint={INSTALL_MODE_LABELS[mode]}>
        <span className="font-mono text-sm tabular-nums">{status.currentVersion}</span>
      </SettingRow>
      <SettingRow
        label="Controllo automatico"
        hint="Controlla GitHub all'avvio e ogni 6 ore. Nessun dato inviato oltre alla richiesta."
      >
        <Switch aria-label="Controllo automatico" checked={status.autoCheck} onCheckedChange={setAutoCheck} />
      </SettingRow>
      <SettingRow label="Ultimo controllo">
        <span className="text-sm text-muted-foreground">{formatCheckedAt(status.lastCheckedAt)}</span>
      </SettingRow>
      <div className="flex flex-col gap-3 py-2.5">
        <UpdateStateMessage state={state} mode={mode} />
        {release ? <ReleaseDetails release={release} /> : null}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryUpdateAction state={state} mode={mode} />
            <Button variant="outline" size="sm" loading={state.phase === 'checking'} disabled={busy} onClick={checkNow}>
              Controlla ora
            </Button>
          </div>
          {state.phase === 'available' ? (
            <p className="text-2xs text-muted-foreground">{INSTALL_ACTIONS[mode].hint}</p>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}
