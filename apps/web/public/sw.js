// Service worker per l'uso offline della PWA. Nessun dato dell'utente passa da
// qui: i file .xmind restano locali e le richieste a Nextcloud (`/nc/`) vanno
// sempre in rete.
//
// All'installazione mette in cache l'intera build (elenco iniettato da
// `vite build`, vedi `precacheManifest` in vite.config.ts): così l'app parte
// offline anche se è stata aperta una sola volta. Prima i bundle JS/CSS finivano
// in cache solo se richiesti a SW già attivo, cosa che sulla PWA di iPadOS (che
// ha storage separato da Safari) al primo avvio non succede.
const VERSION = '__XMAP_BUILD__';
const PRECACHE = /** @type {string[]} */ (__XMAP_PRECACHE__);
const CACHE = `xmap-studio-${VERSION}`;
// Oltre questo tempo una navigazione ripiega sulla copia in cache: su iPad, con
// Wi-Fi senza Internet, `fetch` può restare appeso invece di fallire subito.
const NAVIGATION_TIMEOUT_MS = 3000;

const scoped = (path) => new URL(path, self.registration.scope).href;
const SHELL = scoped('./');
// «Condividi» verso la PWA (`share_target` nel manifest): i file finiscono in
// questa cache e l'app li legge e la svuota (`src/app/incomingFiles.ts`).
const SHARE_TARGET = scoped('./share-target');
const SHARE_INBOX = 'xmap-share-inbox';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload`: niente risposte vecchie dalla cache HTTP del browser.
      .then((cache) => cache.addAll([SHELL, ...PRECACHE.map(scoped)].map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('xmap-studio-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function put(request, response) {
  if (!response.ok || response.type !== 'basic') return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

// Navigazioni: rete prima (per vedere subito una nuova versione), con timeout,
// poi la shell in cache.
async function handleNavigation(event) {
  const network = fetch(event.request);
  try {
    const response = await withTimeout(network, NAVIGATION_TIMEOUT_MS);
    if (response.ok && !response.redirected) {
      event.waitUntil(put(SHELL, response.clone()));
      return response;
    }
  } catch {
    // offline o rete appesa: si ripiega sulla cache
  }
  const cached = (await caches.match(SHELL)) || (await caches.match(event.request, { ignoreSearch: true }));
  return cached || network;
}

// Resto (bundle con hash, icone, demo): cache prima, rete come ripiego.
async function handleAsset(event) {
  const cached = await caches.match(event.request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(event.request);
  event.waitUntil(put(event.request, response.clone()));
  return response;
}

// I file condivisi restano nel dispositivo: dal POST alla cache, poi all'app.
async function handleShareTarget(event) {
  try {
    const form = await event.request.formData();
    const files = form.getAll('file').filter((entry) => typeof entry !== 'string');
    const cache = await caches.open(SHARE_INBOX);
    // Una condivisione sostituisce gli eventuali file non ancora letti.
    await Promise.all((await cache.keys()).map((key) => cache.delete(key)));
    await Promise.all(
      files.map((file, i) =>
        cache.put(
          scoped(`./__share-inbox/${Date.now()}-${i}`),
          new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'X-File-Name': encodeURIComponent(file.name || 'Mappa condivisa.xmind'),
            },
          })
        )
      )
    );
  } catch (err) {
    console.warn('Condivisione non ricevuta:', err);
  }
  return Response.redirect(scoped('./?shared=1'), 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'POST' && request.url === SHARE_TARGET) {
    event.respondWith(handleShareTarget(event));
    return;
  }
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Proxy Nextcloud: file dell'utente, mai in cache.
  if (url.pathname.startsWith('/nc/')) return;
  event.respondWith(request.mode === 'navigate' ? handleNavigation(event) : handleAsset(event));
});
