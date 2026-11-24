import * as net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentCatalog, type AgentLinkResponse } from '../src/agent/link.js';
import {
  startAgentLinkServer,
  tokensMatch,
  type AgentLinkServer,
  type AgentLinkServerOptions,
} from '../src/node/agent-link.js';
import {
  CLOSE_GOING_AWAY,
  CLOSE_POLICY_VIOLATION,
  CLOSE_TOO_BIG,
  OPCODE_CLOSE,
  OPCODE_PING,
  OPCODE_PONG,
  OPCODE_TEXT,
  websocketAcceptKey,
} from '../src/node/ws-frame.js';

type Dispatch = AgentLinkServerOptions['dispatch'];

const TOKEN = 'segreto-di-prova-0123456789';
const ORIGIN = 'file://';
const VALID_KEY = Buffer.alloc(16, 1).toString('base64');
const AUTH_OK = { type: 'auth', ok: true, app: 'xmap-studio', version: '26.6.0', protocol: 1 };
const MASK = Buffer.from([0x12, 0x34, 0x56, 0x78]);

/** Frame come lo manda un client WebSocket: mascherato. */
function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const n = payload.length;
  let header: Buffer;
  if (n < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | n;
  } else if (n <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(n, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(n), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= MASK[i & 3];
  return Buffer.concat([header, MASK, masked]);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Risposta dal dispatch di default: ogni operazione ha un esito riconoscibile. */
const answer: Dispatch = async (request) => {
  if (request.op === 'maps') return { id: request.id, ok: true, text: 'Mappa aperta: Progetto' };
  if (request.op === 'catalog') return { id: request.id, ok: true, catalog: agentCatalog() };
  return { id: request.id, ok: true, text: `eseguito ${request.tool}` };
};

const servers: AgentLinkServer[] = [];
const sockets: net.Socket[] = [];

/** Avvia un server di prova su porta libera; il `dispatch` è un finto spiato. */
async function startServer(overrides: Partial<AgentLinkServerOptions> = {}) {
  const dispatch = vi.fn(overrides.dispatch ?? answer);
  const server = await startAgentLinkServer({
    port: 0,
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    appVersion: '26.6.0',
    ...overrides,
    dispatch,
  });
  servers.push(server);
  return { server, dispatch };
}

interface HandshakeOptions {
  host?: string;
  /** `null` non manda l'header Origin. */
  origin?: string | null;
  /** `null` non manda la chiave. */
  key?: string | null;
  version?: string;
  /** GET normale, senza intestazioni di upgrade. */
  plain?: boolean;
  /** Frame mandato nello stesso pacchetto dell'handshake. */
  firstFrame?: Buffer;
}

interface Handshake {
  status: number;
  head: string;
  socket: net.Socket;
  rest: Buffer;
}

/** Handshake HTTP scritto a mano: legge solo la status line e le intestazioni della risposta. */
function handshake(port: number, options: HandshakeOptions = {}): Promise<Handshake> {
  const lines = ['GET / HTTP/1.1', `Host: ${options.host ?? `127.0.0.1:${port}`}`];
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) lines.push(`Origin: ${origin}`);
  if (!options.plain) {
    lines.push('Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Version: ${options.version ?? '13'}`);
    const key = options.key === undefined ? VALID_KEY : options.key;
    if (key !== null) lines.push(`Sec-WebSocket-Key: ${key}`);
  }
  const request = Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1');
  const payload = options.firstFrame ? Buffer.concat([request, options.firstFrame]) : request;

  return new Promise<Handshake>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    sockets.push(socket);
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      const head = received.subarray(0, end).toString('latin1');
      resolve({ status: Number(head.split(' ')[1]), head, socket, rest: received.subarray(end + 4) });
    };
    socket.on('data', onData);
    socket.on('connect', () => socket.write(payload));
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('Connessione chiusa prima della risposta.')));
  });
}

interface ServerFrame {
  opcode: number;
  payload: Buffer;
}

/** Client grezzo: legge i frame non mascherati del server e li accoda per tipo. */
class RawWs {
  private buffer: Buffer;
  private readonly queue: ServerFrame[] = [];
  private ended = false;

