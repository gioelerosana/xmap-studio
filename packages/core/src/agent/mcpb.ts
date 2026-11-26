/**
 * Estensione di Claude Desktop (formato MCPB, `manifest_version` 0.3): uno zip
 * con `manifest.json` e il ponte di `node/mcp-bridge.ts`, che Claude avvia con il
 * suo Node incluso. L'app la genera al momento (Impostazioni › Integrazioni) con
 * dentro il percorso del socket e la chiave di accoppiamento, e la apre con
 * Claude Desktop, che chiede conferma all'utente. Qui niente I/O: i byte del
 * ponte e dell'icona li passa chi chiama.
 */
import { loadJSZip } from '../archive/zip.js';
import type { AgentCatalog } from './link.js';

export const MCPB_FILE_NAME = 'xmap-studio.mcpb';
const BRIDGE_FILE = 'server/mcp-bridge.mjs';
const ENTRY_FILE = 'server/index.mjs';
const CONFIG_FILE = 'server/config.json';

export type McpbPlatform = 'linux' | 'darwin' | 'win32';

export interface McpbBundleOptions {
  /** Versione dell'app (semver), anche versione dell'estensione. */
  version: string;
  /** JavaScript compilato di `node/mcp-bridge.ts` (modulo ES autosufficiente). */
  bridgeSource: string;
  socketPath: string;
  token: string;
  /** Strumenti mostrati da Claude ad app chiusa (`agentCatalog()`). */
  catalog: AgentCatalog;
  platform: McpbPlatform;
  /** PNG dell'icona, facoltativo. */
  icon?: Uint8Array;
}

/** Configurazione letta dal ponte dentro l'estensione. */
export interface McpbBridgeConfig {
  socketPath: string;
  token: string;
  version: string;
  catalog: AgentCatalog;
}

/** Avvio del ponte nell'estensione: legge `config.json` accanto a sé. */
const ENTRY_SOURCE = `import { readFileSync } from 'node:fs';
import { runMcpBridge } from './mcp-bridge.mjs';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
await runMcpBridge({
  socketPath: config.socketPath,
  token: () => config.token,
  catalog: config.catalog,
  version: config.version,
  input: process.stdin,
  output: process.stdout,
  log: (message) => process.stderr.write(\`[xmap-studio] \${message}\\n\`),
});
`;

export function mcpbManifest(options: Pick<McpbBundleOptions, 'version' | 'catalog' | 'platform' | 'icon'>): Record<string, unknown> {
  return {
    manifest_version: '0.3',
    name: 'xmap-studio',
    display_name: 'XMap Studio',
    version: options.version,
    description: 'Legge e modifica la mappa mentale aperta in XMap Studio, sul tuo computer.',
    long_description:
      'Collega Claude alle mappe aperte in XMap Studio: le modifiche compaiono subito nella finestra e si annullano con Ctrl+Z. ' +
      'Il collegamento resta su questo computer (socket locale con chiave di accoppiamento), senza porte di rete. ' +
      'XMap Studio deve essere aperto mentre Claude lavora sulla mappa.',
    author: { name: 'XMap Studio', url: 'https://github.com/gioelerosana/xmap-studio' },
    homepage: 'https://xmap-studio.jshep.xyz',
    repository: { type: 'git', url: 'https://github.com/gioelerosana/xmap-studio' },
    license: 'MIT',
    ...(options.icon ? { icon: 'icon.png' } : {}),
    server: {
      type: 'node',
      entry_point: ENTRY_FILE,
      mcp_config: { command: 'node', args: [`\${__dirname}/${ENTRY_FILE}`] },
    },
    tools: options.catalog.tools.flatMap((tool) =>
      isRecord(tool) && typeof tool.name === 'string'
        ? [{ name: tool.name, description: typeof tool.description === 'string' ? tool.description : '' }]
        : []
    ),
    keywords: ['mind map', 'mappe mentali', 'xmind', 'xmap'],
    compatibility: { platforms: [options.platform], runtimes: { node: '>=18.0.0' } },
  };
}

export async function buildMcpbBundle(options: McpbBundleOptions): Promise<Uint8Array> {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file('manifest.json', `${JSON.stringify(mcpbManifest(options), null, 2)}\n`);
  zip.file(BRIDGE_FILE, options.bridgeSource);
  zip.file(ENTRY_FILE, ENTRY_SOURCE);
  const config: McpbBridgeConfig = {
    socketPath: options.socketPath,
    token: options.token,
    version: options.version,
    catalog: options.catalog,
  };
  zip.file(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  if (options.icon) zip.file('icon.png', options.icon);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
