/**
 * Ponte MCP su stdio verso l'app desktop aperta: lo avviano Claude Desktop
 * (estensione `.mcpb`, sul Node incluso in Claude) e Claude Code
 * (`xmap-studio --mcp`). Parla MCP con il client (una riga JSON-RPC per messaggio
 * su stdin/stdout) e gira le chiamate agli strumenti all'app sul socket locale di
 * `agent-socket.ts`. `initialize`, `ping` e `tools/list` rispondono anche ad app
 * chiusa, così il client vede gli strumenti e il messaggio d'errore è chiaro.
 *
 * Il file deve restare AUTOSUFFICIENTE: si copia così com'è dentro il `.mcpb`,
 * quindi importa solo moduli `node:` (e tipi, che spariscono in compilazione).
 * Niente scritture su stdout tranne i messaggi MCP.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { AgentCatalog } from '../agent/link.js';

/** Copia di `MCP_PROTOCOL_VERSIONS` di `agent/mcp.ts` (un test le tiene allineate). */
export const BRIDGE_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpBridgeOptions {
  socketPath: string;
  /** Chiave di accoppiamento; letta a ogni collegamento (in `--mcp` può cambiare mentre il ponte gira). */
  token: () => string | Promise<string>;
  /** Strumenti da mostrare quando l'app è chiusa; con l'app aperta si chiedono a lei. */
  catalog: AgentCatalog;
  version: string;
  input: Readable;
  output: Writable;
  /** Diagnostica su stderr: mai su stdout. */
  log?: (message: string) => void;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
}

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const APP_CLOSED =
  'XMap Studio non è aperto (o non ha il collegamento con Claude attivo). Apri XMap Studio con la mappa su cui lavorare e riprova.';

type JsonRpcId = string | number;
type LinkReply = { id: number; ok: boolean; text?: string; error?: string; catalog?: AgentCatalog };

/** Avvia il ponte; la promessa si risolve quando stdin si chiude. */
export function runMcpBridge(options: McpBridgeOptions): Promise<void> {
  const bridge = new Bridge(options);
  return bridge.run();
}

class Bridge {
  private link: AppLink | null = null;
  private connecting: Promise<AppLink> | null = null;

  constructor(private readonly options: McpBridgeOptions) {}