  constructor(
    readonly socket: net.Socket,
    initial: Buffer
  ) {
    this.buffer = initial;
    this.parse();
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parse();
    });
    socket.on('close', () => {
      this.ended = true;
    });
    socket.on('error', () => undefined);
  }

  private parse(): void {
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      let length = b[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        length = Number(b.readBigUInt64BE(2));
        offset = 10;
      }
      if (b.length < offset + length) return;
      this.queue.push({ opcode: b[0] & 0x0f, payload: Buffer.from(b.subarray(offset, offset + length)) });
      this.buffer = b.subarray(offset + length);
    }
  }

  async nextFrame(opcode: number, timeoutMs = 2000): Promise<ServerFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex((frame) => frame.opcode === opcode);
      if (index !== -1) return this.queue.splice(index, 1)[0];
      if (this.ended || Date.now() >= deadline) throw new Error(`Nessun frame ${opcode} dal server.`);
      await sleep(5);
    }
  }

  async nextText(timeoutMs?: number): Promise<unknown> {
    const frame = await this.nextFrame(OPCODE_TEXT, timeoutMs);
    return JSON.parse(frame.payload.toString('utf8'));
  }

  /** Codice del frame di chiusura del server, `null` se non ne ha. */
  async closeCode(timeoutMs?: number): Promise<number | null> {
    const frame = await this.nextFrame(OPCODE_CLOSE, timeoutMs);
    return frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null;
  }

  sendJson(value: unknown): void {
    this.send(maskedFrame(OPCODE_TEXT, Buffer.from(JSON.stringify(value), 'utf8')));
  }

  send(frame: Buffer): void {
    this.socket.write(frame);
  }
}

/** Handshake e autenticazione con il token giusto. */
async function connectAuthed(port: number): Promise<RawWs> {
  const hs = await handshake(port);
  expect(hs.status).toBe(101);
  const ws = new RawWs(hs.socket, hs.rest);
  ws.sendJson({ type: 'auth', token: TOKEN });
  expect(await ws.nextText()).toEqual(AUTH_OK);
  return ws;
}

async function ask(ws: RawWs, request: unknown): Promise<unknown> {
  ws.sendJson(request);
  return ws.nextText();
}

/** Verifica che l'handshake venga rifiutato con lo stato HTTP atteso, senza 101. */
async function expectRefused(port: number, options: HandshakeOptions, status: number): Promise<void> {
  const hs = await handshake(port, options);
  expect(hs.status).toBe(status);
  hs.socket.destroy();
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
});

describe('tokensMatch', () => {
  it('riconosce il token uguale e rifiuta quello diverso', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch('segreto-di-prova-0123456780', TOKEN)).toBe(false);
  });

  it('rifiuta token di lunghezza diversa, anche se è un prefisso', () => {
    expect(tokensMatch(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN + 'x', TOKEN)).toBe(false);
    expect(tokensMatch('', TOKEN)).toBe(false);
  });
});

describe('startAgentLinkServer: configurazione', () => {
  it('rifiuta un token più corto di 16 caratteri', async () => {
    await expect(
      startAgentLinkServer({ port: 0, token: '123456789012345', allowedOrigins: [ORIGIN], dispatch: answer })
    ).rejects.toThrow('Token di accoppiamento troppo corto.');
  });

  it('accetta un token di 16 caratteri e ascolta su una porta reale', async () => {
    const { server } = await startServer({ token: '1234567890123456' });
    expect(server.port).toBeGreaterThan(0);
    expect(server.clients()).toBe(0);
  });
});

