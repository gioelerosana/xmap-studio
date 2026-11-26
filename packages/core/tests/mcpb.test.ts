import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { agentCatalog } from '../src/agent/link.js';
import { buildMcpbBundle, mcpbManifest } from '../src/agent/mcpb.js';

const TOKEN = 'chiave-di-prova-0123456789';
const SOCKET = '/run/user/1000/xmap-studio-1000/mcp.sock';
const BRIDGE_SOURCE = 'export const ponte = true;\n';
const ICON = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const BRIDGE_PATH = fileURLToPath(new URL('../src/node/mcp-bridge.ts', import.meta.url));

async function unzipBundle(bytes: Uint8Array) {
  return JSZip.loadAsync(bytes);
}

async function readText(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) throw new Error(`Manca ${name} nello zip.`);
  return file.async('string');
}

describe('buildMcpbBundle', () => {
  it('produce un manifest.json conforme al formato MCPB 0.3', async () => {
    const zip = await unzipBundle(
      await buildMcpbBundle({
        version: '26.6.1',
        bridgeSource: BRIDGE_SOURCE,
        socketPath: SOCKET,
        token: TOKEN,
        catalog: agentCatalog(),
        platform: 'linux',
        icon: ICON,
      })
    );
    const manifest = JSON.parse(await readText(zip, 'manifest.json')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      manifest_version: '0.3',
      name: 'xmap-studio',
      version: '26.6.1',
      icon: 'icon.png',
      server: {
        type: 'node',
        entry_point: 'server/index.mjs',
        mcp_config: { command: 'node', args: ['${__dirname}/server/index.mjs'] },
      },
      compatibility: { platforms: ['linux'] },
    });
    expect((manifest.compatibility as { platforms: string[] }).platforms).toEqual(['linux']);
    expect((manifest.tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(
      agentCatalog().tools.map((tool) => (tool as { name: string }).name)
    );
    expect(zip.file('icon.png')).not.toBeNull();
    expect(await zip.file('icon.png')?.async('uint8array')).toEqual(ICON);
  });

  it('copia il ponte così com\'è e scrive config.json con socket, chiave, versione e catalogo', async () => {
    const catalog = agentCatalog();
    const zip = await unzipBundle(
      await buildMcpbBundle({
        version: '26.6.1',
        bridgeSource: BRIDGE_SOURCE,
        socketPath: SOCKET,
        token: TOKEN,
        catalog,
        platform: 'darwin',
      })
    );
    expect(await readText(zip, 'server/mcp-bridge.mjs')).toBe(BRIDGE_SOURCE);
    const config = JSON.parse(await readText(zip, 'server/config.json')) as Record<string, unknown>;
    expect(config).toMatchObject({ socketPath: SOCKET, token: TOKEN, version: '26.6.1' });
    expect(config.catalog).toEqual(catalog);
    expect(zip.file('server/index.mjs')).not.toBeNull();
  });

  it('senza icona il manifest non ha la chiave icon e lo zip non ha icon.png', async () => {
    const zip = await unzipBundle(
      await buildMcpbBundle({
        version: '26.6.1',
        bridgeSource: BRIDGE_SOURCE,
        socketPath: SOCKET,
        token: TOKEN,
        catalog: agentCatalog(),
        platform: 'win32',
      })
    );
    const manifest = JSON.parse(await readText(zip, 'manifest.json')) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty('icon');
    expect(zip.file('icon.png')).toBeNull();
    expect((manifest.compatibility as { platforms: string[] }).platforms).toEqual(['win32']);
  });
});

describe('mcpbManifest', () => {
  it('senza icona non include la chiave icon', () => {
    const manifest = mcpbManifest({ version: '1.0.0', catalog: agentCatalog(), platform: 'linux' });
    expect(manifest).not.toHaveProperty('icon');
  });
});

describe('ponte autosufficiente', () => {
  it('ogni import di runtime di mcp-bridge.ts punta a un modulo node:', () => {
    const source = fs.readFileSync(BRIDGE_PATH, 'utf8');
    // Gli import di tipo (`import type`) spariscono in compilazione e sono esclusi.
    const specifiers = [...source.matchAll(/^import\s+(?!type\b)[\s\S]*?\sfrom\s+'([^']+)'/gm)].map((match) => match[1] ?? '');
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier.startsWith('node:')).toBe(true);
  });
});