  run(): Promise<void> {
    const { input } = this.options;
    input.setEncoding('utf8');
    let buffer = '';
    const pending = new Set<Promise<void>>();
    return new Promise((resolve) => {
      input.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line !== '') {
            const job = this.handleLine(line).finally(() => pending.delete(job));
            pending.add(job);
          }
          newline = buffer.indexOf('\n');
        }
      });
      input.on('end', () => {
        void Promise.allSettled([...pending]).then(() => {
          this.link?.close();
          resolve();
        });
      });
    });
  }

  private async handleLine(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.write(errorResponse(null, JSONRPC_PARSE_ERROR, 'JSON non valido.'));
      return;
    }
    if (Array.isArray(message)) {
      const responses = (await Promise.all(message.map((item) => this.handle(item)))).filter((r) => r !== null);
      if (responses.length > 0) this.write(responses);
      return;
    }
    const response = await this.handle(message);
    if (response !== null) this.write(response);
  }

  private async handle(message: unknown): Promise<unknown> {
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if (isRecord(message) && message.method === undefined && ('result' in message || 'error' in message)) return null;
      return errorResponse(idOf(message), JSONRPC_INVALID_REQUEST, 'Richiesta JSON-RPC non valida.');
    }
    const id = idOf(message);
    if (id === null) return null;
    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = BRIDGE_PROTOCOL_VERSIONS.includes(requested) ? requested : BRIDGE_PROTOCOL_VERSIONS[0];
        const catalog = await this.catalog();
        return result(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'xmap-studio', title: 'XMap Studio', version: this.options.version },
          instructions: catalog.instructions,
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: (await this.catalog()).tools });
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string' || name === '') return errorResponse(id, JSONRPC_INVALID_PARAMS, 'Manca il nome dello strumento.');
        const args = isRecord(params.arguments) ? params.arguments : {};
        let text: string;
        let isError = false;
        try {
          const reply = await (await this.connect()).request({ op: 'call', tool: name, args });
          text = reply.ok ? (reply.text ?? '') : (reply.error ?? 'Errore sconosciuto.');
          isError = !reply.ok;
        } catch (error: unknown) {
          text = messageOf(error);
          isError = true;
        }
        return result(id, { content: [{ type: 'text', text }], isError });
      }
      default:
        return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Metodo non supportato: ${message.method}`);
    }
  }

  /** Catalogo dell'app aperta (sempre aggiornato), altrimenti quello del ponte. */
  private async catalog(): Promise<AgentCatalog> {
    try {
      const reply = await (await this.connect()).request({ op: 'catalog' });
      if (reply.ok && reply.catalog && Array.isArray(reply.catalog.tools)) return reply.catalog;
    } catch {
      // App chiusa: si usa il catalogo del ponte.
    }
    return this.options.catalog;
  }

  private connect(): Promise<AppLink> {
    if (this.link && !this.link.closed) return Promise.resolve(this.link);
    if (!this.connecting) {
      this.connecting = AppLink.open(this.options)
        .then((link) => {
          this.link = link;
          return link;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  private write(value: unknown): void {
    this.options.output.write(`${JSON.stringify(value)}\n`);
  }
}

/** Collegamento autenticato con l'app sul socket locale. */
class AppLink {
  closed = false;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (reply: LinkReply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private constructor(
    private readonly socket: net.Socket,
    private readonly callTimeoutMs: number
  ) {}

  static async open(options: McpBridgeOptions): Promise<AppLink> {
    checkSocketSecurity(options.socketPath);
    const token = await options.token();
    const timeoutMs = options.connectTimeoutMs ?? 2000;
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const candidate = net.createConnection(options.socketPath);
      const timer = setTimeout(() => {
        candidate.destroy();
        reject(new Error(APP_CLOSED));
      }, timeoutMs);
      candidate.once('connect', () => {
        clearTimeout(timer);
        resolve(candidate);
      });
      candidate.once('error', () => {
        clearTimeout(timer);
        reject(new Error(APP_CLOSED));
      });
    });
    socket.setEncoding('utf8');
    const link = new AppLink(socket, options.callTimeoutMs ?? 130_000);
    await link.authenticate(token, timeoutMs);
    return link;
  }

  private authenticate(token: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error('XMap Studio non ha risposto all\'autenticazione.'));
      }, timeoutMs);
      const onData = (chunk: string) => {
        this.buffer += chunk;
        const newline = this.buffer.indexOf('\n');
        if (newline === -1) return;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.socket.off('data', onData);
        clearTimeout(timer);
        let reply: unknown;
        try {
          reply = JSON.parse(line);
        } catch {
          reply = null;
        }
        if (isRecord(reply) && reply.type === 'auth' && reply.ok === true) {
          this.listen();
          resolve();
          return;
        }
        this.close();
        const error = isRecord(reply) && typeof reply.error === 'string' ? reply.error : 'Autenticazione rifiutata.';
        reject(new Error(error));
      };
      this.socket.on('data', onData);
      this.socket.once('close', () => {
        clearTimeout(timer);
        reject(new Error(APP_CLOSED));
      });
      this.socket.write(`${JSON.stringify({ type: 'auth', token })}\n`);
    });
  }

  private listen(): void {
    const onData = (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.reply(line);
        newline = this.buffer.indexOf('\n');
      }
    };
    if (this.buffer !== '') onData('');
    this.socket.on('data', onData);
    this.socket.on('close', () => this.close());
    this.socket.on('error', () => this.close());
  }

  private reply(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(value) || typeof value.id !== 'number') return;
    const entry = this.pending.get(value.id);
    if (!entry) return;
    this.pending.delete(value.id);
    clearTimeout(entry.timer);
    entry.resolve(value as LinkReply);
  }

  request(body: { op: 'catalog' } | { op: 'call'; tool: string; args: Record<string, unknown> }): Promise<LinkReply> {
    if (this.closed) return Promise.reject(new Error(APP_CLOSED));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('XMap Studio non ha risposto in tempo.'));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, ...body })}\n`);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('XMap Studio è stato chiuso prima di rispondere.'));
    }
    this.pending.clear();
  }
}

/**
 * Come Claude Desktop con il socket di Chrome: prima di collegarsi si controlla
 * che cartella e socket siano dell'utente, che la cartella sia `0700` e che
 * nessuno dei due sia un link simbolico. Su Windows (named pipe) non si applica.
 */
export function checkSocketSecurity(socketPath: string): void {
  if (process.platform === 'win32' || socketPath.startsWith('\\\\')) return;
  const uid = process.getuid?.();
  const dir = path.dirname(socketPath);
  let dirInfo: fs.Stats;
  try {
    dirInfo = fs.lstatSync(dir);
  } catch {
    throw new Error(APP_CLOSED);
  }
  if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) throw new Error(`Cartella del socket sospetta (non è una cartella): ${dir}`);
  if (uid !== undefined && dirInfo.uid !== uid) throw new Error(`Cartella del socket di un altro utente: ${dir}`);
  if ((dirInfo.mode & 0o777) !== 0o700) throw new Error(`Permessi della cartella del socket non sicuri (attesi 0700): ${dir}`);
  let info: fs.Stats;
  try {
    info = fs.lstatSync(socketPath);
  } catch {
    throw new Error(APP_CLOSED);
  }
  if (info.isSymbolicLink() || !info.isSocket()) throw new Error(`Il percorso del socket non è un socket: ${socketPath}`);
  if (uid !== undefined && info.uid !== uid) throw new Error(`Socket di un altro utente: ${socketPath}`);
}

function errorResponse(id: JsonRpcId | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function result(id: JsonRpcId, value: unknown): unknown {
  return { jsonrpc: '2.0', id, result: value };
}

function idOf(message: unknown): JsonRpcId | null {
  if (!isRecord(message)) return null;
  const id = message.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
