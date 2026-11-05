import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { NEXTCLOUD_PROXY_PREFIX, handleNextcloudProxy } from '../../packages/core/src/cloud/proxy.js';

// Inietta in dist/sw.js l'elenco completo dei file della build e un'impronta
// del loro contenuto: il service worker li mette tutti in cache
// all'installazione (uso offline) e cambia a ogni build, così il browser
// installa la versione nuova.
function precacheManifest(): Plugin {
  let outDir = '';
  let written = false;
  return {
    name: 'xmap-precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      written = true;
    },
    closeBundle() {
      // Se la build è fallita non c'è nulla da elencare: l'errore vero lo riporta Vite.
      if (!written) return;
      const swPath = path.join(outDir, 'sw.js');
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        // `_headers` serve solo a Cloudflare e non viene servito: in `addAll` farebbe fallire l'installazione.
        .filter((file) => file !== 'sw.js' && file !== '_headers' && !file.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(readFileSync(path.join(outDir, file)));
      const sw = readFileSync(swPath, 'utf8')
        .replace('__XMAP_BUILD__', hash.digest('hex').slice(0, 12))
        .replace('__XMAP_PRECACHE__', JSON.stringify(files));
      writeFileSync(swPath, sw);
    },
  };
}

// In sviluppo `/sw.js` è un service worker che si autodistrugge. Un dispositivo che ha
// installato la PWA da `serve:tailnet` tiene il service worker di produzione, che mette in
// cache anche i moduli del server di sviluppo e li serve vecchi per sempre (né si aggiorna:
// il `sw.js` di `public/` senza segnaposto sostituiti non è valido). Questo lo sostituisce,
// svuota le cache dell'app, si deregistra e ricarica le schede aperte.
const SELF_DESTROYING_SW = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('xmap-studio-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});
`;

function devServiceWorkerReset(): Plugin {
  return {
    name: 'xmap-dev-sw-reset',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(SELF_DESTROYING_SW);
      });
    },
  };
}

// Proxy verso Nextcloud anche in sviluppo e in `vite preview` (serve:tailnet):
// stesso codice del Worker di produzione (worker/index.ts).
async function proxyToNextcloud(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? 'localhost';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const request = new Request(`http://${host}${req.url ?? '/'}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    // Richiesto da Node per i corpi in streaming.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
  const response = await handleNextcloudProxy(request);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(res);
}

function nextcloudProxy(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    if (!req.url?.startsWith(NEXTCLOUD_PROXY_PREFIX)) return next();
    proxyToNextcloud(req, res).catch(next);
  };
  return {
    name: 'xmap-nextcloud-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// Versione dell'app (vYY.MAJOR.MINOR, docs/RELEASE.md): la scrive il workflow di
// release nei package.json, qui si legge per mostrarla nella UI.
const appVersion: string = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  // Percorsi relativi: in Electron la UI compilata si carica da file://.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss(), precacheManifest(), devServiceWorkerReset(), nextcloudProxy()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@xmap/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@xmap/ui-kit/theme.css': path.resolve(import.meta.dirname, '../../packages/ui-kit/src/theme.css'),
      '@xmap/ui-kit': path.resolve(import.meta.dirname, '../../packages/ui-kit/src/index.ts'),
      '@resvg/resvg-js': path.resolve(import.meta.dirname, './src/shims/resvg.ts'),
    },
  },
  build: {
    // L'unico chunk oltre i 500 kB è `mathjax-engine`, caricato su richiesta (latex/mathjax.ts):
    // non pesa sull'avvio, l'avviso sarebbe solo rumore.
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // React cambia di rado: in un chunk suo resta nella cache HTTP tra una release e l'altra.
          groups: [{ name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: true,
    // Test da altri dispositivi via Tailscale (tailscale serve).
    allowedHosts: ['.ts.net'],
  },
  // Build di produzione servita per i test su dispositivo (PWA, service worker).
  preview: {
    port: 60417,
    host: true,
    allowedHosts: ['.ts.net'],
  },
});
