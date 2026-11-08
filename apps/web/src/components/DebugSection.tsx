/*
 * Menu Debug delle impostazioni, visibile solo dopo averlo attivato dalla versione
 * nella sezione Informazioni (come le "opzioni sviluppatore" di Android).
 *
 * Mostra il rapporto di ambiente e il log in memoria. Tutto resta sul dispositivo:
 * il rapporto si copia o si scarica solo su richiesta esplicita.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import { Button, SegmentedControl, cn } from '@xmap/ui-kit';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import { clearLog, formatValue, useLogEntries, type LogEntry, type LogLevel } from '../debugLog.js';
import { collectDebugSnapshot, formatDebugReport, type DebugSnapshot } from '../debugInfo.js';
import { saveBytes } from '../adapters/fileSystem.js';

interface DebugSectionProps {
  onDisable: () => void;
}

type LevelFilter = 'all' | 'info' | 'warn' | 'error';
type SourceFilter = 'interface' | 'main' | 'both';
type Feedback = { tone: 'ok' | 'error'; text: string };

/** Quanto resta visibile il messaggio "Copiato". */
const COPIED_FEEDBACK_MS = 2000;

const LEVEL_ITEMS: { id: LevelFilter; label: string }[] = [
  { id: 'all', label: 'Tutti' },
  { id: 'error', label: 'Errori' },
  { id: 'warn', label: 'Avvisi+' },
  { id: 'info', label: 'Info+' },
];

/** Soglia del filtro: si mostrano i livelli uguali o superiori. */
const MIN_LEVEL: Record<LevelFilter, LogLevel> = { all: 'debug', info: 'info', warn: 'warn', error: 'error' };
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SOURCE_ITEMS: { id: SourceFilter; label: string }[] = [
  { id: 'interface', label: 'Interfaccia' },
  { id: 'main', label: 'Principale' },
  { id: 'both', label: 'Entrambi' },
];

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-info-foreground',
  warn: 'text-warning-foreground',
  error: 'text-destructive',
};

const NO_ENTRIES: readonly LogEntry[] = [];

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Ora locale HH:mm:ss.SSS, indipendente dalla lingua del sistema. */
function formatTime(time: number): string {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Data e ora locali per il nome del file scaricato: YYYYMMDD-HHmmss. */
function fileStamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : formatValue(err);
}

function LogRow({ entry }: { entry: LogEntry }) {
  const summary = (
    <>
      <span className="inline-flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
        <span className="tabular-nums">{formatTime(entry.time)}</span>
        <span className={cn('font-semibold uppercase', LEVEL_CLASS[entry.level])}>{entry.level}</span>
        <span>[{entry.source}]</span>
      </span>
      <span className="block break-words whitespace-pre-wrap text-foreground select-text">{entry.message}</span>
    </>
  );

  return (
    <li className="px-2.5 py-1.5">
      {entry.detail ? (
        <details>
          <summary className="cursor-pointer">{summary}</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground select-text">{entry.detail}</pre>
        </details>
      ) : (
        summary
      )}
    </li>
  );
}