describe('collegamento con il token giusto', () => {
  it('risponde all auth con app, versione e protocollo', async () => {
    const { server } = await startServer();
    const hs = await handshake(server.port);
    expect(hs.status).toBe(101);
    expect(hs.head).toContain(`Sec-WebSocket-Accept: ${websocketAcceptKey(VALID_KEY)}`);
    const ws = new RawWs(hs.socket, hs.rest);
    ws.sendJson({ type: 'auth', token: TOKEN });
    expect(await ws.nextText()).toEqual(AUTH_OK);
  });

  it('risponde a maps, catalog e call; l id torna uguale a quello della richiesta', async () => {
    const { server, dispatch } = await startServer({
      dispatch: async () => ({ id: 999, ok: true, text: 'risposta con id sbagliato' }),
    });
    const ws = await connectAuthed(server.port);
    expect(await ask(ws, { id: 1, op: 'maps' })).toEqual({ id: 1, ok: true, text: 'risposta con id sbagliato' });
    expect(await ask(ws, { id: 2, op: 'catalog' })).toEqual({ id: 2, ok: true, text: 'risposta con id sbagliato' });
    expect(await ask(ws, { id: 3, op: 'call', map: 2, tool: 'read_map', args: { topic: 'x' } })).toMatchObject({
      id: 3,
      ok: true,
    });
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('passa al dispatch la richiesta validata', async () => {
    const { server, dispatch } = await startServer();
    const ws = await connectAuthed(server.port);
    const response = await ask(ws, { id: 3, op: 'call', map: 2, tool: 'read_map', args: { topic: 'x' } });
    expect(response).toEqual({ id: 3, ok: true, text: 'eseguito read_map' });
    expect(dispatch).toHaveBeenCalledWith({ id: 3, op: 'call', map: 2, tool: 'read_map', args: { topic: 'x' } });
  });

  it('risponde al catalogo con gli strumenti e le istruzioni', async () => {
    const { server } = await startServer();
    const ws = await connectAuthed(server.port);
    const response = await ask(ws, { id: 2, op: 'catalog' });
    expect(response).toEqual({ id: 2, ok: true, catalog: JSON.parse(JSON.stringify(agentCatalog())) });
  });

  it('un messaggio lungo (lunghezza a 16 bit) arriva intero al dispatch', async () => {
    const { server, dispatch } = await startServer();
    const ws = await connectAuthed(server.port);
    const text = 'x'.repeat(300);
    await ask(ws, { id: 4, op: 'call', tool: 'save_map', args: { text } });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ args: { text } }));
  });

  it('conta i client autenticati e li riporta a onClientsChange', async () => {
    const onClientsChange = vi.fn();
    const { server } = await startServer({ onClientsChange });
    const hs = await handshake(server.port);
    expect(server.clients()).toBe(0);
    const ws = new RawWs(hs.socket, hs.rest);
    ws.sendJson({ type: 'auth', token: TOKEN });
    expect(await ws.nextText()).toEqual(AUTH_OK);
    expect(server.clients()).toBe(1);
    expect(onClientsChange).toHaveBeenLastCalledWith(1);

    hs.socket.destroy();
    await vi.waitFor(() => expect(server.clients()).toBe(0));
    expect(onClientsChange.mock.calls).toEqual([[1], [0]]);
  });

  it('il primo messaggio spedito insieme all handshake non va perso', async () => {
    const { server } = await startServer();
    const authFrame = maskedFrame(OPCODE_TEXT, Buffer.from(JSON.stringify({ type: 'auth', token: TOKEN })));
    const hs = await handshake(server.port, { firstFrame: authFrame });
    expect(hs.status).toBe(101);
    const ws = new RawWs(hs.socket, hs.rest);
    expect(await ws.nextText()).toEqual(AUTH_OK);
  });

  it('risponde al ping del client con un pong dello stesso payload', async () => {
    const { server } = await startServer();
    const ws = await connectAuthed(server.port);
    ws.send(maskedFrame(OPCODE_PING, Buffer.from('eco')));
    const pong = await ws.nextFrame(OPCODE_PONG);
    expect(pong.payload.toString('utf8')).toBe('eco');
  });

  it('un JSON illeggibile dopo l auth riceve {id:0, ok:false}', async () => {
    const { server } = await startServer();
    const ws = await connectAuthed(server.port);
    ws.send(maskedFrame(OPCODE_TEXT, Buffer.from('{non è json')));
    expect(await ws.nextText()).toMatchObject({ id: 0, ok: false });
  });

  it('una richiesta con op sconosciuta riceve ok:false con il suo id', async () => {
    const { server, dispatch } = await startServer();
    const ws = await connectAuthed(server.port);
    expect(await ask(ws, { id: 5, op: 'boh' })).toMatchObject({ id: 5, ok: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('un app che non risponde in tempo dà l errore di timeout con lo stesso id', async () => {
    const { server } = await startServer({
      requestTimeoutMs: 100,
      dispatch: () => new Promise<AgentLinkResponse>(() => undefined),
    });
    const ws = await connectAuthed(server.port);
    expect(await ask(ws, { id: 4, op: 'maps' })).toEqual({
      id: 4,
      ok: false,
      error: 'XMap Studio non ha risposto in tempo.',
    });
  });

  it('un dispatch che lancia riporta il messaggio dell errore (app senza finestre)', async () => {
    const { server } = await startServer({
      dispatch: async () => {
        throw new Error('Nessuna finestra di XMap Studio aperta.');
      },
    });
    const ws = await connectAuthed(server.port);
    expect(await ask(ws, { id: 6, op: 'maps' })).toEqual({
      id: 6,
      ok: false,
      error: 'Nessuna finestra di XMap Studio aperta.',
    });
  });

  it('oltre maxInFlightPerClient la richiesta extra riceve un rifiuto immediato', async () => {
    const { server } = await startServer({
      maxInFlightPerClient: 1,
      requestTimeoutMs: 300,
      dispatch: () => new Promise<AgentLinkResponse>(() => undefined),
    });
    const ws = await connectAuthed(server.port);
    ws.sendJson({ id: 1, op: 'maps' });
    ws.sendJson({ id: 2, op: 'maps' });
    expect(await ws.nextText()).toEqual({
      id: 2,
      ok: false,
      error: 'Troppe richieste in corso: riprova tra poco.',
    });
  });

  it('un messaggio oltre maxMessageBytes chiude il collegamento con 1009', async () => {
    const { server } = await startServer({ maxMessageBytes: 64 });
    const ws = await connectAuthed(server.port);
    ws.send(maskedFrame(OPCODE_TEXT, Buffer.alloc(100, 0x61)));
    expect(await ws.closeCode()).toBe(CLOSE_TOO_BIG);
  });

  it('un client che risponde ai ping resta collegato', async () => {
    const { server } = await startServer({ heartbeatMs: 50 });
    const ws = await connectAuthed(server.port);
    for (let i = 0; i < 3; i++) {
      await ws.nextFrame(OPCODE_PING);
      ws.send(maskedFrame(OPCODE_PONG, Buffer.alloc(0)));
    }
    expect(await ask(ws, { id: 7, op: 'maps' })).toMatchObject({ id: 7, ok: true });
  });

  it('un client che non risponde ai ping viene chiuso con 1001', async () => {
    const { server } = await startServer({ heartbeatMs: 50 });
    const ws = await connectAuthed(server.port);
    expect(await ws.closeCode(2000)).toBe(CLOSE_GOING_AWAY);
  });
});

describe('collegamento rifiutato', () => {
  it('token sbagliato: auth ok:false, chiusura 1008 e nessun dispatch', async () => {
    const { server, dispatch } = await startServer();
    const hs = await handshake(server.port);
    const ws = new RawWs(hs.socket, hs.rest);
    ws.sendJson({ type: 'auth', token: 'segreto-sbagliato-0123456789' });
    expect(await ws.nextText()).toEqual({ type: 'auth', ok: false, error: 'Token di accoppiamento non valido.' });
    expect(await ws.closeCode()).toBe(CLOSE_POLICY_VIOLATION);
    expect(dispatch).not.toHaveBeenCalled();
    expect(server.clients()).toBe(0);
  });

  it('una richiesta prima dell auth che non è {type:auth} è rifiutata come token non valido', async () => {
    const { server, dispatch } = await startServer();
    const hs = await handshake(server.port);
    const ws = new RawWs(hs.socket, hs.rest);
    ws.sendJson({ id: 1, op: 'maps' });
    expect(await ws.nextText()).toMatchObject({ type: 'auth', ok: false });
    expect(await ws.closeCode()).toBe(CLOSE_POLICY_VIOLATION);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('nessun messaggio di auth entro authTimeoutMs chiude con 1008', async () => {
    const { server } = await startServer({ authTimeoutMs: 150 });
    const hs = await handshake(server.port);
    const ws = new RawWs(hs.socket, hs.rest);
    expect(await ws.closeCode()).toBe(CLOSE_POLICY_VIOLATION);
  });

  it('un Origin non ammesso riceve 403 e nessun 101', async () => {
    const { server } = await startServer();
    await expectRefused(server.port, { origin: 'https://evil.example' }, 403);
  });

  it('un Origin assente riceve 403', async () => {
    const { server } = await startServer();
    await expectRefused(server.port, { origin: null }, 403);
  });

  it('un Host non di loopback riceve 403 (difesa dal DNS rebinding)', async () => {
    const { server } = await startServer();
    await expectRefused(server.port, { host: `evil.example:${server.port}` }, 403);
  });

  it('una chiave WebSocket non valida o assente riceve 400', async () => {
    const { server } = await startServer();
    await expectRefused(server.port, { key: 'corta' }, 400);
    await expectRefused(server.port, { key: null }, 400);
  });

  it('una versione del protocollo diversa da 13 riceve 400', async () => {
    const { server } = await startServer();
    await expectRefused(server.port, { version: '12' }, 400);
  });

  it('una GET normale senza upgrade riceve 426', async () => {
    const { server } = await startServer();
    await expectRefused(server.port, { plain: true }, 426);
  });

  it('oltre maxClients il collegamento riceve 503', async () => {
    const { server } = await startServer({ maxClients: 1 });
    await connectAuthed(server.port);
    await expectRefused(server.port, {}, 503);
  });
});

describe('chiusura del server', () => {
  it('server.close() chiude i client con 1001', async () => {
    const { server } = await startServer();
    const ws = await connectAuthed(server.port);
    const closing = server.close();
    expect(await ws.closeCode()).toBe(CLOSE_GOING_AWAY);
    await closing;
  });
});

describe('WebSocket globale di Node', () => {
  it.skipIf(typeof WebSocket !== 'function')('si autentica con l header Origin ammesso', async () => {
    const { server } = await startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`, { headers: { Origin: ORIGIN } } as unknown as string[]);
    const reply = new Promise<unknown>((resolve, reject) => {
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
      ws.onmessage = (event) => resolve(JSON.parse(String(event.data)));
      ws.onerror = () => reject(new Error('Errore WebSocket.'));
    });
    expect(await reply).toEqual(AUTH_OK);
    ws.close();
  });
});
