// Collegamento con Claude (Desktop e Code), sullo schema di Claude in Chrome:
// l'app ascolta su un socket locale (`@xmap/core/node`, `agent-socket.ts`: socket
// Unix in una cartella 0700, named pipe su Windows) e un ponte MCP su stdio
// (`mcp-bridge.ts`) fa da tramite con il client di Claude. Il ponte lo avvia
// - Claude Desktop, come estensione `.mcpb` generata qui e aperta con Claude;
// - Claude Code, come `xmap-studio --mcp` (`runClaudeCodeBridge`).
// La chiave di accoppiamento sta in userData/claude-link.json (0600): il ponte di
// Claude Code la legge da lì, l'estensione ne porta una copia. Rigenerarla
// scollega entrambi finché non si reinstalla l'estensione.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { AgentSocketServer } from '@xmap/core/node';
import type { McpbPlatform } from '@xmap/core/agent';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logMain } from './debug-log.js';
import { dispatchAgentRequest } from './mcp-host.js';

/** Stato per Impostazioni › Integrazioni; ricalcato da apps/web/src/app/electronBridge.ts. */
export type ClaudeLinkStatus = {
  state: 'starting' | 'listening' | 'error';
  error: string | null;
  /** Percorso del socket locale (o della named pipe). */
  socketPath: string;
  /** Ponti collegati in questo momento (Claude Desktop, Claude Code…). */
  clients: number;
  /** Comando da incollare nel terminale per Claude Code. */
  claudeCodeCommand: string;
  /** Claude Desktop sa installare estensioni su questa piattaforma. */
  desktopSupported: boolean;
};

export type ClaudeInstallResult = { ok: true; path: string } | { ok: false; error: string; path: string | null };

const KEY_FILE = 'claude-link.json';
const BUNDLE_DIR = 'claude';
const MIN_TOKEN_LENGTH = 32;

let token = '';
let server: AgentSocketServer | null = null;
let status: ClaudeLinkStatus = {
  state: 'starting',
  error: null,
  socketPath: '',
  clients: 0,
  claudeCodeCommand: '',
  desktopSupported: isMcpbPlatform(process.platform),
};

export function registerClaudeLink(): void {
  token = readToken() ?? '';
  if (!token) {
    token = newToken();
    writeTokenSync(token);
  }
  status = { ...status, claudeCodeCommand: claudeCodeCommand() };
  ipcMain.handle('claudeLink:get', () => status);
  ipcMain.handle('claudeLink:installDesktop', () => installDesktopExtension());
  ipcMain.handle('claudeLink:revealBundle', () => {
    const file = bundlePath();
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else void shell.openPath(path.dirname(file));
  });
  ipcMain.handle('claudeLink:regenerateKey', () => regenerateKey());
  app.on('will-quit', () => void server?.close());
  void start();
}

async function start(): Promise<void> {
  const { startAgentSocketServer, agentSocketPath } = await import('@xmap/core/node');
  const socketPath = agentSocketPath();
  update({ state: 'starting', socketPath, error: null });
  try {
    server = await startAgentSocketServer({
      path: socketPath,
      token: () => token,
      version: app.getVersion(),
      handle: dispatchAgentRequest,
      onClientsChange: (clients) => update({ clients }),
      log: (level, message) => logMain(level, message),
    });
    update({ state: 'listening', clients: 0, error: null });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    const message =
      code === 'EADDRINUSE'
        ? 'Un\'altra istanza di XMap Studio (per esempio la versione installata e quella di sviluppo) ha già il collegamento con Claude.'
        : `Collegamento con Claude non avviato: ${messageOf(error)}`;
    logMain('warn', message, error);
    update({ state: 'error', error: message });
  }
}

