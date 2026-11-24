import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_TOOLS,
  createMcpServer,
  MCP_PROTOCOL_VERSIONS,
  mcpToolList,
  type JsonRpcResponse,
  type McpToolOutcome,
} from '../src/index.js';

/** Risultato di una risposta riuscita; fallisce il test se la risposta è un errore o manca. */
function resultOf(res: JsonRpcResponse | null): Record<string, unknown> {
  expect(res).not.toBeNull();
  expect(res?.error).toBeUndefined();
  return res?.result as Record<string, unknown>;
}

function setup() {
  const callTool = vi.fn(
    async (name: string, args: Record<string, unknown>): Promise<McpToolOutcome> => ({
      text: `${name}:${JSON.stringify(args)}`,
    })
  );
  const handle = createMcpServer({ name: 'xmap-test', version: '1.2.3', callTool });
  return { handle, callTool };
}

describe('initialize', () => {
  it('risponde con la versione richiesta se supportata', async () => {
    const { handle } = setup();
    const res = await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client', version: '1' } },
    });
    expect(res?.id).toBe(1);
    expect(resultOf(res)).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'xmap-test', version: '1.2.3' },
    });
    expect(typeof resultOf(res).instructions).toBe('string');
  });

  it('con una versione non supportata risponde con la più recente', async () => {
    const { handle } = setup();
    const res = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(resultOf(res).protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it('senza protocolVersion risponde con la più recente', async () => {
    const { handle } = setup();
    const res = await handle({ jsonrpc: '2.0', id: 3, method: 'initialize' });
    expect(resultOf(res).protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });
});

describe('notifiche e ping', () => {
  it('una notifica (senza id) non riceve risposta', async () => {
    const { handle, callTool } = setup();
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('ping risponde con un risultato vuoto', async () => {
    const { handle } = setup();
    const res = await handle({ jsonrpc: '2.0', id: 'p1', method: 'ping' });
    expect(res).toEqual({ jsonrpc: '2.0', id: 'p1', result: {} });
  });
});

describe('tools/list', () => {
  it('elenca tutti gli strumenti con schema e annotazioni coerenti', async () => {
    const { handle } = setup();
    const tools = resultOf(await handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).tools as Array<
      Record<string, unknown>
    >;
    expect(tools).toEqual(mcpToolList());
    expect(tools.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));

    for (const def of AGENT_TOOLS) {
      const tool = tools.find((t) => t.name === def.name);
      expect(tool?.inputSchema).toEqual(def.inputSchema);
      expect(tool?.annotations).toEqual({
        title: def.title,
        readOnlyHint: def.readOnly,
        destructiveHint: def.destructive === true,
        idempotentHint: def.readOnly,
        openWorldHint: false,
      });
    }
  });
});

describe('tools/call', () => {
  it('inoltra nome e argomenti a callTool e restituisce il testo', async () => {
    const { handle, callTool } = setup();
    const res = await handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'read_map', arguments: { depth: 1 } },
    });
    expect(callTool).toHaveBeenCalledWith('read_map', { depth: 1 });
    expect(resultOf(res)).toEqual({
      content: [{ type: 'text', text: 'read_map:{"depth":1}' }],
      isError: false,
    });
  });

  it('senza arguments passa un oggetto vuoto', async () => {
    const { handle, callTool } = setup();
    await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_markers' } });
    expect(callTool).toHaveBeenCalledWith('list_markers', {});
  });

  it('un\'eccezione di callTool diventa un risultato con isError', async () => {
    const { handle, callTool } = setup();
    callTool.mockRejectedValueOnce(new Error('Nessuna mappa aperta in questa finestra.'));
    const res = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'read_map' } });
    expect(res?.error).toBeUndefined();
    expect(resultOf(res)).toEqual({
      content: [{ type: 'text', text: 'Nessuna mappa aperta in questa finestra.' }],
      isError: true,
    });
  });

  it('un esito con isError dal callTool resta un errore dello strumento', async () => {
    const { handle, callTool } = setup();
    callTool.mockResolvedValueOnce({ text: 'Blocco non trovato', isError: true });
    const res = await handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_topic', arguments: { topicId: 'x' } } });
    expect(resultOf(res)).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Blocco non trovato' }] });
  });

  it('uno strumento sconosciuto è un errore di protocollo -32602', async () => {
    const { handle, callTool } = setup();
    const res = await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'non_esiste' } });
    expect(res?.error?.code).toBe(-32602);
    expect(res?.result).toBeUndefined();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('senza nome dello strumento è un errore -32602', async () => {
    const { handle, callTool } = setup();
    const res = await handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: {} });
    expect(res?.error?.code).toBe(-32602);
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe('errori di protocollo', () => {
  it('un metodo sconosciuto è -32601', async () => {
    const { handle } = setup();
    const res = await handle({ jsonrpc: '2.0', id: 11, method: 'resources/list' });
    expect(res?.id).toBe(11);
    expect(res?.error?.code).toBe(-32601);
  });

  it('un messaggio non valido è -32600', async () => {
    const { handle } = setup();
    expect((await handle({ jsonrpc: '1.0', id: 12, method: 'ping' }))?.error?.code).toBe(-32600);
    expect((await handle('stringa'))?.error?.code).toBe(-32600);
    expect((await handle([1, 2]))?.error?.code).toBe(-32600);
    const noMethod = await handle({ jsonrpc: '2.0', id: 13 });
    expect(noMethod?.id).toBe(13);
    expect(noMethod?.error?.code).toBe(-32600);
  });

  it('una risposta del client non riceve risposta', async () => {
    const { handle } = setup();
    expect(await handle({ jsonrpc: '2.0', id: 14, result: {} })).toBeNull();
  });
});
