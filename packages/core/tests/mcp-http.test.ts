import * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer, MCP_PROTOCOL_VERSIONS, type JsonRpcResponse, type McpToolOutcome } from '../src/agent/mcp.js';
import {
  MCP_HTTP_PATH,
  startMcpHttpServer,
  type McpHttpServer,
  type McpHttpServerOptions,
} from '../src/node/mcp-http.js';

type Handle = McpHttpServerOptions['handle'];

const servers: McpHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** Avvia un server di prova su porta libera e lo chiude in `afterEach`. */
async function start(
  handle: Handle,
  options: Partial<Pick<McpHttpServerOptions, 'maxBodyBytes' | 'log'>> = {}
): Promise<McpHttpServer> {
  const server = await startMcpHttpServer({ port: 0, handle, log: () => undefined, ...options });
  servers.push(server);
  return server;
}

/** Handle che non risponde mai con un risultato: serve a verificare che i rifiuti non lo raggiungano. */
function stubHandle(): Handle {
  return vi.fn<Handle>(async () => null);
}

/** Handle vero, costruito come in produzione, con `callTool` finto. */
function realHandle(callTool = defaultCallTool()): Handle {
  return createMcpServer({ name: 'xmap-studio', version: '0.0.0', callTool });
}

function defaultCallTool() {
  return vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<McpToolOutcome> => ({
    text: 'Mappa aperta: Progetto',
  }));
}

interface Exchange {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface RawRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Richiesta HTTP grezza con `node:http`: `fetch` non lascia impostare `Host`.
 * Se non si passa `Content-Length` lo mette Node quando il corpo è completo.
 */
function exchange(port: number, request: RawRequest): Promise<Exchange> {
  return new Promise<Exchange>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: request.method, path: request.path, headers: request.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.end(request.body);
  });
}

const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

/** POST /mcp con un messaggio JSON-RPC (o un array) e gli header di un client MCP. */
function postJson(port: number, payload: unknown, headers: Record<string, string> = {}): Promise<Exchange> {
  const body = JSON.stringify(payload);
  return exchange(port, {
    method: 'POST',
    path: MCP_HTTP_PATH,
    headers: { ...MCP_HEADERS, 'Content-Length': String(Buffer.byteLength(body)), ...headers },
    body,
  });
}

/** Richiesta `ping`: la più semplice da far passare, serve a verificare che i controlli lascino entrare. */
const PING = { jsonrpc: '2.0', id: 'ping-1', method: 'ping' };

function parse<T>(text: string): T {
  return JSON.parse(text) as T;
}

function corsHeaders(headers: http.IncomingHttpHeaders): string[] {
  return Object.keys(headers).filter((name) => name.startsWith('access-control-'));
}

