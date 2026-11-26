/**
 * Server WebSocket del collegamento con gli agenti (plugin di Hermes Desktop):
 * ascolta solo su 127.0.0.1 e porta le stesse richieste del server MCP HTTP
 * dell'app (`AgentLinkRequest` / `AgentLinkResponse`). Chi lo usa
 * fornisce `dispatch`, che esegue la richiesta: qui ci sono solo trasporto e
 * controlli d'accesso.
 *
 * Difese, in ordine: indirizzo di loopback; header Host di loopback (contro il
 * DNS rebinding); header Origin fra quelli ammessi; token di accoppiamento nel
 * primo messaggio, confrontato a tempo costante; limiti a dimensione dei
 * messaggi, richieste in corso, client e tempo di ogni richiesta.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { Duplex } from 'node:stream';
import { parseAgentLinkRequest, type AgentLinkRequest, type AgentLinkResponse } from '../agent/link.js';
import {
  CLOSE_GOING_AWAY,
  CLOSE_NORMAL,
  CLOSE_POLICY_VIOLATION,
  CLOSE_PROTOCOL_ERROR,
  OPCODE_PING,
  OPCODE_PONG,
  WebsocketDecoder,
  WebsocketProtocolError,
  encodeClose,
  encodeFrame,
  encodeText,
  isValidWebsocketKey,
  websocketAcceptKey,
} from './ws-frame.js';

export const AGENT_LINK_HOST = '127.0.0.1';
/** Versione del protocollo annunciata dopo l'autenticazione. */
export const AGENT_LINK_PROTOCOL = 1;

export interface AgentLinkServerOptions {
  /** Porta su 127.0.0.1; 0 sceglie una porta libera (test). */
  port: number;
  /** Token di accoppiamento: almeno 16 caratteri. */
  token: string;
  /** Valori di Origin ammessi, confrontati esattamente (es. `file://` per Hermes Desktop). */
  allowedOrigins: readonly string[];
  dispatch: (request: AgentLinkRequest) => Promise<AgentLinkResponse>;
  appVersion?: string;
  maxMessageBytes?: number;
  authTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxClients?: number;
  maxInFlightPerClient?: number;
  /** Ogni quanto si manda un ping; un client che non risponde a due ping di fila viene chiuso. */
  heartbeatMs?: number;
  /** Numero di client autenticati, a ogni cambiamento. */
  onClientsChange?: (count: number) => void;
  log?: (level: 'info' | 'warn', message: string) => void;
}

export interface AgentLinkServer {
  readonly port: number;
  clients(): number;
  /** Smette di ascoltare e chiude ogni connessione. */
  close(): Promise<void>;
}

const DEFAULTS = {
  maxMessageBytes: 4 * 1024 * 1024,
  authTimeoutMs: 5000,
  requestTimeoutMs: 130_000,
  maxClients: 8,
  maxInFlightPerClient: 16,
  heartbeatMs: 30_000,
};

const MIN_TOKEN_LENGTH = 16;