export function DebugSection({ onDisable }: DebugSectionProps) {
  const entries = useLogEntries();
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('interface');
  const mountedRef = useRef(false);
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  // Un'operazione asincrona può finire dopo la chiusura della pagina: in quel caso non si tocca lo stato.
  const flash = useCallback((next: Feedback) => {
    if (!mountedRef.current) return;
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(next);
    if (next.tone === 'ok') {
      feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), COPIED_FEEDBACK_MS);
    }
  }, []);

  const refresh = useCallback(async (): Promise<DebugSnapshot> => {
    const next = await collectDebugSnapshot();
    if (mountedRef.current) setSnapshot(next);
    return next;
  }, []);

  const reload = useCallback(() => {
    refresh().catch((err: unknown) => flash({ tone: 'error', text: `Lettura delle informazioni non riuscita: ${messageOf(err)}` }));
  }, [refresh, flash]);

  useEffect(() => {
    mountedRef.current = true;
    reload();
    return () => {
      mountedRef.current = false;
      window.clearTimeout(feedbackTimerRef.current);
    };
  }, [reload]);

  // Copia e download usano lo snapshot già caricato (il log è sempre quello attuale): niente
  // `await` prima di scrivere negli appunti, che Safari accetta solo durante il gesto dell'utente.
  const copyReport = async () => {
    if (!snapshot) return;
    try {
      if (!navigator.clipboard) throw new Error('appunti non disponibili in questo contesto');
      await navigator.clipboard.writeText(formatDebugReport(snapshot));
      flash({ tone: 'ok', text: 'Copiato' });
    } catch (err) {
      flash({ tone: 'error', text: `Copia non riuscita: ${messageOf(err)}` });
    }
  };

  // Desktop: dialogo di salvataggio nativo; browser: selettore di file o download.
  const downloadReport = async () => {
    if (!snapshot) return;
    try {
      const bytes = new TextEncoder().encode(formatDebugReport(snapshot));
      const saved = await saveBytes(bytes, `xmap-studio-debug-${fileStamp(new Date())}.txt`, 'text/plain', {
        description: 'Rapporto di debug',
        extensions: ['txt'],
      });
      if (saved) flash({ tone: 'ok', text: saved.path ? `Salvato: ${saved.path}` : 'Scaricato' });
    } catch (err) {
      flash({ tone: 'error', text: `Salvataggio non riuscito: ${messageOf(err)}` });
    }
  };

  const hasMainLog = Boolean(window.electronAPI) || (snapshot?.mainLog.length ?? 0) > 0;
  const mainEntries = snapshot?.mainLog ?? NO_ENTRIES;

  // Voci più recenti in alto: il log dell'interfaccia è in ordine cronologico, quindi si rovescia.
  const visibleEntries = useMemo(() => {
    const minRank = LEVEL_RANK[MIN_LEVEL[levelFilter]];
    const byLevel = (list: readonly LogEntry[]) => list.filter((entry) => LEVEL_RANK[entry.level] >= minRank);
    if (sourceFilter === 'interface') return byLevel(entries).reverse();
    if (sourceFilter === 'main') return byLevel(mainEntries).reverse();
    return [...byLevel(entries), ...byLevel(mainEntries)].sort((a, b) => b.time - a.time);
  }, [entries, mainEntries, levelFilter, sourceFilter]);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Debug">
        <p className="py-2.5 text-sm text-muted-foreground">
          Il log resta solo su questo dispositivo e si azzera alla chiusura dell'app. Per segnalare un problema puoi
          copiarlo o scaricarlo.
        </p>
        <div className="flex flex-col gap-2 py-2.5">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Copy />} disabled={!snapshot} onClick={() => void copyReport()}>
              Copia rapporto
            </Button>
            <Button size="sm" icon={<Download />} disabled={!snapshot} onClick={() => void downloadReport()}>
              Salva .txt
            </Button>
            <Button size="sm" icon={<RefreshCw />} onClick={reload}>
              Aggiorna
            </Button>
            <Button size="sm" icon={<Trash2 />} onClick={() => clearLog()}>
              Svuota log
            </Button>
            <Button size="sm" variant="ghost" icon={<PowerOff />} onClick={onDisable}>
              Disattiva menu Debug
            </Button>
          </div>
          <p
            aria-live="polite"
            className={cn('min-h-4 text-2xs', feedback?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
          >
            {feedback?.text}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Ambiente">
        {snapshot ? (
          snapshot.groups.map((group) => (
            <div key={group.title} className="py-2.5">
              <h3 className="mb-1.5 text-sm font-medium">{group.title}</h3>
              <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-2xs">
                {group.rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="font-mono break-all select-text">{row.value}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          ))
        ) : (
          <p className="py-2.5 text-sm text-muted-foreground">Caricamento…</p>
        )}
      </SettingsSection>

      <SettingsSection title="Log">
        <SettingRow label="Livello">
          <SegmentedControl
            aria-label="Livello del log"
            size="sm"
            items={LEVEL_ITEMS}
            activeId={levelFilter}
            onChange={setLevelFilter}
          />
        </SettingRow>
        {hasMainLog ? (
          <SettingRow label="Origine">
            <SegmentedControl
              aria-label="Origine del log"
              size="sm"
              className="max-w-full overflow-x-auto"
              items={SOURCE_ITEMS}
              activeId={sourceFilter}
              onChange={setSourceFilter}
            />
          </SettingRow>
        ) : null}
        <p className="py-2.5 text-2xs text-muted-foreground">
          {visibleEntries.length} {visibleEntries.length === 1 ? 'voce' : 'voci'}
        </p>
        <div className="mb-2.5 max-h-[28rem] overflow-y-auto rounded-md border bg-muted/40 font-mono text-2xs">
          {visibleEntries.length > 0 ? (
            <ul className="divide-y">
              {visibleEntries.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </ul>
          ) : (
            <p className="p-3 text-muted-foreground">Nessuna voce</p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
