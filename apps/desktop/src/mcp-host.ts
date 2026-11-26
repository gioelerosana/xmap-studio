// Server MCP dell'app desktop: Streamable HTTP senza autenticazione su
// http://127.0.0.1:47616/mcp (`@xmap/core/node`, `mcp-http.ts`), per il client di
// Claude sulla stessa macchina. Ogni chiamata va alla finestra della mappa: gli
// strumenti si eseguono nel renderer, sullo stesso controller della UI, quindi le
// modifiche compaiono subito e si annullano con Ctrl+Z. Qui non si tocca nessun file.
import { app, BrowserWindow, ipcMain } from 'electron';
import type { McpHttpServer } from '@xmap/core/node';
import { logMain } from './debug-log.js';
import type { AgentLinkRequest, AgentLinkResponse } from '@xmap/core/agent';

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
/** Override della porta per sviluppo e test (due istanze sulla stessa macchina). */
const PORT_ENV = 'XMAP_MCP_PORT';

/** Stato del server MCP per Impostazioni › Claude; ricalcato da apps/web/src/app/electronBridge.ts. */
export type McpServerStatus = {
  state: 'starting' | 'listening' | 'error';
  /** Indirizzo da dare al client di Claude. */
  url: string;
  error: string | null;
};

type Pending = {
  webContentsId: number;
  resolve: (reply: McpRendererReply) => void;
  timer: NodeJS.Timeout;
};

const pending = new Map<number, Pending>();
let nextRequestId = 1;
let lastFocusedId: number | null = null;

let status: McpServerStatus = { state: 'starting', url: '', error: null };

/** Avvia il server MCP su 127.0.0.1. Se la porta è occupata (es. un'altra istanza), lo segnala nello stato. */
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
  ipcMain.handle('mcpServer:get', () => status);

  void listen();
}

async function listen(): Promise<void> {
  const { startMcpHttpServer, MCP_HTTP_HOST, MCP_HTTP_PATH, MCP_HTTP_PORT } = await import('@xmap/core/node');
  const { createMcpServer } = await import('@xmap/core/agent');
  const port = configuredPort(MCP_HTTP_PORT);
  status = { state: 'starting', url: `http://${MCP_HTTP_HOST}:${port}${MCP_HTTP_PATH}`, error: null };
  const handle = createMcpServer({ name: 'xmap-studio', version: app.getVersion(), callTool });
  let server: McpHttpServer;
  try {
    server = await startMcpHttpServer({ port, handle, log: (level, message) => logMain(level, message) });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    const message =
      code === 'EADDRINUSE'
        ? `La porta ${port} è già occupata (forse da un'altra istanza di XMap Studio).`
        : `Server MCP non avviato: ${errorMessage(error)}`;
    status = { ...status, state: 'error', error: message };
    logMain('warn', message, error);
    return;
  }
  status = { state: 'listening', url: server.url, error: null };
  app.on('will-quit', () => void server.close());
}

function configuredPort(fallback: number): number {
  const value = Number(process.env[PORT_ENV]);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

/** Strumento MCP → richiesta comune ai trasporti; `map` diventa l'id della finestra. */
async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const response = await dispatchAgentRequest({ id: 0, op: 'call', tool: name, args });
  if ('catalog' in response) return { text: 'Risposta inattesa.', isError: true };
  return response.ok ? { text: response.text } : { text: response.error, isError: true };
}

/**
 * Esegue una richiesta di un agente, da qualunque trasporto arrivi (server MCP
 * HTTP o WebSocket di Hermes): è l'unico punto in cui le richieste diventano
 * chiamate alla finestra.
 */
export async function dispatchAgentRequest(request: AgentLinkRequest): Promise<AgentLinkResponse> {
  if (request.op === 'maps') return { id: request.id, ok: true, text: await describeMaps() };
  if (request.op === 'catalog') {
    const { agentCatalog } = await import('@xmap/core/agent');
    return { id: request.id, ok: true, catalog: agentCatalog() };
  }
  if (request.tool === 'list_maps') return { id: request.id, ok: true, text: await describeMaps() };
  // `map` può arrivare a parte o, come lo scrive il client, fra gli argomenti dello strumento.
  const { map: argMap, ...args } = request.args;
  let map = request.map;
  if (map === undefined && argMap !== undefined) {
    if (typeof argMap !== 'number' || !Number.isInteger(argMap)) {
      return { id: request.id, ok: false, error: 'map deve essere il numero di una mappa elencata da list_maps.' };
    }
    map = argMap;
  }
  const window = targetWindow(map);
  const result = await askRenderer(window, request.tool, args, CALL_TIMEOUT_MS);
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
