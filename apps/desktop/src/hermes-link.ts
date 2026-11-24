// Collegamento con Hermes Desktop: un secondo trasporto per le stesse richieste
// del socket di `xmap-studio --mcp` (`mcp-host.ts`), su WebSocket a 127.0.0.1.
// Lo usa il plugin "xmap-studio" di Hermes Desktop, che inoltra a XMap le chiamate
// dell'agente (anche di un gateway remoto). Spento di default; il token di
// accoppiamento e lo stato acceso/spento restano in userData/hermes-link.json.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { AgentLinkServer } from '@xmap/core/node';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logMain } from './debug-log.js';
import { dispatchAgentRequest } from './mcp-host.js';

/** Stato mostrato in Impostazioni › Hermes; ricalcato da apps/web/src/app/electronBridge.ts. */
export type HermesLinkStatus = {
  enabled: boolean;
  port: number;
  token: string | null;
  state: 'off' | 'listening' | 'error';
  clients: number;
  error: string | null;
};

const PREFS_FILE = 'hermes-link.json';
const DEFAULT_PORT = 47615;
/** Override per sviluppo (due istanze sulla stessa macchina). */
const PORT_ENV = 'XMAP_HERMES_PORT';
/**
 * Origine del renderer di Hermes Desktop impacchettato (pagina caricata da
 * `file://`), rilevata nello spike: è quella che Chromium manda nell'handshake.
 * Non basta da sola (qualunque pagina locale ha la stessa): il token è la vera
 * protezione, l'Origin tiene fuori i siti web.
 */
const ALLOWED_ORIGINS = ['file://'];
/**
 * Link di installazione del plugin: Hermes Desktop lo apre con la sua finestra di
 * conferma e installa le due metà (gateway e computer). Il repository è una copia
 * di integrations/hermes/xmap-studio, aggiornata da .github/workflows/hermes-connector.yml.
 */
export const HERMES_CONNECTOR_INSTALL_URL =
  'hermes://plugin/install?repo=gioelerosana/xmap-studio-hermes-connector&enable=1';

type Prefs = { enabled: boolean; token: string | null };

let prefs: Prefs = { enabled: false, token: null };
let server: AgentLinkServer | null = null;
let status: HermesLinkStatus = { enabled: false, port: configuredPort(), token: null, state: 'off', clients: 0, error: null };
/** Accensioni e spegnimenti in fila: un doppio clic non avvia due server. */
let queue: Promise<unknown> = Promise.resolve();

export function registerHermesLink(): void {
  prefs = readPrefs();
  status = { ...status, enabled: prefs.enabled, token: prefs.token };
  ipcMain.handle('hermesLink:get', () => status);
  ipcMain.handle('hermesLink:setEnabled', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Valore non valido.');
    return serialize(() => setEnabled(enabled));
  });
  ipcMain.handle('hermesLink:regenerateToken', () => serialize(regenerateToken));
  // Solo questo link: il renderer non può far aprire indirizzi arbitrari.
  ipcMain.handle('hermesLink:openInstaller', async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await shell.openExternal(HERMES_CONNECTOR_INSTALL_URL);
      return { ok: true };
    } catch (error: unknown) {
      logMain('warn', 'Link di installazione del plugin di Hermes non aperto.', error);
      return { ok: false, error: 'Hermes Desktop non risponde ai link hermes://: è installato su questo computer?' };
    }
  });
  app.on('will-quit', () => {
    void server?.close();
  });
  if (prefs.enabled) void serialize(start);
}

function serialize(task: () => Promise<void>): Promise<HermesLinkStatus> {
  const run = queue.then(task, task).then(() => status);
  queue = run.catch(() => undefined);
  return run;
}

async function setEnabled(enabled: boolean): Promise<void> {
  if (enabled && !prefs.token) prefs.token = newToken();
  prefs.enabled = enabled;
  await writePrefs();
  if (enabled) await start();
  else await stop();
}

async function regenerateToken(): Promise<void> {
  prefs.token = newToken();
  await writePrefs();
  // Il server tiene il token con cui è partito: si riavvia, e i plugin collegati con il vecchio cadono.
  if (prefs.enabled) {
    await stop();
    await start();
  } else {
    update({});
  }
}

async function start(): Promise<void> {
  if (server || !prefs.token) return;
  const port = configuredPort();
  try {
    const { startAgentLinkServer } = await import('@xmap/core/node');
    server = await startAgentLinkServer({
      port,
      token: prefs.token,
      allowedOrigins: ALLOWED_ORIGINS,
      appVersion: app.getVersion(),
      dispatch: dispatchAgentRequest,
      onClientsChange: (clients) => update({ clients }),
      log: (level, message) => logMain(level, message),
    });
    update({ state: 'listening', port: server.port, clients: 0, error: null });
  } catch (error: unknown) {
    server = null;
    const code = (error as NodeJS.ErrnoException).code;
    const message =
      code === 'EADDRINUSE'
        ? `La porta ${port} è già in uso (forse da un'altra istanza di XMap Studio).`
        : `Collegamento non avviato: ${error instanceof Error ? error.message : String(error)}`;
    logMain('warn', `Collegamento con Hermes non avviato (${code ?? 'errore'}).`, error);
    update({ state: 'error', port, clients: 0, error: message });
  }
}

async function stop(): Promise<void> {
  const current = server;
  server = null;
  if (current) await current.close();
  update({ state: 'off', clients: 0, error: null });
}

function update(patch: Partial<HermesLinkStatus>): void {
  status = { ...status, ...patch, enabled: prefs.enabled, token: prefs.token };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('hermesLink:status', status);
  }
}

function configuredPort(): number {
  const override = Number(process.env[PORT_ENV]);
  return Number.isInteger(override) && override > 0 && override < 65536 ? override : DEFAULT_PORT;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function prefsPath(): string {
  return path.join(app.getPath('userData'), PREFS_FILE);
}

function readPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return { enabled: false, token: null };
    const record = raw as Record<string, unknown>;
    return {
      enabled: record.enabled === true,
      token: typeof record.token === 'string' && record.token.length >= 32 ? record.token : null,
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logMain('warn', 'Preferenze del collegamento con Hermes illeggibili.', error);
    return { enabled: false, token: null };
  }
}

/** Il token è un segreto: file leggibile solo dall'utente, scritto in un temporaneo e poi rinominato. */
async function writePrefs(): Promise<void> {
  const target = prefsPath();
  const temp = `${target}.tmp`;
  await fs.promises.writeFile(temp, JSON.stringify(prefs), { mode: 0o600 });
  await fs.promises.rename(temp, target);
}