/** Genera l'estensione `.mcpb` con la chiave attuale e la apre con Claude Desktop, che chiede conferma. */
async function installDesktopExtension(): Promise<ClaudeInstallResult> {
  if (!isMcpbPlatform(process.platform)) {
    return { ok: false, error: 'Claude Desktop non è disponibile su questo sistema.', path: null };
  }
  const file = bundlePath();
  try {
    const { buildMcpbBundle, agentCatalog } = await import('@xmap/core/agent');
    const { mcpBridgeSource, agentSocketPath } = await import('@xmap/core/node');
    const bytes = await buildMcpbBundle({
      version: app.getVersion(),
      bridgeSource: await mcpBridgeSource(),
      socketPath: status.socketPath || agentSocketPath(),
      token,
      catalog: agentCatalog(),
      platform: process.platform,
      icon: await readIcon(),
    });
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    // L'estensione contiene la chiave: file leggibile solo dall'utente, scritto in un temporaneo e poi rinominato.
    const temp = `${file}.tmp`;
    await fs.promises.writeFile(temp, bytes, { mode: 0o600 });
    await fs.promises.rename(temp, file);
  } catch (error: unknown) {
    logMain('warn', 'Estensione per Claude Desktop non generata.', error);
    return { ok: false, error: `Estensione non generata: ${messageOf(error)}`, path: null };
  }
  const failure = await shell.openPath(file);
  if (failure) {
    logMain('warn', `Estensione per Claude Desktop non aperta: ${failure}`);
    return {
      ok: false,
      error: 'Claude Desktop non ha aperto l\'estensione: è installato? In alternativa installala da Claude › Impostazioni › Estensioni › Impostazioni avanzate › Installa estensione.',
      path: file,
    };
  }
  return { ok: true, path: file };
}

async function regenerateKey(): Promise<ClaudeLinkStatus> {
  token = newToken();
  await writeToken(token);
  server?.dropStaleClients();
  // La vecchia estensione non vale più: si toglie anche il file, che la conteneva.
  await fs.promises.rm(bundlePath(), { force: true });
  update({});
  return status;
}

/**
 * `xmap-studio --mcp`: ponte MCP su stdio per Claude Code. Nessuna finestra e
 * niente su stdout oltre ai messaggi MCP; esce quando il client chiude stdin.
 */
export async function runClaudeCodeBridge(): Promise<void> {
  const { runMcpBridge, agentSocketPath } = await import('@xmap/core/node');
  const { agentCatalog } = await import('@xmap/core/agent');
  await runMcpBridge({
    socketPath: agentSocketPath(),
    // Letta a ogni collegamento: se nel frattempo si rigenera la chiave, basta la prossima richiesta.
    token: () => readToken() ?? '',
    catalog: agentCatalog(),
    version: app.getVersion(),
    input: process.stdin,
    output: process.stdout,
    log: (message) => process.stderr.write(`[xmap-studio] ${message}\n`),
  });
}

/** Comando per Claude Code che avvia questo stesso eseguibile in modalità `--mcp`. */
function claudeCodeCommand(): string {
  return ['claude', 'mcp', 'add', 'xmap-studio', '--', ...bridgeLaunchArgs()].map(shellQuote).join(' ');
}

function bridgeLaunchArgs(): string[] {
  // AppImage e .exe portable si avviano da un percorso temporaneo: serve quello del file originale.
  const appImage = process.env.APPIMAGE;
  if (appImage) return [appImage, '--mcp'];
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable) return [portable, '--mcp'];
  if (app.isPackaged) return [process.execPath, '--mcp'];
  // Sviluppo e pacchetto Arch: Electron di sistema con il percorso dell'app.
  return [process.execPath, app.getAppPath(), '--mcp'];
}

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

function update(patch: Partial<ClaudeLinkStatus>): void {
  status = { ...status, ...patch };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('claudeLink:status', status);
  }
}

function isMcpbPlatform(platform: NodeJS.Platform): platform is McpbPlatform {
  return platform === 'linux' || platform === 'darwin' || platform === 'win32';
}

async function readIcon(): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await fs.promises.readFile(path.resolve(__dirname, '../../web/dist/icon-256.png')));
  } catch {
    return undefined;
  }
}

function bundlePath(): string {
  return path.join(app.getPath('userData'), BUNDLE_DIR, 'xmap-studio.mcpb');
}

function keyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILE);
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function readToken(): string | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(keyPath(), 'utf8'));
    const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).token : undefined;
    return typeof value === 'string' && value.length >= MIN_TOKEN_LENGTH ? value : null;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logMain('warn', 'Chiave del collegamento con Claude illeggibile.', error);
    return null;
  }
}

function writeTokenSync(value: string): void {
  const target = keyPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ token: value }), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
}

async function writeToken(value: string): Promise<void> {
  const target = keyPath();
  await fs.promises.writeFile(`${target}.tmp`, JSON.stringify({ token: value }), { mode: 0o600 });
  await fs.promises.rename(`${target}.tmp`, target);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
