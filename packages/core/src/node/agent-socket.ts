/**
 * Socket locale dell'app desktop per il ponte MCP (`mcp-bridge.ts`): lo usano
 * l'estensione di Claude Desktop (`.mcpb`) e `xmap-studio --mcp` per Claude Code.
 * Stesso schema del collegamento di Claude in Chrome: niente porte TCP, un socket
 * Unix in una cartella `0700` dell'utente (una named pipe su Windows) e una chiave
 * di accoppiamento nel primo messaggio.
 *
 * Protocollo: una riga JSON per messaggio (UTF-8, `\n`). Il primo è
 * `{"type":"auth","token":"…"}`; l'app risponde `{"type":"auth","ok":true,"app":"xmap-studio",…}`
 * oppure `{"type":"auth","ok":false,"error":…}` e chiude. Poi le richieste di
 * `agent/link.ts` (`AgentLinkRequest` → `AgentLinkResponse`), anche in parallelo.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseAgentLinkRequest, type AgentLinkRequest, type AgentLinkResponse } from '../agent/link.js';
import { tokensMatch } from './agent-link.js';

export const AGENT_SOCKET_PROTOCOL = 1;
/** Override del percorso del socket (sviluppo, test, due istanze sulla stessa macchina). */
export const AGENT_SOCKET_ENV = 'XMAP_MCP_SOCKET';
const SOCKET_FILE = 'mcp.sock';
const MIN_TOKEN_LENGTH = 16;

export interface AgentSocketServerOptions {
  /** Percorso del socket (di solito `agentSocketPath()`). */
  path: string;
  /** Chiave di accoppiamento attuale; letta a ogni nuovo client, così cambiarla vale subito. */
  token: () => string;
  handle: (request: AgentLinkRequest) => Promise<AgentLinkResponse>;
  /** Versione dell'app, comunicata al ponte dopo l'autenticazione. */
  version: string;
  log?: (level: 'info' | 'warn', message: string) => void;
  /** Avvisa quando cambia il numero di client autenticati. */
  onClientsChange?: (clients: number) => void;
  maxClients?: number;
  maxMessageBytes?: number;
  maxInFlight?: number;
  authTimeoutMs?: number;
}

export interface AgentSocketServer {
  readonly path: string;
  readonly clients: number;
  /** Chiude i client autenticati con una chiave diversa da quella attuale. */
  dropStaleClients(): void;
  close(): Promise<void>;
}

const DEFAULTS = { maxClients: 8, maxMessageBytes: 4 * 1024 * 1024, maxInFlight: 16, authTimeoutMs: 5000 };

/**
 * Percorso predefinito del socket. Unix: `$XDG_RUNTIME_DIR/xmap-studio-<uid>/mcp.sock`
 * (o sotto la cartella temporanea). Windows: `\\.\pipe\xmap-studio-mcp-<utente>`.
 */
export function agentSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[AGENT_SOCKET_ENV];
  if (override) return override;
  if (process.platform === 'win32') {
    const user = (env.USERNAME ?? os.userInfo().username).replace(/[^A-Za-z0-9_.-]/g, '_');
    return `\\\\.\\pipe\\xmap-studio-mcp-${user}`;
  }
  const runtime = env.XDG_RUNTIME_DIR;
  const base = runtime && path.isAbsolute(runtime) && isDirectory(runtime) ? runtime : os.tmpdir();
  return path.join(base, `xmap-studio-${process.getuid?.() ?? 'user'}`, SOCKET_FILE);
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isPipePath(socketPath: string): boolean {
  return socketPath.startsWith('\\\\.\\pipe\\') || socketPath.startsWith('\\\\?\\pipe\\');
}

