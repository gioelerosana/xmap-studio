/**
 * Client Nextcloud (Login Flow v2 + WebDAV) usato dalla web app.
 *
 * Nextcloud non invia intestazioni CORS: il browser non può chiamarlo
 * direttamente. Ogni richiesta passa quindi dal proxy dello stesso sito
 * (`proxy.ts`, servito dal Worker Cloudflare e dal server di sviluppo):
 * l'URL è `<proxyBase><percorso relativo al server>` e il server di
 * destinazione viaggia nell'intestazione `X-Nextcloud-Server`.
 *
 * Il modulo usa solo `fetch` (iniettato): niente DOM, niente Node.
 */

/** Intestazione con l'URL base del server Nextcloud (es. `https://cloud.example.com/nextcloud`). */
export const NEXTCLOUD_SERVER_HEADER = 'X-Nextcloud-Server';

/** Credenziali ottenute dal Login Flow v2: una app password dedicata, revocabile. */
export interface NextcloudAccount {
  /** URL base normalizzato (vedi `normalizeServerUrl`). */
  server: string;
  loginName: string;
  appPassword: string;
  /** Id dell'utente (può differire da `loginName`, es. login con email): compone i percorsi WebDAV. */
  userId: string;
  /** Nome da mostrare, se Nextcloud lo fornisce. */
  displayName?: string;
}

/** Voce di una cartella. `path` è relativo alla home dell'utente, comincia con `/`, NON è codificato. */
export interface NextcloudEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  /** Data di modifica in ISO 8601. */
  lastModified?: string;
  /** ETag così come lo restituisce il server (virgolette comprese). */
  etag?: string;
}

export interface NextcloudTransport {
  fetch: typeof fetch;
  /** Prefisso del proxy, con `/` finale: `/nc/` nell'app, un URL assoluto nei test. */
  proxyBase: string;
}

/** Login avviato: l'utente apre `loginUrl`, l'app interroga `poll` finché non riceve le credenziali. */
export interface LoginFlow {
  loginUrl: string;
  pollToken: string;
  /** Percorso relativo al server dell'endpoint di poll: `index.php/login/v2/poll`, o `login/v2/poll` con gli URL "belli". */
  pollPath: string;
}

export type NextcloudErrorCode = 'auth' | 'conflict' | 'not_found' | 'network' | 'server' | 'proxy' | 'invalid';

/** Errore con codice stabile e messaggio in italiano, pronto per la UI. */
export class NextcloudError extends Error {
  readonly code: NextcloudErrorCode;
  readonly status?: number;
  constructor(code: NextcloudErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'NextcloudError';
    this.code = code;
    this.status = status;
  }
}

const SERVER_PATH_MARKERS = ['apps', 'ocs', 'remote.php'];

/**
 * Normalizza l'indirizzo digitato dall'utente: aggiunge `https://` se manca,
 * toglie spazi, `/` finali, query, frammento e un eventuale `/index.php…` o
 * `/apps/…` copiato dalla barra degli indirizzi. Rifiuta (`NextcloudError`
 * `invalid`) schemi diversi da https, credenziali nell'URL e indirizzi vuoti.
 * Esempio: `cloud.example.com/nextcloud/index.php/apps/files` →
 * `https://cloud.example.com/nextcloud`.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new NextcloudError('invalid', "Inserisci l'indirizzo del server Nextcloud.");
  }
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new NextcloudError('invalid', "Indirizzo del server non valido: controlla di averlo copiato correttamente.");
  }
  if (url.protocol !== 'https:') {
    throw new NextcloudError('invalid', "L'indirizzo deve usare https://.");
  }
  if (url.username !== '' || url.password !== '') {
    throw new NextcloudError('invalid', "Non inserire nome utente o password nell'indirizzo del server.");
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const markerIndex = segments.findIndex(
    (segment) => SERVER_PATH_MARKERS.includes(segment) || segment.startsWith('index.php')
  );
  const base = markerIndex === -1 ? segments : segments.slice(0, markerIndex);
  return base.length === 0 ? url.origin : `${url.origin}/${base.join('/')}`;
}

/** Avvia il Login Flow v2 (`POST index.php/login/v2`). */
export async function startLoginFlow(server: string, transport: NextcloudTransport): Promise<LoginFlow> {
  const base = normalizeServerUrl(server);
  const response = await send(transport, base, 'index.php/login/v2', { method: 'POST' });
  if (!response.ok) throw await failureOf(response);
  const body = await readJson(response);
  const poll = field(body, 'poll');
  const loginUrl = stringField(body, 'login');
  const pollToken = stringField(poll, 'token');
  const endpoint = stringField(poll, 'endpoint');
  if (loginUrl === undefined || pollToken === undefined || endpoint === undefined) throw invalidResponse();
  if (!endpoint.startsWith(`${base}/`)) {
    throw new NextcloudError('server', 'Nextcloud ha indicato un indirizzo di accesso fuori dal server configurato.');
  }
  return { loginUrl, pollToken, pollPath: endpoint.slice(base.length + 1) };
}

