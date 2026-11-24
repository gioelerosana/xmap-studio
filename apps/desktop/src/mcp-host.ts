// Lato app del collegamento con Claude: ascolta sul canale locale (`mcp-socket.ts`)
// le richieste del server MCP su stdio e le gira alla finestra della mappa. Gli
// strumenti si eseguono nel renderer, sullo stesso controller della UI: le modifiche
// compaiono subito e si annullano con Ctrl+Z. Qui non si tocca nessun file.
import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { logMain } from './debug-log.js';
import { HostRequest, HostResponse, lineReader, mcpSocketPath } from './mcp-socket.js';

/** Mappa aperta in una finestra, come la descrive il renderer. */
export type McpMapInfo = { fileName: string; path: string | null; dirty: boolean };

/** Richiesta al renderer; `__describe` chiede solo la descrizione della mappa. */
export type McpRendererRequest = { requestId: number; tool: string; args: Record<string, unknown> };
export type McpRendererReply =
  | { requestId: number; ok: true; text: string; info?: McpMapInfo | null }
  | { requestId: number; ok: false; error: string };

export const MCP_DESCRIBE = '__describe';

const DESCRIBE_TIMEOUT_MS = 3000;
/** Una formula può dover aspettare il caricamento di MathJax; un salvataggio, la scrittura su disco. */
const CALL_TIMEOUT_MS = 120_000;
/** Riga massima accettata dal canale: le richieste sono piccole, un flusso infinito non deve riempire la memoria. */
const MAX_LINE_CHARS = 4 * 1024 * 1024;

type Pending = {
  webContentsId: number;
  resolve: (reply: McpRendererReply) => void;
  timer: NodeJS.Timeout;
};

const pending = new Map<number, Pending>();
let nextRequestId = 1;
let lastFocusedId: number | null = null;

/** Avvia il canale. Se un'altra istanza di XMap Studio lo serve già, si limita a registrarlo nel log. */
export function startMcpHost(): void {
  app.on('browser-window-focus', (_event, window) => {
    lastFocusedId = window.id;
  });

  ipcMain.on('mcp:response', (event, reply: unknown) => {
    if (!isReply(reply)) return;
    const entry = pending.get(reply.requestId);
    // Solo la finestra a cui si è chiesto può rispondere.
    if (!entry || entry.webContentsId !== event.sender.id) return;
    pending.delete(reply.requestId);
    clearTimeout(entry.timer);
    entry.resolve(reply);
  });

  const socketPath = mcpSocketPath();
  const server = net.createServer(handleConnection);
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && process.platform !== 'win32') {
      void reclaimStaleSocket(server, socketPath);
      return;
    }
    logMain('warn', `Collegamento con Claude non disponibile (${error.code ?? error.message}).`, error);
  });
  server.listen(socketPath, () => onListening(socketPath));
  app.on('will-quit', () => {
    // Il socket si toglie solo se è nostro: quello di un'altra istanza attiva resta.
    if (!server.listening) return;
    server.close();
    if (process.platform !== 'win32') removeSocketFile(socketPath);
  });
}

function onListening(socketPath: string): void {
  // Il socket è dell'utente: nessun altro account della macchina deve poterlo aprire.
  if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
  logMain('info', `Collegamento con Claude in ascolto su ${socketPath}`);
}

/**
 * Socket già presente: se risponde lo serve un'altra istanza attiva (es. versione
 * installata e versione di sviluppo) e si lascia stare; se no è il resto di un
 * avvio terminato male, e si sostituisce.
 */