/** Crea (o ripara) la cartella `0700` del socket; rifiuta link simbolici e cartelle di altri utenti. */
async function prepareSocketDir(dir: string): Promise<void> {
  try {
    await fs.promises.mkdir(dir, { mode: 0o700 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const info = await fs.promises.lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`La cartella del socket non è una cartella: ${dir}`);
  const uid = process.getuid?.();
  if (uid !== undefined && info.uid !== uid) throw new Error(`La cartella del socket appartiene a un altro utente: ${dir}`);
  if ((info.mode & 0o777) !== 0o700) await fs.promises.chmod(dir, 0o700);
}

/** Un socket rimasto da un'app chiusa male si toglie; uno che risponde è di un'altra istanza. */
async function clearStaleSocket(socketPath: string): Promise<void> {
  let info: fs.Stats;
  try {
    info = await fs.promises.lstat(socketPath);
  } catch {
    return;
  }
  if (!info.isSocket()) throw new Error(`Al posto del socket c'è un altro file: ${socketPath}`);
  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
  if (alive) {
    const error = new Error('Un\'altra istanza di XMap Studio usa già il collegamento con Claude.') as NodeJS.ErrnoException;
    error.code = 'EADDRINUSE';
    throw error;
  }
  await fs.promises.unlink(socketPath);
}

export async function startAgentSocketServer(options: AgentSocketServerOptions): Promise<AgentSocketServer> {
  const config = {
    maxClients: options.maxClients ?? DEFAULTS.maxClients,
    maxMessageBytes: options.maxMessageBytes ?? DEFAULTS.maxMessageBytes,
    maxInFlight: options.maxInFlight ?? DEFAULTS.maxInFlight,
    authTimeoutMs: options.authTimeoutMs ?? DEFAULTS.authTimeoutMs,
  };
  const log = options.log ?? (() => undefined);
  const socketPath = options.path;
  const pipe = isPipePath(socketPath);
  if (!pipe) {
    await prepareSocketDir(path.dirname(socketPath));
    await clearStaleSocket(socketPath);
  }

  const connections = new Set<Connection>();
  let authenticated = 0;
  const changeClients = (delta: number) => {
    authenticated += delta;
    options.onClientsChange?.(authenticated);
  };

  const server = net.createServer((socket) => {
    if (connections.size >= config.maxClients) {
      log('warn', 'Collegamento con Claude: troppi client, connessione rifiutata.');
      socket.end(`${JSON.stringify({ type: 'auth', ok: false, error: 'Troppi client collegati.' })}\n`);
      return;
    }
    const connection = new Connection(socket, options, config, log, changeClients, () => connections.delete(connection));
    connections.add(connection);
  });
  server.maxConnections = config.maxClients * 2;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (!pipe) await fs.promises.chmod(socketPath, 0o600);
  log('info', `Collegamento con Claude in ascolto su ${socketPath}`);

  return {
    path: socketPath,
    get clients() {
      return authenticated;
    },
    dropStaleClients() {
      const current = options.token();
      for (const connection of connections) {
        if (connection.token !== null && !tokensMatch(connection.token, current)) connection.destroy();
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const connection of connections) connection.destroy();
        server.close(() => resolve());
        // Su Unix `close` toglie già il file; si ripete per sicurezza, senza errori se manca.
        if (!pipe) fs.promises.unlink(socketPath).catch(() => undefined);
      }),
  };
}

type Limits = { maxMessageBytes: number; maxInFlight: number; authTimeoutMs: number };

class Connection {
  /** Chiave con cui il client si è autenticato, `null` finché non lo fa. */
  token: string | null = null;
  private buffer = '';
  private inFlight = 0;
  private closed = false;
  private readonly authTimer: NodeJS.Timeout;

  constructor(
    private readonly socket: net.Socket,
    private readonly options: AgentSocketServerOptions,
    private readonly limits: Limits,
    private readonly log: (level: 'info' | 'warn', message: string) => void,
    private readonly changeClients: (delta: number) => void,
    private readonly onClose: () => void
  ) {
    socket.setEncoding('utf8');
    this.authTimer = setTimeout(() => this.refuse('Autenticazione non ricevuta in tempo.'), limits.authTimeoutMs);
    socket.on('data', (chunk: string) => this.receive(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1 && !this.closed) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim() !== '') this.message(line);
      newline = this.buffer.indexOf('\n');
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > this.limits.maxMessageBytes) this.refuse('Messaggio troppo grande.');
  }

  private message(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      if (this.token === null) this.refuse('Messaggio non valido.');
      else this.send({ id: 0, ok: false, error: 'JSON non valido.' });
      return;
    }
    if (this.token === null) {
      this.authenticate(value);
      return;
    }
    let request: AgentLinkRequest;
    try {
      request = parseAgentLinkRequest(value);
    } catch (error: unknown) {
      const id = isRecord(value) && typeof value.id === 'number' ? value.id : 0;
      this.send({ id, ok: false, error: `Richiesta non valida: ${messageOf(error)}` });
      return;
    }
    if (this.inFlight >= this.limits.maxInFlight) {
      this.send({ id: request.id, ok: false, error: 'Troppe richieste in corso.' });
      return;
    }
    this.inFlight += 1;
    this.options
      .handle(request)
      .catch((error: unknown): AgentLinkResponse => ({ id: request.id, ok: false, error: messageOf(error) }))
      .then((response) => {
        this.inFlight -= 1;
        this.send(response);
      });
  }

  private authenticate(value: unknown): void {
    const token = isRecord(value) && value.type === 'auth' && typeof value.token === 'string' ? value.token : null;
    const expected = this.options.token();
    if (token === null || expected.length < MIN_TOKEN_LENGTH || !tokensMatch(token, expected)) {
      this.log('warn', 'Collegamento con Claude: chiave non valida.');
      this.refuse('Chiave di collegamento non valida: reinstalla l\'estensione da XMap Studio › Impostazioni › Integrazioni.');
      return;
    }
    clearTimeout(this.authTimer);
    this.token = token;
    this.changeClients(1);
    this.send({ type: 'auth', ok: true, app: 'xmap-studio', protocol: AGENT_SOCKET_PROTOCOL, version: this.options.version });
  }

  private refuse(error: string): void {
    if (this.closed) return;
    this.socket.write(`${JSON.stringify({ type: 'auth', ok: false, error })}\n`);
    this.destroy();
  }

  private send(value: unknown): void {
    if (this.closed) return;
    this.socket.write(`${JSON.stringify(value)}\n`);
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.authTimer);
    if (this.token !== null) this.changeClients(-1);
    // Chiude dopo aver spedito quanto già scritto (es. il rifiuto).
    if (!this.socket.destroyed) this.socket.destroySoon();
    this.onClose();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