/**
 * Un tentativo di poll (`POST <pollPath>` con `token=<pollToken>`, form-urlencoded).
 * `null` finché l'utente non ha autorizzato (il server risponde 404). Con le
 * credenziali ricava anche `userId`/`displayName` da `ocs/v2.php/cloud/user`.
 */
export async function pollLoginFlow(
  server: string,
  flow: LoginFlow,
  transport: NextcloudTransport
): Promise<NextcloudAccount | null> {
  const base = normalizeServerUrl(server);
  const response = await send(transport, base, flow.pollPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(flow.pollToken)}`,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await failureOf(response);
  const body = await readJson(response);
  const loginName = stringField(body, 'loginName');
  const appPassword = stringField(body, 'appPassword');
  if (loginName === undefined || appPassword === undefined) throw invalidResponse();
  const user = await fetchCurrentUser(transport, base, { loginName, appPassword });
  return {
    server: base,
    loginName,
    appPassword,
    userId: user.userId,
    ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
  };
}

/**
 * Estrae le voci da una risposta `207 Multi-Status` di PROPFIND.
 * `davRoot` è il percorso (non codificato) della home WebDAV dell'utente,
 * `/remote.php/dav/files/<userId>`, eventualmente preceduto dal sottopercorso
 * del server: gli `href` vengono decodificati e resi relativi a questa radice.
 * Prefissi di namespace qualsiasi (`d:`, `D:`, nessuno).
 */
export function parseMultistatus(xml: string, davRoot: string): NextcloudEntry[] {
  const root = davRoot.replace(/\/+$/, '');
  const entries: NextcloudEntry[] = [];
  for (const response of elementBodies(xml, 'response')) {
    const href = elementText(response, 'href');
    if (href === undefined) continue;
    const path = hrefToPath(href, root);
    const props = successfulProps(response);
    if (path === null || props === null) continue;
    entries.push(entryFrom(path, props));
  }
  return entries;
}

export class NextcloudClient {
  constructor(
    readonly account: NextcloudAccount,
    private readonly transport: NextcloudTransport
  ) {}

  /** Contenuto di una cartella (PROPFIND Depth 1), senza la cartella stessa: cartelle prima, poi file, per nome. */
  async list(dir: string): Promise<NextcloudEntry[]> {
    const folder = `/${dir.replace(/^\/+|\/+$/g, '')}`;
    const response = await this.dav(folder === '/' ? '/' : `${folder}/`, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (response.status !== 207) throw response.ok ? invalidResponse() : await failureOf(response);
    const entries = parseMultistatus(await response.text(), davRootOf(this.account));
    return entries.filter((entry) => entry.path !== folder).sort(compareEntries);
  }

  /** Scarica un file. `etag` serve per il salvataggio con `If-Match`. */
  async download(path: string): Promise<{ bytes: Uint8Array; etag: string | null }> {
    const response = await this.dav(path, { method: 'GET' });
    if (!response.ok) throw await failureOf(response);
    return { bytes: new Uint8Array(await response.arrayBuffer()), etag: etagOf(response) };
  }

  /**
   * Scrive un file con PUT. `ifMatch`: sovrascrive solo se l'ETag è ancora
   * quello (altrimenti `conflict`); `createOnly`: `If-None-Match: *`, fallisce
   * con `conflict` se il file esiste già. Restituisce il nuovo ETag
   * (`OC-ETag` o `ETag` della risposta), se presente.
   */
  async upload(
    path: string,
    bytes: Uint8Array,
    options?: { ifMatch?: string; createOnly?: boolean }
  ): Promise<{ etag: string | null }> {
    const createOnly = options?.createOnly === true;
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (options?.ifMatch !== undefined) headers['If-Match'] = options.ifMatch;
    if (createOnly) headers['If-None-Match'] = '*';
    const response = await this.dav(path, { method: 'PUT', headers, body: bytes.slice() });
    if (!UPLOAD_OK_STATUSES.includes(response.status)) throw await failureOf(response, createOnly);
    return { etag: etagOf(response) };
  }

  /** Revoca l'app password (`DELETE ocs/v2.php/core/apppassword`): da chiamare allo scollegamento. */
  async revokeAppPassword(): Promise<void> {
    const response = await this.ocs('ocs/v2.php/core/apppassword', { method: 'DELETE' });
    // 401: la password era già stata revocata.
    if (response.ok || response.status === 401) return;
    throw await failureOf(response);
  }

  private dav(path: string, options: RequestOptions): Promise<Response> {
    const relativePath = `remote.php/dav/files/${encodeURIComponent(this.account.userId)}${encodeDavPath(path)}`;
    return send(this.transport, this.account.server, relativePath, { ...options, auth: this.account });
  }

  private ocs(relativePath: string, options: RequestOptions): Promise<Response> {
    return send(this.transport, this.account.server, relativePath, { ...options, auth: this.account });
  }
}

interface RequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  auth?: Pick<NextcloudAccount, 'loginName' | 'appPassword'>;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getlastmodified/>
    <d:getetag/>
    <d:getcontentlength/>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

const UPLOAD_OK_STATUSES: readonly number[] = [200, 201, 204];

const PROXY_ERROR_STATUSES: readonly number[] = [400, 403, 405, 413, 502];

const CONFLICT_MESSAGE =
  "Il file su Nextcloud è stato modificato da quando l'hai aperto. Salvalo con un altro nome o riaprilo.";
const CREATE_CONFLICT_MESSAGE = 'Esiste già un file con questo nome.';
const AUTH_MESSAGE = "Accesso a Nextcloud negato: ricollega l'account dalle impostazioni.";
const NOT_FOUND_MESSAGE = 'File o cartella non trovati su Nextcloud.';
const NETWORK_MESSAGE = 'Nextcloud non raggiungibile: controlla la connessione.';

/** Namespace opzionale (`d:`, `D:`, nessuno) prima del nome di un elemento XML. */
const XML_NS = '(?:[A-Za-z_][\\w.-]*:)?';
const COLLECTION_ELEMENT = /<(?:[A-Za-z_][\w.-]*:)?collection(?=[\s/>])/;
const SUCCESS_STATUS_LINE = /^HTTP\/\S+\s+200(\s|$)/;
const XML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** Invia una richiesta al proxy, con l'intestazione del server e, se presenti, le credenziali. */
async function send(
  transport: NextcloudTransport,
  server: string,
  relativePath: string,
  options: RequestOptions
): Promise<Response> {
  const headers: Record<string, string> = {
    [NEXTCLOUD_SERVER_HEADER]: server,
    'OCS-APIRequest': 'true',
    ...options.headers,
  };
  if (options.auth !== undefined) {
    headers.Authorization = basicAuth(options.auth.loginName, options.auth.appPassword);
  }
  try {
    return await transport.fetch(transport.proxyBase + relativePath, {
      method: options.method,
      headers,
      body: options.body,
    });
  } catch {
    throw new NextcloudError('network', NETWORK_MESSAGE);
  }
}

/** `Basic` su byte UTF-8: `btoa` accetta solo caratteri latin1. */
function basicAuth(loginName: string, appPassword: string): string {
  const bytes = new TextEncoder().encode(`${loginName}:${appPassword}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

async function fetchCurrentUser(
  transport: NextcloudTransport,
  server: string,
  credentials: Pick<NextcloudAccount, 'loginName' | 'appPassword'>
): Promise<{ userId: string; displayName?: string }> {
  const response = await send(transport, server, 'ocs/v2.php/cloud/user?format=json', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    auth: credentials,
  });
  if (!response.ok) throw await failureOf(response);
  const data = field(field(await readJson(response), 'ocs'), 'data');
  const userId = stringField(data, 'id');
  if (userId === undefined) throw invalidResponse();
  const displayName = stringField(data, 'displayname') ?? stringField(data, 'display-name');
  return displayName === undefined ? { userId } : { userId, displayName };
}

