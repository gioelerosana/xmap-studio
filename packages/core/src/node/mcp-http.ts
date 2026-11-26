/**
 * Trasporto "Streamable HTTP" del Model Context Protocol, senza stato e senza
 * autenticazione: il server ascolta solo su 127.0.0.1 e lo usa il client di
 * Claude installato sulla stessa macchina. Ogni POST porta un messaggio JSON-RPC
 * (o un array, ammesso dalla revisione 2025-03-26) e riceve la risposta come
 * `application/json`; niente SSE, niente sessioni (`Mcp-Session-Id`), niente
 * stream avviato dal server (GET risponde 405, come prevede la specifica).
 *
 * Chi lo usa fornisce `handle` (di solito `createMcpServer` di `agent/mcp.ts`):
 * qui ci sono solo trasporto e controlli.
 *
 * Difese, al posto dell'autenticazione: indirizzo di loopback; header Host di
 * loopback (contro il DNS rebinding); header Origin, se presente, di loopback
 * (la specifica impone 403 se non è valida); `Content-Type: application/json`
 * obbligatorio e nessun header CORS, così una pagina web non riesce né a
 * spedire una richiesta "semplice" né a leggere la risposta; limite al corpo.
 */
import * as http from 'node:http';
import { MCP_PROTOCOL_VERSIONS, JSONRPC_PARSE_ERROR, errorResponse, type JsonRpcResponse } from '../agent/mcp.js';

export const MCP_HTTP_HOST = '127.0.0.1';
/** Porta predefinita del server MCP dell'app desktop (quella di Hermes è 47615). */
export const MCP_HTTP_PORT = 47616;
export const MCP_HTTP_PATH = '/mcp';

export interface McpHttpServerOptions {
  /** Porta su 127.0.0.1; 0 sceglie una porta libera (test). */
  port: number;
  /** Elabora un messaggio JSON-RPC già letto; `null` per notifiche e risposte. */
  handle: (message: unknown) => Promise<JsonRpcResponse | null>;
  /** Dimensione massima del corpo di una richiesta, in byte. */
  maxBodyBytes?: number;
  log?: (level: 'info' | 'warn', message: string) => void;
}

export interface McpHttpServer {
  readonly port: number;
  /** Indirizzo da dare al client di Claude, es. `http://127.0.0.1:47616/mcp`. */
  readonly url: string;
  /** Smette di ascoltare e chiude le connessioni aperte. */
  close(): Promise<void>;
}

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Tempo per ricevere header e corpo; l'esecuzione degli strumenti ha i suoi tempi. */
const RECEIVE_TIMEOUT_MS = 30_000;
const JSONRPC_INVALID_REQUEST = -32600;

class HttpRefusal extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function startMcpHttpServer(options: McpHttpServerOptions): Promise<McpHttpServer> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const log = options.log ?? (() => undefined);
  let port = options.port;

  const server = http.createServer((req, res) => {
    handleRequest(req, res, port, maxBodyBytes, options.handle).catch((error: unknown) => {
      const status = error instanceof HttpRefusal ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500 || status === 403) log('warn', `Server MCP: richiesta rifiutata (${status}): ${message}`);
      sendText(res, status, message);
    });
  });
  server.headersTimeout = RECEIVE_TIMEOUT_MS;
  server.requestTimeout = RECEIVE_TIMEOUT_MS;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, MCP_HTTP_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : options.port;
  const url = `http://${MCP_HTTP_HOST}:${port}${MCP_HTTP_PATH}`;
  log('info', `Server MCP in ascolto su ${url}`);

  return {
    port,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number,
  maxBodyBytes: number,
  handle: McpHttpServerOptions['handle']
): Promise<void> {
  checkOrigin(req, port);
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname !== MCP_HTTP_PATH) throw new HttpRefusal(404, `Percorso sconosciuto: il server MCP è su ${MCP_HTTP_PATH}.`);
  if (req.method !== 'POST') {
    // GET (stream avviato dal server) e DELETE (fine sessione) non servono: il server è senza stato.
    res.setHeader('Allow', 'POST');
    throw new HttpRefusal(405, 'Il server MCP accetta solo POST.');
  }
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpRefusal(415, 'Serve Content-Type: application/json.');
  const version = req.headers['mcp-protocol-version'];
  if (typeof version === 'string' && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    throw new HttpRefusal(400, `Versione del protocollo MCP non supportata: ${version}.`);
  }

  const body = await readBody(req, maxBodyBytes);
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    sendJson(res, 400, errorResponse(null, JSONRPC_PARSE_ERROR, 'JSON non valido.'));
    return;
  }

  if (Array.isArray(message)) {
    // JSON-RPC 2.0: un array vuoto non è un batch valido.
    if (message.length === 0) {
      sendJson(res, 400, errorResponse(null, JSONRPC_INVALID_REQUEST, 'Batch JSON-RPC vuoto.'));
      return;
    }
    const responses = (await Promise.all(message.map((item) => handle(item)))).filter(
      (response): response is JsonRpcResponse => response !== null
    );
    if (responses.length === 0) sendAccepted(res);
    else sendJson(res, 200, responses);
    return;
  }
  const response = await handle(message);
  if (response === null) sendAccepted(res);
  else sendJson(res, 200, response);
}

/** Host e Origin di loopback: un sito web non può parlare col server nemmeno con il DNS rebinding. */
function checkOrigin(req: http.IncomingMessage, port: number): void {
  const remote = req.socket.remoteAddress ?? '';
  if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1' && remote !== '::1') {
    throw new HttpRefusal(403, `Indirizzo non locale (${remote}).`);
  }
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    throw new HttpRefusal(403, `Host non ammesso (${host}).`);
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !isLoopbackOrigin(origin)) {
    throw new HttpRefusal(403, `Origin non ammessa (${origin}).`);
  }
}

function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(new HttpRefusal(413, 'Richiesta troppo grande.'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(new HttpRefusal(413, 'Richiesta troppo grande.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendAccepted(res: http.ServerResponse): void {
  res.writeHead(202).end();
}

function sendText(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Dopo un rifiuto il resto del corpo non si legge: si chiude la connessione.
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
  res.end(`${message}\n`);
}
