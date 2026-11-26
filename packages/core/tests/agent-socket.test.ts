import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentCatalog, type AgentLinkRequest, type AgentLinkResponse } from '../src/agent/link.js';
import {
  agentSocketPath,
  startAgentSocketServer,
  type AgentSocketServer,
  type AgentSocketServerOptions,
} from '../src/node/agent-socket.js';

const TOKEN = 'chiave-di-prova-0123456789';
const OTHER_TOKEN = 'altra-chiave-0123456789abcdef';

interface Client {
  socket: net.Socket;
  next(timeoutMs?: number): Promise<unknown>;
  closed(timeoutMs?: number): Promise<void>;
}

const servers: AgentSocketServer[] = [];
const clients: net.Socket[] = [];
const roots: string[] = [];

/** Piccola attesa su una condizione, con timeout generoso. */
async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condizione non verificata in tempo.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Client grezzo: legge le righe JSON in arrivo e le consegna in ordine. */
function openClient(socketPath: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    clients.push(socket);
    const queue: unknown[] = [];
    const waiters: Array<(value: unknown) => void> = [];
    let closed = false;
    const closeWaiters: Array<() => void> = [];
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const value = JSON.parse(line) as unknown;
        const waiter = waiters.shift();
        if (waiter) waiter(value);
        else queue.push(value);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      closed = true;
      for (const notify of closeWaiters.splice(0)) notify();
    });
    socket.once('error', reject);
    socket.once('connect', () => {
      resolve({
        socket,
        next(timeoutMs = 2000) {
          if (queue.length > 0) return Promise.resolve(queue.shift());
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Nessuna riga in tempo.')), timeoutMs);
            waiters.push((value) => {
              clearTimeout(timer);
              res(value);
            });
          });
        },
        closed(timeoutMs = 2000) {
          if (closed) return Promise.resolve();
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Connessione non chiusa in tempo.')), timeoutMs);
            closeWaiters.push(() => {
              clearTimeout(timer);
              res();
            });
          });
        },
      });
    });
  });
}

function newRoot(): string {
  const root = fs.mkdtempSync('/tmp/xmt-');
  roots.push(root);
  return root;
}

function listenRaw(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(socketPath, () => resolve(server));
  });
}