/** Traduce una risposta non riuscita in un `NextcloudError` con messaggio in italiano. */
async function failureOf(response: Response, createOnly = false): Promise<NextcloudError> {
  if (PROXY_ERROR_STATUSES.includes(response.status) && isJsonResponse(response)) {
    const proxyMessage = await readProxyError(response);
    if (proxyMessage !== null) return new NextcloudError('proxy', proxyMessage, response.status);
  }
  const { status } = response;
  if (status === 401 || status === 403) return new NextcloudError('auth', AUTH_MESSAGE, status);
  if (status === 404) return new NextcloudError('not_found', NOT_FOUND_MESSAGE, status);
  if (status === 412) {
    return new NextcloudError('conflict', createOnly ? CREATE_CONFLICT_MESSAGE : CONFLICT_MESSAGE, status);
  }
  return new NextcloudError('server', `Nextcloud ha risposto con un errore (HTTP ${status}).`, status);
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

async function readProxyError(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const message = field(parsed, 'error');
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw invalidResponse();
  }
}

function invalidResponse(): NextcloudError {
  return new NextcloudError('server', 'Risposta di Nextcloud non valida.');
}

/**
 * ETag pronto per `If-Match`: alcuni server (e proxy) lo restituiscono senza
 * virgolette, che `If-Match` invece richiede; senza, ogni salvataggio sarebbe
 * un falso conflitto.
 */