describe('indirizzo del server', () => {
  it('url è http://127.0.0.1:<porta>/mcp e il log annuncia l\'indirizzo', async () => {
    const log = vi.fn();
    const server = await start(stubHandle(), { log });
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`);
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining(server.url));
  });

  it('close smette di ascoltare', async () => {
    // Non registrato in `servers`: il test chiude il server da sé.
    const server = await startMcpHttpServer({ port: 0, handle: stubHandle(), log: () => undefined });
    await server.close();
    await expect(exchange(server.port, { method: 'POST', path: MCP_HTTP_PATH })).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });

  it('un errore di handle diventa 500 e viene registrato come avviso', async () => {
    const log = vi.fn();
    const handle = vi.fn<Handle>(async () => {
      throw new Error('guasto interno');
    });
    const server = await start(handle, { log });
    const res = await postJson(server.port, PING);
    expect(res.status).toBe(500);
    expect(res.body).toContain('guasto interno');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('500'));
  });
});

describe('protocollo con createMcpServer', () => {
  it('initialize risponde 200 in JSON, senza Mcp-Session-Id', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client', version: '1' } },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['mcp-session-id']).toBeUndefined();
    const body = parse<JsonRpcResponse>(res.body);
    expect(body.id).toBe(1);
    expect(body.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'xmap-studio' },
    });
  });

  it('initialize senza versione richiesta risponde con la più recente', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, { jsonrpc: '2.0', id: 2, method: 'initialize' });
    expect(parse<JsonRpcResponse>(res.body).result).toMatchObject({ protocolVersion: MCP_PROTOCOL_VERSIONS[0] });
  });

  it('tools/list elenca read_map', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(res.status).toBe(200);
    const tools = (parse<JsonRpcResponse>(res.body).result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toContain('read_map');
  });

  it('tools/call inoltra nome e argomenti a callTool e restituisce content[0].text', async () => {
    const callTool = defaultCallTool();
    const server = await start(realHandle(callTool));
    const res = await postJson(server.port, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'read_map', arguments: { depth: 1 } },
    });
    expect(res.status).toBe(200);
    expect(callTool).toHaveBeenCalledWith('read_map', { depth: 1 });
    expect(parse<JsonRpcResponse>(res.body).result).toMatchObject({
      content: [{ type: 'text', text: 'Mappa aperta: Progetto' }],
    });
  });

  it('una notifica (senza id) riceve 202 senza corpo', async () => {
    const callTool = defaultCallTool();
    const server = await start(realHandle(callTool));
    const res = await postJson(server.port, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(res.body).toBe('');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('un batch con una richiesta e una notifica risponde 200 con un array di una sola risposta', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, [
      { jsonrpc: '2.0', id: 5, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(res.status).toBe(200);
    const body = parse<JsonRpcResponse[]>(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({ jsonrpc: '2.0', id: 5, result: {} });
  });

  it('un batch di sole notifiche risponde 202 senza corpo', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    ]);
    expect(res.status).toBe(202);
    expect(res.body).toBe('');
  });

  it('JSON non valido risponde 400 con errore JSON-RPC -32700 e non chiama handle', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const raw = '{"jsonrpc":';
    const res = await exchange(server.port, {
      method: 'POST',
      path: MCP_HTTP_PATH,
      headers: { ...MCP_HEADERS, 'Content-Length': String(Buffer.byteLength(raw)) },
      body: raw,
    });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = parse<JsonRpcResponse>(res.body);
    expect(body.id).toBeNull();
    expect(body.error?.code).toBe(-32700);
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('metodi HTTP e percorso', () => {
  it('GET /mcp risponde 405 con Allow: POST', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await exchange(server.port, { method: 'GET', path: MCP_HTTP_PATH });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
    expect(handle).not.toHaveBeenCalled();
  });

  it('DELETE /mcp risponde 405 (niente sessioni da chiudere)', async () => {
    const server = await start(stubHandle());
    const res = await exchange(server.port, { method: 'DELETE', path: MCP_HTTP_PATH });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });

  it.each(['/altro', '/mcp/', '/'])('percorso %s risponde 404 e non chiama handle', async (path) => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await exchange(server.port, {
      method: 'POST',
      path,
      headers: { ...MCP_HEADERS, 'Content-Length': '0' },
    });
    expect(res.status).toBe(404);
    expect(handle).not.toHaveBeenCalled();
  });

  it('la query string non sposta la richiesta su un altro percorso', async () => {
    const server = await start(realHandle());
    const body = JSON.stringify(PING);
    const res = await exchange(server.port, {
      method: 'POST',
      path: `${MCP_HTTP_PATH}?sessione=1`,
      headers: { ...MCP_HEADERS, 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(200);
  });
});

describe('Content-Type', () => {
  it('text/plain risponde 415 e non chiama handle', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await postJson(server.port, PING, { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(handle).not.toHaveBeenCalled();
  });

  it('senza Content-Type risponde 415', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const body = JSON.stringify(PING);
    const res = await exchange(server.port, {
      method: 'POST',
      path: MCP_HTTP_PATH,
      headers: { Accept: 'application/json, text/event-stream', 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(415);
    expect(handle).not.toHaveBeenCalled();
  });

  it('application/json con parametro charset è accettato', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, PING, { 'Content-Type': 'application/json; charset=utf-8' });
    expect(res.status).toBe(200);
  });
});

describe('Host (contro il DNS rebinding)', () => {
  it('un Host non di loopback risponde 403 e non chiama handle', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await postJson(server.port, PING, { Host: `evil.example:${server.port}` });
    expect(res.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it('un Host di loopback con porta sbagliata risponde 403', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await postJson(server.port, PING, { Host: '127.0.0.1:1' });
    expect(res.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it('localhost:<porta> e 127.0.0.1:<porta> sono ammessi', async () => {
    const server = await start(realHandle());
    const viaName = await postJson(server.port, PING, { Host: `localhost:${server.port}` });
    const viaIp = await postJson(server.port, PING, { Host: `127.0.0.1:${server.port}` });
    expect(viaName.status).toBe(200);
    expect(viaIp.status).toBe(200);
  });
});

describe('Origin', () => {
  it.each([
    ['https://evil.example'],
    ['http://127.0.0.1.evil.example'],
    ['http://localhost.evil.example:5173'],
    ['http://localhost@evil.example'],
    ['null'],
  ])('Origin %s risponde 403 e non chiama handle', async (origin) => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await postJson(server.port, PING, { Origin: origin });
    expect(res.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([['http://localhost:5173'], ['http://127.0.0.1:5173'], ['http://[::1]:5173']])(
    'Origin %s (loopback) è ammessa',
    async (origin) => {
      const handle = vi.fn<Handle>(async () => ({ jsonrpc: '2.0', id: 'ping-1', result: {} }));
      const server = await start(handle);
      const res = await postJson(server.port, PING, { Origin: origin });
      expect(res.status).toBe(200);
      expect(handle).toHaveBeenCalledTimes(1);
    }
  );

  it('senza Origin la richiesta passa', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, PING);
    expect(res.status).toBe(200);
  });
});

describe('MCP-Protocol-Version', () => {
  it('una versione non supportata risponde 400 e non chiama handle', async () => {
    const handle = stubHandle();
    const server = await start(handle);
    const res = await postJson(server.port, PING, { 'MCP-Protocol-Version': '1999-01-01' });
    expect(res.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it('una versione supportata è ammessa', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, PING, { 'MCP-Protocol-Version': '2025-06-18' });
    expect(res.status).toBe(200);
  });

  it('senza l\'header la richiesta passa', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, PING);
    expect(res.status).toBe(200);
  });
});

describe('limite del corpo', () => {
  it('corpo oltre maxBodyBytes (Content-Length dichiarato) risponde 413 e non chiama handle', async () => {
    const handle = stubHandle();
    const server = await start(handle, { maxBodyBytes: 1024 });
    const res = await postJson(server.port, { ...PING, params: { pad: 'x'.repeat(4096) } });
    expect(res.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it('corpo oltre maxBodyBytes senza Content-Length (chunked) risponde 413', async () => {
    const handle = stubHandle();
    const server = await start(handle, { maxBodyBytes: 1024 });
    const body = JSON.stringify({ ...PING, params: { pad: 'x'.repeat(4096) } });
    const res = await exchange(server.port, {
      method: 'POST',
      path: MCP_HTTP_PATH,
      headers: { ...MCP_HEADERS, 'Transfer-Encoding': 'chunked' },
      body,
    });
    expect(res.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it('corpo sotto il limite passa', async () => {
    const server = await start(realHandle(), { maxBodyBytes: 1024 });
    const res = await postJson(server.port, { ...PING, params: { pad: 'x'.repeat(500) } });
    expect(res.status).toBe(200);
  });
});

describe('nessun header CORS', () => {
  it('nessuna risposta contiene access-control-*, neanche al preflight', async () => {
    const server = await start(realHandle());
    const port = server.port;
    const responses = [
      await postJson(port, PING, { Origin: 'http://localhost:5173' }),
      await postJson(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, { Origin: 'http://localhost:5173' }),
      await postJson(port, PING, { Origin: 'https://evil.example' }),
      await postJson(port, PING, { 'Content-Type': 'text/plain' }),
      await postJson(port, PING, { 'MCP-Protocol-Version': '1999-01-01' }),
      await exchange(port, { method: 'GET', path: MCP_HTTP_PATH, headers: { Origin: 'http://localhost:5173' } }),
      await exchange(port, {
        method: 'OPTIONS',
        path: MCP_HTTP_PATH,
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
    ];
    for (const res of responses) expect(corsHeaders(res.headers)).toEqual([]);
  });
});

describe('batch vuoto', () => {
  // JSON-RPC 2.0: un array vuoto non è un batch valido e la risposta è un singolo errore -32600.
  it('un array vuoto riceve 400 con un errore -32600', async () => {
    const server = await start(realHandle());
    const res = await postJson(server.port, []);
    expect(res.status).toBe(400);
    expect(parse<JsonRpcResponse>(res.body).error?.code).toBe(-32600);
  });
});
