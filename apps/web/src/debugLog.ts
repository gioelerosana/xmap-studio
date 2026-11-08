/*
 * Log di diagnostica dell'app, mostrato nel menu Debug delle impostazioni.
 *
 * Raccoglie in memoria (buffer circolare, niente disco, niente rete):
 * - le chiamate a `console.*` del renderer;
 * - gli errori non gestiti (`error`, `unhandledrejection`);
 * - i toast mostrati all'utente, con l'errore originale (stack, `cause`, codice);
 * - gli eventi annotati a mano con `logEvent`.
 * Il log del main process Electron arriva a parte, da `electronAPI.getDebugInfo`.
 * Si installa all'avvio, prima di React, così cattura anche gli errori iniziali.
 */
import { useSyncExternalStore } from 'react';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'console' | 'window' | 'toast' | 'app' | 'main';

export interface LogEntry {
  /** Progressivo, unico nella sessione: chiave stabile per React. */
  id: number;
  /** `Date.now()` del momento in cui la voce è stata registrata. */
  time: number;
  level: LogLevel;
  source: LogSource;
  /** Riga breve leggibile. */
  message: string;
  /** Dettagli su più righe (stack, causa, argomenti extra); assente se non c'è altro. */
  detail?: string;
}

/** Voci conservate: oltre, si scartano le più vecchie. */
export const MAX_LOG_ENTRIES = 1000;
const MAX_TEXT_LENGTH = 8000;

let entries: LogEntry[] = [];
let nextId = 1;
let installed = false;
const listeners = new Set<() => void>();
/** Evita il ricorso infinito se un listener (o `formatValue`) scrive in console. */
let recording = false;

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}… [troncato]` : text;
}

/** Messaggio, nome, codice, stack e catena di `cause` di un errore; per gli altri valori una forma leggibile. */
export function formatError(value: unknown): string {
  const lines: string[] = [];
  let current: unknown = value;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    const prefix = depth === 0 ? '' : 'Causato da: ';
    if (current instanceof Error) {
      const code = 'code' in current && current.code !== undefined ? ` [${String(current.code)}]` : '';
      const head = `${prefix}${current.name}${code}: ${current.message}`;
      const stack = current.stack ?? '';
      // Lo stack di V8 ripete già "Nome: messaggio" in testa: si tiene solo il resto.
      const frames = stack.startsWith(`${current.name}: `) ? stack.split('\n').slice(1).join('\n') : stack;
      lines.push(frames ? `${head}\n${frames}` : head);
      // `XmapError` del core porta i dati di contesto in `details`.
      if ('details' in current && current.details !== undefined) lines.push(`Dettagli: ${formatValue(current.details)}`);
      current = current.cause;
    } else {
      lines.push(`${prefix}${formatValue(current)}`);
      break;
    }
  }
  return truncate(lines.join('\n'));
}

/** Rappresentazione testuale di un valore qualsiasi, senza lanciare. */
export function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return formatError(value);
  if (typeof Event !== 'undefined' && value instanceof Event) {
    const target = value.target as { src?: unknown; tagName?: unknown } | null;
    const where = target && typeof target.tagName === 'string' ? ` su <${target.tagName.toLowerCase()}>` : '';
    return `Evento "${value.type}"${where}`;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return truncate(JSON.stringify(value, null, 2) ?? String(value));
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Registra una voce nel log. `detail` può essere un errore, un oggetto o una stringa. */
export function logEvent(level: LogLevel, message: string, detail?: unknown, source: LogSource = 'app'): void {
  if (recording) return;
  recording = true;
  try {
    const detailText = detail === undefined ? undefined : formatValue(detail);
    const entry: LogEntry = {
      id: nextId++,
      time: Date.now(),
      level,
      source,
      message: truncate(message),
      ...(detailText && detailText !== message ? { detail: detailText } : {}),
    };
    entries = entries.length >= MAX_LOG_ENTRIES ? [...entries.slice(1 - MAX_LOG_ENTRIES), entry] : [...entries, entry];
    emit();
  } finally {
    recording = false;
  }
}

export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearLog(): void {
  entries = [];
  emit();
}

/** Le voci del log, aggiornate a ogni nuova voce. */
export function useLogEntries(): readonly LogEntry[] {
  return useSyncExternalStore(subscribeLog, getLogEntries, getLogEntries);
}

const CONSOLE_LEVELS: { method: 'debug' | 'log' | 'info' | 'warn' | 'error'; level: LogLevel }[] = [
  { method: 'debug', level: 'debug' },
  { method: 'log', level: 'info' },
  { method: 'info', level: 'info' },
  { method: 'warn', level: 'warn' },
  { method: 'error', level: 'error' },
];

function recordConsole(level: LogLevel, args: unknown[]): void {
  const [first, ...rest] = args;
  const message = first instanceof Error ? `${first.name}: ${first.message}` : formatValue(first);
  const errorArg = args.find((arg): arg is Error => arg instanceof Error);
  const detailParts = rest.map(formatValue);
  if (errorArg && errorArg === first) detailParts.unshift(formatError(errorArg));
  logEvent(level, message.split('\n')[0] ?? '', detailParts.length ? detailParts.join('\n') : undefined, 'console');
}

/** Aggancia console ed errori globali. Idempotente (HMR, StrictMode). */
export function installDebugLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  for (const { method, level } of CONSOLE_LEVELS) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      try {
        recordConsole(level, args);
      } catch {
        // Il log non deve mai rompere la console.
      }
    };
  }

  window.addEventListener('error', (event) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    logEvent('error', `Errore non gestito: ${event.message}${where}`, event.error ?? undefined, 'window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : formatValue(reason);
    logEvent('error', `Promessa rifiutata non gestita: ${message.split('\n')[0] ?? ''}`, reason, 'window');
  });

  logEvent('info', 'Avvio dell’app', `URL: ${location.href}`);
}

/** Una voce come riga di testo, per copia ed esportazione. */
export function formatLogEntry(entry: LogEntry): string {
  const time = new Date(entry.time).toISOString();
  const head = `${time} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${entry.message}`;
  return entry.detail ? `${head}\n${entry.detail.replace(/^/gm, '    ')}` : head;
}

export function formatLogAsText(list: readonly LogEntry[]): string {
  return list.map(formatLogEntry).join('\n');
}