/** Confronto a tempo costante: si confrontano i digest, che hanno sempre la stessa lunghezza. */
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export async function startAgentLinkServer(options: AgentLinkServerOptions): Promise<AgentLinkServer> {
  if (options.token.length < MIN_TOKEN_LENGTH) throw new Error('Token di accoppiamento troppo corto.');
  const config = { ...DEFAULTS, ...definedOnly(options) };
  const log = options.log ?? (() => undefined);
  const connections = new Set<Connection>();
  let authenticated = 0;
  const changeAuthenticated = (delta: number) => {
    authenticated += delta;
    options.onClientsChange?.(authenticated);
  };

  const server = http.createServer((_req, res) => {
    // Solo WebSocket: niente CORS, niente contenuto per le pagine web.
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket' }).end('Serve un WebSocket.\n');
  });

  server.on('upgrade', (req, socket, head: Buffer) => {
    const refusal = checkUpgrade(req, server, options.allowedOrigins, connections.size, config.maxClients);
    if (refusal) {
      log('warn', `Collegamento agenti rifiutato: ${refusal.reason}`);
      rejectUpgrade(socket, refusal.status, refusal.reason);
      return;
    }
    const key = String(req.headers['sec-websocket-key']);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}\r\n\r\n`
    );
    const connection = new Connection(socket, options, config, log, changeAuthenticated);
    connections.add(connection);
    socket.once('close', () => connections.delete(connection));
    // Il client può spedire il primo frame nello stesso pacchetto dell'handshake.
    if (head.length > 0) connection.receive(head);
  });

  // Un client che si blocca a metà handshake non deve tenere il socket aperto.
  server.headersTimeout = config.authTimeoutMs;
  server.requestTimeout = config.authTimeoutMs;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, AGENT_LINK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  log('info', `Collegamento agenti in ascolto su ws://${AGENT_LINK_HOST}:${port}`);

  return {
    port,
    clients: () => authenticated,
    close: () =>
      new Promise<void>((resolve) => {
        for (const connection of connections) connection.close(CLOSE_GOING_AWAY, 'XMap Studio ha chiuso il collegamento.');
        server.close(() => resolve());
      }),
  };
}

type Config = typeof DEFAULTS;

function checkUpgrade(
  req: http.IncomingMessage,
  server: http.Server,
  allowedOrigins: readonly string[],
  connections: number,
  maxClients: number
): { status: number; reason: string } | null {
  const remote = req.socket.remoteAddress ?? '';
  if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1' && remote !== '::1') {
    return { status: 403, reason: `indirizzo non locale (${remote})` };
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    return { status: 403, reason: `Host non ammesso (${host})` };
  }
  const origin = req.headers.origin;
  if (origin === undefined || !allowedOrigins.includes(origin)) {
    return { status: 403, reason: `Origin non ammessa (${origin ?? 'assente'})` };
  }
  if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') {
    return { status: 400, reason: 'handshake WebSocket non valido' };
  }
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !isValidWebsocketKey(key)) return { status: 400, reason: 'chiave WebSocket non valida' };
  if (connections >= maxClients) return { status: 503, reason: 'troppi client collegati' };
  return null;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const text = http.STATUS_CODES[status] ?? 'Error';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${reason}\n`, () =>
    socket.destroy()
  );
}

/** Una connessione WebSocket, dall'autenticazione alla chiusura. */
class Connection {
  private readonly decoder: WebsocketDecoder;
  private authed = false;
  private closed = false;
  private inFlight = 0;
  private missedPongs = 0;
  private readonly authTimer: NodeJS.Timeout;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly socket: Duplex,
    private readonly options: AgentLinkServerOptions,
    private readonly config: Config,
    private readonly log: (level: 'info' | 'warn', message: string) => void,
    private readonly changeAuthenticated: (delta: number) => void
  ) {
    this.decoder = new WebsocketDecoder(config.maxMessageBytes);
    this.authTimer = setTimeout(() => this.close(CLOSE_POLICY_VIOLATION, 'Autenticazione mancante.'), config.authTimeoutMs);
    this.heartbeat = setInterval(() => {
      if (this.missedPongs >= 2) {
        this.close(CLOSE_GOING_AWAY, 'Il client non risponde.');
        return;
      }
      this.missedPongs++;
      this.write(encodeFrame(OPCODE_PING));
    }, config.heartbeatMs);
    this.heartbeat.unref();
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    // I socket di http.Server restano mezzi aperti quando il client chiude: si chiude anche il nostro lato.
    socket.on('end', () => {
      this.teardown();
      socket.destroy();
    });
    socket.on('error', () => this.teardown());
    socket.on('close', () => this.teardown());
  }

  receive(chunk: Buffer): void {
    let events;
    try {
      events = this.decoder.push(chunk);
    } catch (error: unknown) {
      const code = error instanceof WebsocketProtocolError ? error.closeCode : CLOSE_PROTOCOL_ERROR;
      this.close(code, error instanceof Error ? error.message : 'Errore di protocollo.');
      return;
    }
    for (const event of events) {
      if (this.closed) return;
      if (event.type === 'ping') this.write(encodeFrame(OPCODE_PONG, event.data));
      else if (event.type === 'pong') this.missedPongs = 0;
      else if (event.type === 'close') this.close(CLOSE_NORMAL, '');
      else this.onMessage(event.text);
    }
  }

  private onMessage(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      this.send({ id: 0, ok: false, error: 'Richiesta non valida: JSON illeggibile.' });
      return;
    }
    if (!this.authed) {
      this.authenticate(message);
      return;
    }
    let request: AgentLinkRequest;
    try {
      request = parseAgentLinkRequest(message);
    } catch (error: unknown) {
      const id = isRecord(message) && typeof message.id === 'number' ? message.id : 0;
      this.send({ id, ok: false, error: `Richiesta non valida: ${errorMessage(error)}` });
      return;
    }
    if (this.inFlight >= this.config.maxInFlightPerClient) {
      this.send({ id: request.id, ok: false, error: 'Troppe richieste in corso: riprova tra poco.' });
      return;
    }
    this.inFlight++;
    void this.run(request).then((response) => {
      this.inFlight--;
      this.send(response);
    });
  }

  private async run(request: AgentLinkRequest): Promise<AgentLinkResponse> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AgentLinkResponse>((resolve) => {
      timer = setTimeout(
        () => resolve({ id: request.id, ok: false, error: 'XMap Studio non ha risposto in tempo.' }),
        this.config.requestTimeoutMs
      );
    });
    try {
      const work = this.options
        .dispatch(request)
        .then((response): AgentLinkResponse => ({ ...response, id: request.id }))
        .catch((error: unknown): AgentLinkResponse => ({ id: request.id, ok: false, error: errorMessage(error) }));
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private authenticate(message: unknown): void {
    const token = isRecord(message) && message.type === 'auth' && typeof message.token === 'string' ? message.token : null;
    if (token === null || !tokensMatch(token, this.options.token)) {
      this.log('warn', 'Collegamento agenti: token non valido.');
      this.sendRaw({ type: 'auth', ok: false, error: 'Token di accoppiamento non valido.' });
      this.close(CLOSE_POLICY_VIOLATION, 'Token non valido.');
      return;
    }
    clearTimeout(this.authTimer);
    this.authed = true;
    this.changeAuthenticated(1);
    this.log('info', 'Collegamento agenti: client autenticato.');
    this.sendRaw({
      type: 'auth',
      ok: true,
      app: 'xmap-studio',
      version: this.options.appVersion ?? null,
      protocol: AGENT_LINK_PROTOCOL,
    });
  }

  private send(response: AgentLinkResponse): void {
    this.sendRaw(response);
  }

  private sendRaw(value: unknown): void {
    this.write(encodeText(JSON.stringify(value)));
  }

  private write(frame: Buffer): void {
    if (!this.closed && !this.socket.destroyed) this.socket.write(frame);
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.write(encodeClose(code, reason));
    this.closed = true;
    this.socket.end();
    // Se il client non chiude a sua volta, il socket si distrugge comunque.
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.teardown();
  }

  private teardown(): void {
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.heartbeat);
    if (this.authed) {
      this.authed = false;
      this.changeAuthenticated(-1);
    }
  }
}

function definedOnly(options: AgentLinkServerOptions): Partial<Config> {
  const out: Partial<Config> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const value = options[key];
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
