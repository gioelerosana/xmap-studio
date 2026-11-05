/*
 * Finestra per aprire o salvare un `.xmind` su Nextcloud.
 *
 * Perché il contenuto è un componente a parte montato solo da aperto: `Modal`
 * non istanzia i figli quando è chiuso, quindi ogni apertura riparte dall'ultima
 * cartella salvata con lo stato pulito, senza effetti di reset.
 */
import React, { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, ChevronRight, FileText, Folder, House } from 'lucide-react';
import { Banner, Button, Field, Input, Modal, Spinner, cn } from '@xmap/ui-kit';
import { NextcloudError, type NextcloudAccount, type NextcloudEntry } from '@xmap/core';
import { loadLastNextcloudDir, nextcloudClient, saveLastNextcloudDir } from '../adapters/nextcloud.js';

export interface NextcloudBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'open' | 'save';
  account: NextcloudAccount;
  /** Nome proposto nel modo 'save' (con .xmind). */
  suggestedName?: string;
  onOpenFile: (entry: NextcloudEntry) => void;
  /** `existing`: la voce con lo stesso nome già presente nella cartella (sovrascrittura confermata dall'utente). */
  onSaveHere: (path: string, existing: NextcloudEntry | undefined) => void;
}

type BodyProps = Omit<NextcloudBrowserModalProps, 'isOpen' | 'onClose'>;

const XMIND_EXTENSION = '.xmind';
const DEFAULT_FILE_NAME = 'mappa.xmind';
const ROOT_DIR = '/';

const DATE_FORMAT = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
const NUMBER_FORMAT = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Errore imprevisto. Riprova.';
}

/** Cartelle e file `.xmind`: il resto della cartella non interessa a questa finestra. */
function isVisible(entry: NextcloudEntry): boolean {
  return entry.isDirectory || entry.name.toLowerCase().endsWith(XMIND_EXTENSION);
}

function joinPath(dir: string, name: string): string {
  return dir === ROOT_DIR ? `${ROOT_DIR}${name}` : `${dir}/${name}`;
}

