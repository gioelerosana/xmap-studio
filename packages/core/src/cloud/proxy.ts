/**
 * Proxy verso Nextcloud, servito sullo stesso sito della web app (Worker
 * Cloudflare in produzione, middleware Vite in sviluppo). Serve solo a
 * superare l'assenza di CORS in Nextcloud: non salva nulla, non registra
 * nulla, inoltra soltanto.
 *
 * Per non diventare un relay aperto inoltra SOLO:
 * - verso server `https://` con nome di dominio pubblico (niente IP, niente
 *   `localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`), porta qualsiasi;
 * - i percorsi e i metodi elencati in `ALLOWED_ROUTES`;
 * - le intestazioni in `FORWARDED_REQUEST_HEADERS` (niente cookie);
 * - senza seguire i redirect.
 *
 * Questo file non importa nulla: il Worker e `vite.config.ts` lo includono
 * direttamente per percorso.
 */

/** Prefisso delle richieste al proxy sul sito dell'app. */
export const NEXTCLOUD_PROXY_PREFIX = '/nc/';

/** Dimensione massima di una richiesta inoltrata (un file .xmind). */
export const NEXTCLOUD_PROXY_MAX_BODY = 64 * 1024 * 1024;

export interface ProxyRoute {
  /** Percorso relativo al server, senza `/` iniziale, confrontato sulla forma decodificata. */
  pattern: RegExp;
  methods: readonly string[];
}

export const ALLOWED_ROUTES: readonly ProxyRoute[] = [
  { pattern: /^status\.php$/, methods: ['GET'] },
  // Con gli URL "belli" Nextcloud indica il poll senza `index.php/` (`login/v2/poll`).
  { pattern: /^(index\.php\/)?login\/v2$/, methods: ['POST'] },
  { pattern: /^(index\.php\/)?login\/v2\/poll$/, methods: ['POST'] },
  { pattern: /^ocs\/v2\.php\/cloud\/user$/, methods: ['GET'] },
  { pattern: /^ocs\/v2\.php\/core\/apppassword$/, methods: ['DELETE'] },
  { pattern: /^remote\.php\/dav\/files\/[^/]+(\/.*)?$/, methods: ['GET', 'PUT', 'PROPFIND'] },
];

export const FORWARDED_REQUEST_HEADERS: readonly string[] = [
  'accept',
  'authorization',
  'content-type',
  'depth',
  'if-match',
  'if-none-match',
  'ocs-apirequest',
];

export const FORWARDED_RESPONSE_HEADERS: readonly string[] = [
  'content-type',
  'etag',
  'oc-etag',
  'oc-fileid',
  'last-modified',
];

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Verifica l'URL base del server (intestazione `X-Nextcloud-Server`).
 * Restituisce l'URL senza `/` finale, o un messaggio d'errore in italiano.
 */