async function startServer(
  socketPath: string,
  overrides: Partial<AgentSocketServerOptions> = {}
): Promise<{ server: AgentSocketServer; handle: ReturnType<typeof vi.fn> }> {
  const handle = vi.fn(
    async (request: AgentLinkRequest): Promise<AgentLinkResponse> => {
      if (request.op === 'catalog') return { id: request.id, ok: true, catalog: agentCatalog() };
      return { id: request.id, ok: true, text: `eseguito ${request.op === 'call' ? request.tool : request.op}` };
    }
  );
  const server = await startAgentSocketServer({
    path: socketPath,
    token: () => TOKEN,
    handle: overrides.handle ?? handle,
    version: '26.6.1',
    ...overrides,
  });
  servers.push(server);
  return { server, handle };
}

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('socket locale del ponte MCP', () => {
  it('crea la cartella 0700 e il socket 0600', async () => {
    const root = newRoot();
    const dir = path.join(root, 'nuova');
    const socketPath = path.join(dir, 'mcp.sock');
    await startServer(socketPath);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
    expect(fs.lstatSync(socketPath).isSocket()).toBe(true);
  });

  it('con la chiave giusta risponde auth ok e inoltra le richieste all\'handle', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    const { handle } = await startServer(socketPath);
    const client = await openClient(socketPath);
    client.socket.write(`${JSON.stringify({ type: 'auth', token: TOKEN })}\n`);
    await expect(client.next()).resolves.toMatchObject({ type: 'auth', ok: true, app: 'xmap-studio', protocol: 1 });

    client.socket.write(`${JSON.stringify({ id: 1, op: 'call', tool: 'read_map', args: {} })}\n`);
    await expect(client.next()).resolves.toEqual({ id: 1, ok: true, text: 'eseguito read_map' });
    expect(handle).toHaveBeenCalledWith({ id: 1, op: 'call', tool: 'read_map', args: {} });
  });

  it('con una chiave sbagliata risponde auth ko, chiude e non chiama l\'handle', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    const { handle } = await startServer(socketPath);
    const client = await openClient(socketPath);
    client.socket.write(`${JSON.stringify({ type: 'auth', token: OTHER_TOKEN })}\n`);
    await expect(client.next()).resolves.toMatchObject({ type: 'auth', ok: false });
    await client.closed();
    expect(handle).not.toHaveBeenCalled();
  });

  it('senza autenticazione entro authTimeoutMs il collegamento viene rifiutato', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    const { handle } = await startServer(socketPath, { authTimeoutMs: 100 });
    const client = await openClient(socketPath);
    await expect(client.next()).resolves.toMatchObject({ type: 'auth', ok: false });
    await client.closed();
    expect(handle).not.toHaveBeenCalled();
  });

  it('una richiesta non valida dopo l\'autenticazione risponde ok:false con lo stesso id', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    await startServer(socketPath);
    const client = await openClient(socketPath);
    client.socket.write(`${JSON.stringify({ type: 'auth', token: TOKEN })}\n`);
    await client.next();
    client.socket.write(`${JSON.stringify({ id: 42, op: 'operazione-inventata' })}\n`);
    await expect(client.next()).resolves.toMatchObject({ id: 42, ok: false });
  });

  it('conta i client autenticati e avvisa a ogni cambiamento', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    const onClientsChange = vi.fn();
    const { server } = await startServer(socketPath, { onClientsChange });
    expect(server.clients).toBe(0);

    const client = await openClient(socketPath);
    client.socket.write(`${JSON.stringify({ type: 'auth', token: TOKEN })}\n`);
    await client.next();
    expect(server.clients).toBe(1);
    expect(onClientsChange).toHaveBeenLastCalledWith(1);

    client.socket.destroy();
    await waitUntil(() => server.clients === 0);
    expect(onClientsChange).toHaveBeenLastCalledWith(0);
  });

  it('dropStaleClients chiude i client con una chiave non più attuale', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    let current = TOKEN;
    const { server } = await startServer(socketPath, { token: () => current });

    const client = await openClient(socketPath);
    client.socket.write(`${JSON.stringify({ type: 'auth', token: TOKEN })}\n`);
    await client.next();
    expect(server.clients).toBe(1);

    current = OTHER_TOKEN;
    server.dropStaleClients();
    await client.closed();
    await waitUntil(() => server.clients === 0);
  });

  it('un secondo server sullo stesso percorso, con il primo attivo, fallisce con EADDRINUSE', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    await startServer(socketPath);
    await expect(startAgentSocketServer({ path: socketPath, token: () => TOKEN, handle: async () => ({ id: 0, ok: false, error: '' }), version: '1' })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });

  it('un socket rimasto da un\'istanza chiusa male viene sostituito', async () => {
    const root = newRoot();
    const dir = path.join(root, 'app');
    fs.mkdirSync(dir, { mode: 0o700 });
    const socketPath = path.join(dir, 'mcp.sock');
    // Il file del socket resta sul disco quando il server si chiude senza toglierlo: si simula spostandolo via prima della chiusura.
    const stash = path.join(root, 'stash.sock');
    const raw = await listenRaw(socketPath);
    fs.renameSync(socketPath, stash);
    await new Promise<void>((resolve) => raw.close(() => resolve()));
    fs.renameSync(stash, socketPath);
    expect(fs.lstatSync(socketPath).isSocket()).toBe(true);

    const { server } = await startServer(socketPath);
    const client = await openClient(socketPath);
    client.socket.write(`${JSON.stringify({ type: 'auth', token: TOKEN })}\n`);
    await expect(client.next()).resolves.toMatchObject({ ok: true });
    expect(server.path).toBe(socketPath);
  });

  it('close() toglie il file del socket', async () => {
    const root = newRoot();
    const socketPath = path.join(root, 'app', 'mcp.sock');
    const { server } = await startServer(socketPath);
    expect(fs.existsSync(socketPath)).toBe(true);
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('rifiuta una cartella del socket che è un link simbolico', async () => {
    const root = newRoot();
    const real = path.join(root, 'vera');
    fs.mkdirSync(real, { mode: 0o700 });
    const link = path.join(root, 'link');
    fs.symlinkSync(real, link);
    await expect(startServer(path.join(link, 'mcp.sock'))).rejects.toThrow(/non è una cartella/);
    expect(fs.existsSync(path.join(real, 'mcp.sock'))).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('agentSocketPath', () => {
  it('con XMAP_MCP_SOCKET restituisce il percorso indicato', () => {
    expect(agentSocketPath({ XMAP_MCP_SOCKET: '/x/y.sock' })).toBe('/x/y.sock');
  });

  it('con XDG_RUNTIME_DIR esistente usa <dir>/xmap-studio-<uid>/mcp.sock', () => {
    const root = newRoot();
    const runtime = path.join(root, 'run');
    fs.mkdirSync(runtime, { mode: 0o700 });
    const uid = String(process.getuid?.());
    expect(agentSocketPath({ XDG_RUNTIME_DIR: runtime })).toBe(path.join(runtime, `xmap-studio-${uid}`, 'mcp.sock'));
  });
});
