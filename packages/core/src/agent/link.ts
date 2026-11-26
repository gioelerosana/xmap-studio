/**
 * Protocollo del collegamento tra XMap Studio e chi esegue gli strumenti per
 * conto di un agente: il ponte MCP su socket locale (`node/agent-socket.ts`,
 * per Claude) e il plugin di Hermes Desktop (WebSocket su 127.0.0.1). I due trasporti portano le stesse
 * richieste; qui ci sono solo i tipi, la loro
 * validazione e il catalogo degli strumenti, senza I/O.
 */
import { MCP_INSTRUCTIONS, mcpToolList } from './mcp.js';

/** Richiesta all'app. `map` è l'id di finestra elencato da `list_maps`. */
export type AgentLinkRequest =
  | { id: number; op: 'maps' }
  | { id: number; op: 'catalog' }
  | { id: number; op: 'call'; map?: number; tool: string; args: Record<string, unknown> };

/** Risposta dell'app; `id: 0` risponde a una richiesta illeggibile. */
export type AgentLinkResponse =
  | { id: number; ok: true; text: string }
  | { id: number; ok: true; catalog: AgentCatalog }
  | { id: number; ok: false; error: string };

/** Strumenti offerti all'agente, con le istruzioni d'uso: chi li registra non ne tiene una copia. */
export interface AgentCatalog {
  name: string;
  instructions: string;
  /** Stesso formato di `tools/list` di MCP: `name`, `title`, `description`, `inputSchema`, `annotations`. */
  tools: unknown[];
}

export function agentCatalog(): AgentCatalog {
  return { name: 'xmap-studio', instructions: MCP_INSTRUCTIONS, tools: mcpToolList() };
}

/** Valida un messaggio già letto da JSON; lancia un `Error` con il motivo. */
export function parseAgentLinkRequest(value: unknown): AgentLinkRequest {
  if (!isRecord(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) {
    throw new Error('manca l\'id.');
  }
  if (value.op === 'maps') return { id: value.id, op: 'maps' };
  if (value.op === 'catalog') return { id: value.id, op: 'catalog' };
  if (value.op !== 'call' || typeof value.tool !== 'string') throw new Error('operazione sconosciuta.');
  const map = value.map;
  if (map !== undefined && (typeof map !== 'number' || !Number.isInteger(map))) throw new Error('map deve essere un intero.');
  return { id: value.id, op: 'call', map, tool: value.tool, args: isRecord(value.args) ? value.args : {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
