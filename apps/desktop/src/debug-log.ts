// Log del main process per il menu Debug dell'app (Impostazioni › Debug).
// Buffer circolare in memoria: niente file, niente rete. La console resta invariata.
import { app, ipcMain } from 'electron';
import * as os from 'node:os';
import { format } from 'node:util';

/** Voce del log; ricalca `LogEntry` del renderer (apps/web/src/debugLog.ts) senza `id` né `source`. */
export type MainLogEntry = {
  time: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
};

/** Risposta di `debug:getInfo` (vedi `DesktopDebugInfo` in apps/web/src/app/electronBridge.ts). */
export type DesktopDebugInfo = {
  platform: string;
  os: string;
  arch: string;
  isPackaged: boolean;
  execPath: string;
  userData: string;
  versions: Record<string, string | undefined>;
  mainLog: MainLogEntry[];
};

const MAX_ENTRIES = 500;
const MAX_TEXT_LENGTH = 8000;
const entries: MainLogEntry[] = [];

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}… [troncato]` : text;
}

export function logMain(level: MainLogEntry['level'], message: string, detail?: unknown): void {
  const detailText = detail === undefined ? undefined : detail instanceof Error ? (detail.stack ?? String(detail)) : format(detail);
  entries.push({ time: Date.now(), level, message: truncate(message), ...(detailText ? { detail: truncate(detailText) } : {}) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** Aggancia la console, gli eventi di crash di Electron e registra `debug:getInfo`. */
export function registerDebugLog(): void {
  for (const [method, level] of [
    ['debug', 'debug'],
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const errorArg = args.find((arg): arg is Error => arg instanceof Error);
      logMain(level, format(...args.map((arg) => (arg instanceof Error ? arg.message : arg))), errorArg);
    };
  }

  // Solo `unhandledRejection`: un listener di `uncaughtException` cambierebbe il comportamento (niente crash).
  process.on('unhandledRejection', (reason) => logMain('error', 'Promessa rifiutata non gestita nel main process', reason));
  app.on('render-process-gone', (_, contents, details) =>
    logMain('error', `Renderer terminato: ${details.reason} (codice ${details.exitCode})`, contents.getURL())
  );
  app.on('child-process-gone', (_, details) =>
    logMain('error', `Processo ${details.type} terminato: ${details.reason} (codice ${details.exitCode})`, details.name)
  );

  ipcMain.handle('debug:getInfo', (): DesktopDebugInfo => ({
    platform: process.platform,
    os: `${os.type()} ${os.release()} (${os.version()})`,
    arch: process.arch,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    userData: app.getPath('userData'),
    versions: { ...process.versions },
    mainLog: [...entries],
  }));

  logMain('info', `Avvio del main process (${app.getVersion()}, Electron ${process.versions.electron})`);
}