function etagOf(response: Response): string | null {
  const raw = (response.headers.get('OC-ETag') ?? response.headers.get('ETag'))?.trim();
  if (!raw) return null;
  return raw.startsWith('"') || raw.startsWith('W/') ? raw : `"${raw}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === 'string' && found !== '' ? found : undefined;
}

/** Percorso WebDAV con ogni segmento codificato e le `/` tra i segmenti lasciate intatte. */
function encodeDavPath(path: string): string {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return absolute
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Radice WebDAV dell'utente, decodificata come sono gli `href` restituiti dal server. */
function davRootOf(account: Pick<NextcloudAccount, 'server' | 'userId'>): string {
  const serverPath = new URL(account.server).pathname
    .split('/')
    .map(safeDecode)
    .join('/')
    .replace(/\/+$/, '');
  return `${serverPath}/remote.php/dav/files/${account.userId}`;
}

function compareEntries(a: NextcloudEntry, b: NextcloudEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
}

/** Contenuto di tutti gli elementi `<prefisso:name>…</prefisso:name>` (anche annidati nel testo). */
function elementBodies(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${XML_NS}${name}(?=[\\s/>])[^>]*>([\\s\\S]*?)</${XML_NS}${name}\\s*>`, 'g');
  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? '');
}

/** Testo del primo elemento con quel nome (vuoto se è autochiuso); `undefined` se assente. */
function elementText(xml: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<${XML_NS}${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</${XML_NS}${name}\\s*>)`
  );
  const match = pattern.exec(xml);
  if (match === null) return undefined;
  return unescapeXml(match[1] ?? '');
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x[\da-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole: string, body: string) => {
    if (body.startsWith('#x')) return codePointOr(parseInt(body.slice(2), 16), whole);
    if (body.startsWith('#')) return codePointOr(parseInt(body.slice(1), 10), whole);
    return XML_ENTITIES.get(body) ?? whole;
  });
}

function codePointOr(codePoint: number, fallback: string): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;
}

/**
 * Percorso relativo alla home di un `href`, o `null` se fuori dalla radice.
 * Accetta sia percorsi assoluti sia URL completi.
 */
function hrefToPath(href: string, root: string): string | null {
  let pathname: string;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(href)) {
    try {
      pathname = new URL(href).pathname;
    } catch {
      return null;
    }
  } else {
    pathname = href.split(/[?#]/)[0];
  }
  const decoded = pathname.split('/').map(safeDecode).join('/');
  let rest: string;
  if (decoded === root) rest = '';
  else if (decoded.startsWith(`${root}/`)) rest = decoded.slice(root.length);
  else return null;
  const trimmed = rest.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Proprietà dei `propstat` con stato 200, concatenate. Le proprietà con
 * stato diverso (es. 404 per una proprietà sconosciuta) vengono ignorate;
 * `null` se la risposta non ha alcun `propstat` riuscito.
 */
function successfulProps(response: string): string | null {
  const successful = elementBodies(response, 'propstat').filter((propstat) => {
    const status = elementText(propstat, 'status');
    return status !== undefined && SUCCESS_STATUS_LINE.test(status.trim());
  });
  if (successful.length === 0) return null;
  return successful.flatMap((propstat) => elementBodies(propstat, 'prop')).join('\n');
}

function entryFrom(path: string, props: string): NextcloudEntry {
  const entry: NextcloudEntry = {
    path,
    name: path.split('/').pop() || '/',
    isDirectory: COLLECTION_ELEMENT.test(elementText(props, 'resourcetype') ?? ''),
  };
  const size = elementText(props, 'getcontentlength')?.trim();
  if (size !== undefined && size !== '' && Number.isFinite(Number(size))) entry.size = Number(size);
  const modified = elementText(props, 'getlastmodified')?.trim();
  if (modified !== undefined && modified !== '') {
    const date = new Date(modified);
    if (!Number.isNaN(date.getTime())) entry.lastModified = date.toISOString();
  }
  const etag = elementText(props, 'getetag');
  if (etag !== undefined && etag !== '') entry.etag = etag;
  return entry;
}
