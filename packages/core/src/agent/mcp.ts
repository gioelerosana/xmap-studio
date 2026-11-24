/**
 * Protocollo MCP (Model Context Protocol) per gli strumenti di `tools.ts`: riceve
 * un messaggio JSON-RPC già letto e restituisce la risposta, o `null` per le
 * notifiche. Il trasporto (stdio, una riga JSON per messaggio) e l'esecuzione
 * degli strumenti sono di chi lo usa: qui non c'è I/O.
 */
import { AGENT_TOOLS } from './tools.js';

/** Versioni del protocollo supportate, dalla più recente. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface McpToolOutcome {
  text: string;
  isError?: boolean;
}

export interface McpServerOptions {
  name: string;
  version: string;
  /** Esegue uno strumento; un'eccezione diventa un risultato con `isError`. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolOutcome>;
}

type JsonRpcId = string | number;

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;

const INSTRUCTIONS =
  'Questi strumenti lavorano sulla mappa mentale aperta in questo momento in XMap Studio, accanto all\'utente. ' +
  'Leggi prima la mappa con read_map: dà gli id dei blocchi e la selezione dell\'utente. ' +
  'Ogni modifica compare subito nell\'app e si annulla con Ctrl+Z; niente viene scritto su disco finché non si salva ' +
  '(save_map, solo se l\'utente lo chiede). Scrivi i contenuti nella lingua della mappa.';

/** Definizioni degli strumenti nel formato di `tools/list`. */
export function mcpToolList(): unknown[] {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.destructive === true,
      idempotentHint: tool.readOnly,
      openWorldHint: false,
    },
  }));
}

export function createMcpServer(options: McpServerOptions): (message: unknown) => Promise<JsonRpcResponse | null> {
  return async (message: unknown) => {
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // Una risposta del client (es. a una nostra richiesta) non ha `method`: non c'è niente da rispondere.
      if (isRecord(message) && message.method === undefined && ('result' in message || 'error' in message)) return null;
      return errorResponse(idOf(message), JSONRPC_INVALID_REQUEST, 'Richiesta JSON-RPC non valida.');
    }
    const id = idOf(message);
    // Senza id è una notifica (es. notifications/initialized): non si risponde.
    if (id === null) return null;
    const params = isRecord(message.params) ? message.params : {};

    switch (message.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : MCP_PROTOCOL_VERSIONS[0];
        return result(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name, title: 'XMap Studio', version: options.version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: mcpToolList() });
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string' || !AGENT_TOOLS.some((tool) => tool.name === name)) {
          return errorResponse(id, JSONRPC_INVALID_PARAMS, `Strumento sconosciuto: ${String(name)}`);
        }
        const args = isRecord(params.arguments) ? params.arguments : {};
        let outcome: McpToolOutcome;
        try {
          outcome = await options.callTool(name, args);
        } catch (err: unknown) {
          outcome = { text: err instanceof Error ? err.message : String(err), isError: true };
        }
        return result(id, { content: [{ type: 'text', text: outcome.text }], isError: outcome.isError === true });
      }
      default:
        return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Metodo non supportato: ${message.method}`);
    }
  };
}

export function errorResponse(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
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
