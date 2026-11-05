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
  { pattern: /^index\.php\/login\/v2$/, methods: ['POST'] },
  { pattern: /^index\.php\/login\/v2\/poll$/, methods: ['POST'] },
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

/**
 * Verifica l'URL base del server (intestazione `X-Nextcloud-Server`).
 * Restituisce l'URL senza `/` finale, o un messaggio d'errore in italiano.
 */
export function checkProxyServer(server: string | null): { ok: true; base: string } | { ok: false; message: string } {
  void server;
  throw new Error('non implementato');
}

/**
 * Verifica percorso (relativo al server, ancora codificato) e metodo.
 * Rifiuta segmenti `.`/`..` (anche codificati), `\`, caratteri di controllo
 * e tutto ciò che non è in `ALLOWED_ROUTES`.
 */
export function checkProxyPath(path: string, method: string): { ok: true } | { ok: false; status: 403 | 405; message: string } {
  void path;
  void method;
  throw new Error('non implementato');
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
  void request;
  void options;
  throw new Error('non implementato');
}
