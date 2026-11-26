import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentCatalog, type AgentCatalog, type AgentLinkRequest, type AgentLinkResponse } from '../src/agent/link.js';
import { MCP_PROTOCOL_VERSIONS } from '../src/agent/mcp.js';
import { startAgentSocketServer, type AgentSocketServer } from '../src/node/agent-socket.js';
import { BRIDGE_PROTOCOL_VERSIONS, checkSocketSecurity, runMcpBridge } from '../src/node/mcp-bridge.js';

const TOKEN = 'chiave-di-prova-0123456789';
const WRONG_TOKEN = 'chiave-sbagliata-0123456789';

interface Bridge {
  send(message: unknown): void;
  sendRaw(line: string): void;
  /** Risposta con questo id (o con id null per gli errori di parsing). */
  reply(id: number | string | null, timeoutMs?: number): Promise<unknown>;
  output: string[];
  done: Promise<void>;
  finish(): Promise<void>;
}

const roots: string[] = [];
const servers: AgentSocketServer[] = [];

function newRoot(): string {
  const root = fs.mkdtempSync('/tmp/xmt-');
  roots.push(root);
  return root;
}

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condizione non verificata in tempo.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Avvia il ponte su stream in memoria; le righe in uscita sono in `output`. */
function startBridge(socketPath: string, overrides: { token?: () => string; catalog?: AgentCatalog } = {}): Bridge {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding('utf8');
  const lines: string[] = [];
  let pending = '';
  output.on('data', (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      lines.push(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  const done = runMcpBridge({
    socketPath,
    token: overrides.token ?? (() => TOKEN),
    catalog: overrides.catalog ?? agentCatalog(),
    version: '26.6.1',
    input,
    output,
  });
  const parsed = (): unknown[] => lines.map((line) => JSON.parse(line) as unknown);
  return {
    send: (message) => input.write(`${JSON.stringify(message)}\n`),
    sendRaw: (line) => input.write(`${line}\n`),
    reply: async (id, timeoutMs = 2000) => {
      await waitUntil(() => parsed().some((value) => (value as { id?: unknown }).id === id), timeoutMs);
      return parsed().find((value) => (value as { id?: unknown }).id === id);
    },
    output: lines,
    done,
    finish: async () => {
      input.end();
      await done;
    },
  };
}

/** Server reale su un socket di prova, con un catalogo e un handle spiati. */
async function startRealServer(socketPath: string, catalog?: AgentCatalog) {
  const handle = vi.fn(
    async (request: AgentLinkRequest): Promise<AgentLinkResponse> => {
      if (request.op === 'catalog') return { id: request.id, ok: true, catalog: catalog ?? agentCatalog() };
      return { id: request.id, ok: true, text: `risultato di ${request.op === 'call' ? request.tool : request.op}` };
    }
  );
  const server = await startAgentSocketServer({ path: socketPath, token: () => TOKEN, handle, version: '26.6.1' });
  servers.push(server);
  return { server, handle };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('ponte MCP su stdio', () => {
  it('BRIDGE_PROTOCOL_VERSIONS coincide con MCP_PROTOCOL_VERSIONS', () => {
    expect(BRIDGE_PROTOCOL_VERSIONS).toEqual(MCP_PROTOCOL_VERSIONS);
  });

  describe('con l\'app chiusa', () => {
    // Il socket non esiste: il ponte deve rispondere lo stesso con il catalogo di ripiego.
    const closedSocket = () => path.join(newRoot(), 'assente', 'mcp.sock');

    it('initialize risponde con il nome del server e le istruzioni del catalogo di ripiego', async () => {
      const bridge = startBridge(closedSocket());
      bridge.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
      const res = (await bridge.reply(1)) as { result: { serverInfo: { name: string }; instructions: string } };
      expect(res.result.serverInfo.name).toBe('xmap-studio');
      expect(res.result.instructions).toBe(agentCatalog().instructions);
      await bridge.finish();
    });

    it('tools/list restituisce gli strumenti di ripiego', async () => {
      const bridge = startBridge(closedSocket());
      bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const res = (await bridge.reply(2)) as { result: { tools: unknown[] } };
      expect(res.result.tools).toEqual(agentCatalog().tools);
      await bridge.finish();
    });

    it('tools/call risponde isError con il messaggio "non è aperto"', async () => {
      const bridge = startBridge(closedSocket());
      bridge.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_map', arguments: {} } });
      const res = (await bridge.reply(3)) as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0]?.text).toContain('non è aperto');
      await bridge.finish();
    });
  });

  describe('con un server reale', () => {
    it('tools/call inoltra op call, tool e args e restituisce il testo dell\'handle', async () => {
      const root = newRoot();
      const socketPath = path.join(root, 'app', 'mcp.sock');
      const { handle } = await startRealServer(socketPath);
      const bridge = startBridge(socketPath);
      bridge.send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'find_topics', arguments: { query: 'ciao' } } });
      const res = (await bridge.reply(10)) as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(res.result.isError).toBe(false);
      expect(res.result.content[0]?.text).toBe('risultato di find_topics');
      expect(handle).toHaveBeenCalledWith(expect.objectContaining({ op: 'call', tool: 'find_topics', args: { query: 'ciao' } }));
      await bridge.finish();
    });

    it('tools/list usa il catalogo restituito dal server per op catalog', async () => {
      const root = newRoot();
      const socketPath = path.join(root, 'app', 'mcp.sock');
      const custom: AgentCatalog = {
        name: 'xmap-studio',
        instructions: 'Catalogo di prova.',
        tools: [{ name: 'strumento_di_prova', title: 'Prova', description: 'Solo per il test.', inputSchema: { type: 'object' } }],
      };
      await startRealServer(socketPath, custom);
      const bridge = startBridge(socketPath);
      bridge.send({ jsonrpc: '2.0', id: 11, method: 'tools/list' });
      const res = (await bridge.reply(11)) as { result: { tools: Array<{ name: string }> } };
      expect(res.result.tools.map((tool) => tool.name)).toEqual(['strumento_di_prova']);
      await bridge.finish();
    });

    it('con una chiave sbagliata tools/call risponde isError con "Chiave"', async () => {
      const root = newRoot();
      const socketPath = path.join(root, 'app', 'mcp.sock');
      await startRealServer(socketPath);
      const bridge = startBridge(socketPath, { token: () => WRONG_TOKEN });
      bridge.send({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'read_map', arguments: {} } });
      const res = (await bridge.reply(12)) as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0]?.text).toContain('Chiave');
      await bridge.finish();
    });
  });

  describe('messaggi', () => {
    const closedSocket = () => path.join(newRoot(), 'assente', 'mcp.sock');

    it('una notifica (senza id) non produce output', async () => {
      const bridge = startBridge(closedSocket());
      bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      bridge.send({ jsonrpc: '2.0', id: 99, method: 'ping' });
      await bridge.reply(99);
      expect(bridge.output).toHaveLength(1);
      expect(JSON.parse(bridge.output[0] ?? '{}')).toMatchObject({ id: 99, result: {} });
      await bridge.finish();
    });

    it('un ultimo messaggio senza a capo prima della chiusura di stdin riceve risposta', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      output.setEncoding('utf8');
      let text = '';
      output.on('data', (chunk: string) => {
        text += chunk;
      });
      const done = runMcpBridge({ socketPath: closedSocket(), token: () => TOKEN, catalog: agentCatalog(), version: '26.6.1', input, output });
      input.end(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' }));
      await done;
      expect(JSON.parse(text.trim())).toMatchObject({ id: 5, result: {} });
    });

    it('un metodo sconosciuto risponde con errore -32601', async () => {
      const bridge = startBridge(closedSocket());
      bridge.send({ jsonrpc: '2.0', id: 7, method: 'metodo/inventato' });
      await expect(bridge.reply(7)).resolves.toMatchObject({ id: 7, error: { code: -32601 } });
      await bridge.finish();
    });

    it('una riga JSON non valida risponde con errore -32700', async () => {
      const bridge = startBridge(closedSocket());
      bridge.sendRaw('{non è JSON');
      await expect(bridge.reply(null)).resolves.toMatchObject({ id: null, error: { code: -32700 } });
      await bridge.finish();
    });

    it('la promessa di runMcpBridge si risolve quando stdin si chiude', async () => {
      const bridge = startBridge(closedSocket());
      let settled = false;
      void bridge.done.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      await bridge.finish();
      expect(settled).toBe(true);
    });
  });
});

describe.skipIf(process.platform === 'win32')('checkSocketSecurity', () => {
  it('rifiuta una cartella del socket con permessi 0755', () => {
    const root = newRoot();
    const dir = path.join(root, 'aperta');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.chmodSync(dir, 0o755);
    expect(() => checkSocketSecurity(path.join(dir, 'mcp.sock'))).toThrow(/0700/);
  });

  it('rifiuta una cartella del socket che è un link simbolico', () => {
    const root = newRoot();
    const real = path.join(root, 'vera');
    fs.mkdirSync(real, { mode: 0o700 });
    const link = path.join(root, 'link');
    fs.symlinkSync(real, link);
    expect(() => checkSocketSecurity(path.join(link, 'mcp.sock'))).toThrow(/sospetta/);
  });
});