export function checkProxyServer(server: string | null): { ok: true; base: string } | { ok: false; message: string } {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (server === null || server.trim() === '') {
    return fail("Manca l'indirizzo del server Nextcloud (intestazione X-Nextcloud-Server).");
  }
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    return fail("L'indirizzo del server Nextcloud non è valido.");
  }
  if (url.protocol !== 'https:') return fail('Il server Nextcloud deve essere raggiunto con https://.');
  if (url.username !== '' || url.password !== '') {
    return fail("L'indirizzo del server non può contenere nome utente o password.");
  }
  if (url.search !== '' || url.hash !== '') {
    return fail("L'indirizzo del server non può contenere query o frammento.");
  }
  const host = url.hostname.replace(/\.$/, '');
  const lastLabel = host.split('.').pop() ?? '';
  if (host.startsWith('[') || /^\d+$/.test(lastLabel)) {
    return fail('Il server Nextcloud deve avere un nome di dominio, non un indirizzo IP.');
  }
  if (!host.includes('.')) {
    return fail('Il server Nextcloud deve avere un nome di dominio pubblico (con un punto).');
  }
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return fail('Il server Nextcloud deve essere un dominio pubblico: i nomi locali non sono ammessi.');
  }
  return { ok: true, base: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

/**
 * Verifica percorso (relativo al server, ancora codificato) e metodo.
 * Rifiuta segmenti `.`/`..` (anche codificati), `\`, caratteri di controllo
 * e tutto ciò che non è in `ALLOWED_ROUTES`.
 */
export function checkProxyPath(path: string, method: string): { ok: true } | { ok: false; status: 403 | 405; message: string } {
  const invalid = { ok: false as const, status: 403 as const, message: 'Percorso non valido.' };
  const parts = path.split('/');
  const decoded: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    // Solo l'ultimo segmento può essere vuoto (PROPFIND su una cartella termina con `/`).
    if (part === '' && index < parts.length - 1) return invalid;
    let value: string;
    try {
      value = decodeURIComponent(part);
    } catch {
      return invalid;
    }
    if (value === '.' || value === '..' || /[\\/\x00-\x1f\x7f]/.test(value)) return invalid;
    decoded.push(value);
  }
  const joined = decoded.join('/');
  const upperMethod = method.toUpperCase();
  const matching = ALLOWED_ROUTES.filter((route) => route.pattern.test(joined));
  if (matching.length === 0) {
    return { ok: false, status: 403, message: 'Percorso non consentito dal proxy Nextcloud.' };
  }
  if (!matching.some((route) => route.methods.includes(upperMethod))) {
    return { ok: false, status: 405, message: 'Metodo non consentito per questo percorso.' };
  }
  return { ok: true };
}

/**
 * Gestisce una richiesta `<prefix><percorso>`; per richieste fuori dal
 * prefisso risponde 404. Errori del proxy: JSON `{ "error": "<messaggio>" }`
 * con 400/403/405/413/502, e `Cache-Control: no-store` su ogni risposta.
 * Un redirect del server diventa 502 con messaggio esplicito.
 */
export async function handleNextcloudProxy(
  request: Request,
  options?: { fetch?: typeof fetch; prefix?: string; userAgent?: string }
): Promise<Response> {
  const prefix = options?.prefix ?? NEXTCLOUD_PROXY_PREFIX;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) {
    return errorResponse(404, 'Percorso del proxy Nextcloud non trovato.');
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: NO_STORE });
  }

  // L'URL è già normalizzato (`..` e `%2e%2e` risolti): si controlla e si inoltra la stessa forma.
  const server = checkProxyServer(request.headers.get('x-nextcloud-server'));
  if (!server.ok) return errorResponse(400, server.message);

  const relativePath = url.pathname.slice(prefix.length);
  const route = checkProxyPath(relativePath, request.method);
  if (!route.ok) return errorResponse(route.status, route.message);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const declaredLength = request.headers.get('content-length');
  if (hasBody && declaredLength !== null && Number(declaredLength) > NEXTCLOUD_PROXY_MAX_BODY) {
    return tooLargeResponse();
  }
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await request.arrayBuffer();
    if (body.byteLength > NEXTCLOUD_PROXY_MAX_BODY) return tooLargeResponse();
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('User-Agent', options?.userAgent ?? 'XMap Studio');

  const target = `${server.base}/${relativePath}${url.search}`;
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  let upstream: Response;
  try {
    upstream = await fetchImpl(target, { method: request.method, headers, body, redirect: 'manual' });
  } catch {
    return errorResponse(502, 'Server Nextcloud non raggiungibile.');
  }

  if (upstream.type === 'opaqueredirect' || (upstream.status >= 300 && upstream.status < 400)) {
    await discardBody(upstream);
    return errorResponse(
      502,
      "Il server Nextcloud ha risposto con un reindirizzamento: controlla l'indirizzo (https, sottocartella)."
    );
  }

  const responseHeaders = new Headers(NO_STORE);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  const bodyless = upstream.status === 204 || upstream.status === 304;
  return new Response(bodyless ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE },
  });
}

function tooLargeResponse(): Response {
  const megabytes = NEXTCLOUD_PROXY_MAX_BODY / (1024 * 1024);
  return errorResponse(413, `Il file supera il limite di ${megabytes} MB per il proxy Nextcloud.`);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Il corpo di un redirect non serve: se la chiusura fallisce non cambia la risposta.
  }
}
