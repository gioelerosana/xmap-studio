import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Platform } from '../platform.js';
import { atomicWrite } from './atomic.js';
import { xmindProcesses } from './process.js';

export { atomicWrite } from './atomic.js';
export { xmindProcesses } from './process.js';
export { guardedSave } from './guarded-save.js';
export type { GuardedSaveDeps, GuardedSaveResult } from './guarded-save.js';

/** Implementazione di `Platform` per Node/Electron. */
export const nodePlatform: Platform = {
  readFile: async (filePath) => new Uint8Array(await fs.promises.readFile(filePath)),
  atomicWrite,
  xmindProcesses,
  resolvePath: (filePath) => path.resolve(filePath),
};
export { startAgentLinkServer, tokensMatch, AGENT_LINK_HOST, AGENT_LINK_PROTOCOL } from './agent-link.js';
export type { AgentLinkServer, AgentLinkServerOptions } from './agent-link.js';
export { startAgentSocketServer, agentSocketPath, AGENT_SOCKET_ENV, AGENT_SOCKET_PROTOCOL } from './agent-socket.js';
export type { AgentSocketServer, AgentSocketServerOptions } from './agent-socket.js';
export { runMcpBridge, checkSocketSecurity, BRIDGE_PROTOCOL_VERSIONS } from './mcp-bridge.js';
export type { McpBridgeOptions } from './mcp-bridge.js';

/** Sorgente compilato del ponte (`mcp-bridge.js`), da mettere nell'estensione `.mcpb`. */
export function mcpBridgeSource(): Promise<string> {
  return fs.promises.readFile(new URL('./mcp-bridge.js', import.meta.url), 'utf8');
}