function parentDir(dir: string): string {
  const index = dir.lastIndexOf('/');
  return index <= 0 ? ROOT_DIR : dir.slice(0, index);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${NUMBER_FORMAT.format(bytes / 1024)} KB`;
  return `${NUMBER_FORMAT.format(bytes / (1024 * 1024))} MB`;
}

function formatDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

function entryMeta(entry: NextcloudEntry): string | null {
  const parts: string[] = [];
  if (!entry.isDirectory && entry.size !== undefined) parts.push(formatSize(entry.size));
  const date = entry.lastModified ? formatDate(entry.lastModified) : null;
  if (date) parts.push(date);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const CRUMB_CLASS =
  'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm hover:bg-accent disabled:pointer-events-none disabled:font-medium disabled:text-foreground coarse:min-h-11';

function NextcloudBrowserBody({ mode, account, suggestedName, onOpenFile, onSaveHere }: BodyProps) {
  const client = useMemo(() => nextcloudClient(account), [account]);
  const [startDir] = useState(loadLastNextcloudDir);
  const [dir, setDir] = useState(startDir);
  // `null` mentre si carica o dopo un errore: senza elenco non si sa cosa verrebbe sovrascritto.
  const [entries, setEntries] = useState<NextcloudEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(suggestedName ?? DEFAULT_FILE_NAME);
  const [nameError, setNameError] = useState<string | null>(null);
  // Le risposte di una navigazione superata (clic rapidi) vengono ignorate.
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const load = async (target: string, fallbackToRoot: boolean): Promise<void> => {
    const id = ++requestRef.current;
    setDir(target);
    setEntries(null);
    setError(null);
    setLoading(true);
    try {
      const listing = await client.list(target);
      if (id !== requestRef.current) return;
      setEntries(listing);
      saveLastNextcloudDir(target);
    } catch (err) {
      if (id !== requestRef.current) return;
      // La cartella ricordata può essere stata spostata o cancellata: si ripiega sulla radice.
      if (fallbackToRoot && target !== ROOT_DIR && err instanceof NextcloudError && err.code === 'not_found') {
        await load(ROOT_DIR, false);
        return;
      }
      setError(errorMessage(err));
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load(startDir, true);
    // Solo all'apertura: le navigazioni successive passano dai pulsanti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (target: string) => {
    void load(target, false);
  };

  const visible = entries?.filter(isVisible) ?? null;
  const segments = dir.split('/').filter(Boolean);

  const activate = (entry: NextcloudEntry) => {
    if (entry.isDirectory) {
      navigate(entry.path);
    } else if (mode === 'open') {
      onOpenFile(entry);
    } else {
      setName(entry.name);
      setNameError(null);
    }
  };

  const onSubmitSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (entries === null) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('Inserisci un nome per il file.');
      return;
    }
    if (trimmed.includes('/')) {
      setNameError('Il nome non può contenere il carattere «/».');
      return;
    }
    const fileName = trimmed.toLowerCase().endsWith(XMIND_EXTENSION) ? trimmed : `${trimmed}${XMIND_EXTENSION}`;
    const sameName = entries.find((entry) => entry.name.toLowerCase() === fileName.toLowerCase());
    if (sameName?.isDirectory) {
      setNameError(`Esiste già una cartella chiamata "${sameName.name}".`);
      return;
    }
    if (sameName && !window.confirm(`Sostituire "${sameName.name}" su Nextcloud?`)) return;
    setNameError(null);
    // Con una voce esistente si usa il nome del server, così il percorso coincide con quello confermato.
    onSaveHere(joinPath(dir, sameName ? sameName.name : fileName), sameName);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          icon={<ArrowUp className="size-4" />}
          disabled={dir === ROOT_DIR}
          onClick={() => navigate(parentDir(dir))}
        >
          Su
        </Button>
        <nav aria-label="Percorso" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <button
            type="button"
            className={CRUMB_CLASS}
            aria-current={segments.length === 0 ? 'page' : undefined}
            disabled={segments.length === 0}
            onClick={() => navigate(ROOT_DIR)}
          >
            <House className="size-4" aria-hidden />
            Home
          </button>
          {segments.map((segment, index) => {
            const target = `${ROOT_DIR}${segments.slice(0, index + 1).join('/')}`;
            const isCurrent = index === segments.length - 1;
            return (
              <Fragment key={target}>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  className={CRUMB_CLASS}
                  aria-current={isCurrent ? 'page' : undefined}
                  disabled={isCurrent}
                  onClick={() => navigate(target)}
                >
                  {segment}
                </button>
              </Fragment>
            );
          })}
        </nav>
      </div>

      {loading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner />
          Caricamento in corso…
        </div>
      ) : null}

      {error ? (
        <Banner
          variant="error"
          action={
            <Button size="xs" variant="outline" onClick={() => navigate(dir)}>
              Riprova
            </Button>
          }
        >
          {error}
        </Banner>
      ) : null}

      {visible && visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nessuna mappa in questa cartella</p>
      ) : null}

      {visible && visible.length > 0 ? (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
          {visible.map((entry) => {
            const meta = entryMeta(entry);
            const selected =
              mode === 'save' && !entry.isDirectory && entry.name.toLowerCase() === name.trim().toLowerCase();
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => activate(entry)}
                  className={cn(
                    'flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent coarse:min-h-11',
                    selected && 'bg-accent',
                  )}
                >
                  {entry.isDirectory ? (
                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{entry.name}</span>
                    {meta ? <span className="block text-2xs text-muted-foreground tabular-nums">{meta}</span> : null}
                  </span>
                  {entry.isDirectory ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {mode === 'save' ? (
        <form onSubmit={onSubmitSave} className="flex flex-col gap-3 border-t pt-4">
          <Field label="Nome del file" error={nameError ?? undefined}>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={entries === null}>
              Salva qui
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function NextcloudBrowserModal(props: NextcloudBrowserModalProps): React.JSX.Element {
  const { isOpen, onClose, ...body } = props;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={body.mode === 'open' ? 'Apri da Nextcloud' : 'Salva su Nextcloud'}
    >
      <NextcloudBrowserBody {...body} />
    </Modal>
  );
}