async function reclaimStaleSocket(server: net.Server, socketPath: string): Promise<void> {
  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.connect(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
  if (alive) {
    logMain('warn', 'Collegamento con Claude già servito da un\'altra istanza di XMap Studio: questa non lo usa.');
    return;
  }
  removeSocketFile(socketPath);
  server.listen(socketPath, () => onListening(socketPath));
}

function removeSocketFile(socketPath: string): void {
  try {
    fs.unlinkSync(socketPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logMain('warn', 'Socket di Claude non rimosso.', error);
  }
}

function handleConnection(socket: net.Socket): void {
  const reply = (response: HostResponse) => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
  };
  const onLine = (line: string) => {
    let request: HostRequest;
    try {
      request = parseRequest(JSON.parse(line));
    } catch (error: unknown) {
      reply({ id: 0, ok: false, error: `Richiesta non valida: ${errorMessage(error)}` });
      return;
    }
    handleRequest(request).then(reply, (error: unknown) => reply({ id: request.id, ok: false, error: errorMessage(error) }));
  };
  socket.on('data', lineReader(onLine, MAX_LINE_CHARS, () => socket.destroy()));
  socket.on('error', () => socket.destroy());
}

async function handleRequest(request: HostRequest): Promise<HostResponse> {
  if (request.op === 'maps') return { id: request.id, ok: true, text: await describeMaps() };
  const window = targetWindow(request.map);
  const result = await askRenderer(window, request.tool, request.args, CALL_TIMEOUT_MS);
  return result.ok ? { id: request.id, ok: true, text: result.text } : { id: request.id, ok: false, error: result.error };
}

function mapWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
}

/** Finestra indicata, altrimenti quella in primo piano, l'ultima usata o l'unica aperta. */
function targetWindow(map: number | undefined): BrowserWindow {
  const windows = mapWindows();
  if (map !== undefined) {
    const chosen = windows.find((window) => window.id === map);
    if (!chosen) throw new Error(`Mappa ${map} non trovata: le mappe aperte si vedono con list_maps.`);
    return chosen;
  }
  if (windows.length === 0) throw new Error('Nessuna finestra di XMap Studio aperta.');
  return defaultWindow(windows) ?? windows[0];
}

function defaultWindow(windows: BrowserWindow[]): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.includes(focused)) return focused;
  const last = windows.find((window) => window.id === lastFocusedId);
  return last ?? (windows.length === 1 ? windows[0] : undefined);
}

async function describeMaps(): Promise<string> {
  const windows = mapWindows();
  if (windows.length === 0) return 'XMap Studio è aperto ma senza finestre.';
  const target = defaultWindow(windows) ?? windows[0];
  const lines = await Promise.all(
    windows.map(async (window) => {
      const reply = await askRenderer(window, MCP_DESCRIBE, {}, DESCRIBE_TIMEOUT_MS).catch(
        (error: unknown): McpRendererReply => ({ requestId: 0, ok: false, error: errorMessage(error) })
      );
      const marker = window === target ? ' ← predefinita' : '';
      if (!reply.ok) return `- map ${window.id}: non disponibile (${reply.error})${marker}`;
      const info = reply.info;
      if (!info) return `- map ${window.id}: nessuna mappa aperta${marker}`;
      const where = info.path ?? 'mai salvata su file';
      return `- map ${window.id}: ${info.fileName} (${where})${info.dirty ? ' — modifiche non salvate' : ''}${marker}`;
    })
  );
  return `Mappe aperte in XMap Studio (senza "map" si usa la predefinita):\n${lines.join('\n')}`;
}

function askRenderer(
  window: BrowserWindow,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<McpRendererReply> {
  const contents = window.webContents;
  if (contents.isLoading() || contents.isCrashed()) {
    return Promise.reject(new Error('La finestra di XMap Studio non è pronta: riprova tra poco.'));
  }
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('XMap Studio non ha risposto in tempo.'));
    }, timeoutMs);
    pending.set(requestId, { webContentsId: contents.id, resolve, timer });
    const request: McpRendererRequest = { requestId, tool, args };
    contents.send('mcp:request', request);
  });
}

function parseRequest(value: unknown): HostRequest {
  if (!isRecord(value) || typeof value.id !== 'number') throw new Error('manca l\'id.');
  if (value.op === 'maps') return { id: value.id, op: 'maps' };
  if (value.op !== 'call' || typeof value.tool !== 'string') throw new Error('operazione sconosciuta.');
  const map = value.map;
  if (map !== undefined && (typeof map !== 'number' || !Number.isInteger(map))) throw new Error('map deve essere un intero.');
  return {
    id: value.id,
    op: 'call',
    map,
    tool: value.tool,
    args: isRecord(value.args) ? value.args : {},
  };
}

function isReply(value: unknown): value is McpRendererReply {
  if (!isRecord(value) || typeof value.requestId !== 'number') return false;
  return value.ok === true ? typeof value.text === 'string' : value.ok === false && typeof value.error === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
