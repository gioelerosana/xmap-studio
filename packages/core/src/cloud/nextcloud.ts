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
  /** Percorso relativo al server dell'endpoint di poll (di norma `index.php/login/v2/poll`). */
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

/**
 * Normalizza l'indirizzo digitato dall'utente: aggiunge `https://` se manca,
 * toglie spazi, `/` finali, query, frammento e un eventuale `/index.php…` o
 * `/apps/…` copiato dalla barra degli indirizzi. Rifiuta (`NextcloudError`
 * `invalid`) schemi diversi da https, credenziali nell'URL e indirizzi vuoti.
 * Esempio: `cloud.example.com/nextcloud/index.php/apps/files` →
 * `https://cloud.example.com/nextcloud`.
 */
export function normalizeServerUrl(input: string): string {
  void input;
  throw new Error('non implementato');
}

/** Avvia il Login Flow v2 (`POST index.php/login/v2`). */
export async function startLoginFlow(server: string, transport: NextcloudTransport): Promise<LoginFlow> {
  void server;
  void transport;
  throw new Error('non implementato');
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
  void server;
  void flow;
  void transport;
  throw new Error('non implementato');
}

/**
 * Estrae le voci da una risposta `207 Multi-Status` di PROPFIND.
 * `davRoot` è il percorso (non codificato) della home WebDAV dell'utente,
 * `/remote.php/dav/files/<userId>`, eventualmente preceduto dal sottopercorso
 * del server: gli `href` vengono decodificati e resi relativi a questa radice.
 * Prefissi di namespace qualsiasi (`d:`, `D:`, nessuno).
 */
export function parseMultistatus(xml: string, davRoot: string): NextcloudEntry[] {
  void xml;
  void davRoot;
  throw new Error('non implementato');
}

export class NextcloudClient {
  constructor(
    readonly account: NextcloudAccount,
    private readonly transport: NextcloudTransport
  ) {}

  /** Contenuto di una cartella (PROPFIND Depth 1), senza la cartella stessa: cartelle prima, poi file, per nome. */
  async list(dir: string): Promise<NextcloudEntry[]> {
    void dir;
    void this.transport;
    throw new Error('non implementato');
  }

  /** Scarica un file. `etag` serve per il salvataggio con `If-Match`. */
  async download(path: string): Promise<{ bytes: Uint8Array; etag: string | null }> {
    void path;
    throw new Error('non implementato');
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
    void path;
    void bytes;
    void options;
    throw new Error('non implementato');
  }

  /** Revoca l'app password (`DELETE ocs/v2.php/core/apppassword`): da chiamare allo scollegamento. */
  async revokeAppPassword(): Promise<void> {
    throw new Error('non implementato');
  }
}
