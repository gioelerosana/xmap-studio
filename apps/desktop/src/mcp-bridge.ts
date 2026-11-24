// Server MCP su stdio per Claude (Claude Desktop, Claude Code, …): lo avvia il
// client con `xmap-studio --mcp` (app installata) oppure `node apps/desktop/dist/mcp-bridge.js`
// (sviluppo). Parla MCP con il client e gira ogni chiamata all'app aperta, sul
// canale locale di `mcp-socket.ts`: è un ponte, non apre né scrive file.
// Su stdout passano solo messaggi del protocollo: i messaggi di diagnostica vanno su stderr.
import * as net from 'node:net';
import { HostRequest, HostResponse, lineReader, mcpSocketPath } from './mcp-socket.js';

/** Poco più del tempo che l'app concede a una chiamata, così l'errore preciso arriva dall'app. */
const HOST_TIMEOUT_MS = 130_000;
const MAX_LINE_CHARS = 16 * 1024 * 1024;
const NOT_RUNNING =
  'XMap Studio non è aperto (o è una versione senza il collegamento con Claude): avvia l\'app, apri la mappa e riprova.';

type Core = typeof import('@xmap/core/agent');

export interface McpBridgeOptions {
  version?: string;
  /** Chiamata quando il client chiude stdin; di default termina il processo. */
  onEnd?: () => void;
}

export function runMcpBridge(options: McpBridgeOptions = {}): void {
  const version = options.version ?? packageVersion();
  const corePromise: Promise<Core> = import('@xmap/core/agent');
  const serverPromise = corePromise.then(({ createMcpServer }) =>
    createMcpServer({ name: 'xmap-studio', version, callTool })
  );

  let inFlight = 0;
  let inputClosed = false;
  const finishIfIdle = () => {
    if (inputClosed && inFlight === 0) (options.onEnd ?? (() => process.exit(0)))();
  };
  const write = (message: unknown) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  const onLine = (line: string) => {
    inFlight++;
    void (async () => {
      try {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          const { errorResponse, JSONRPC_PARSE_ERROR } = await corePromise;
          write(errorResponse(null, JSONRPC_PARSE_ERROR, 'JSON non valido.'));
          return;
        }
        const response = await (await serverPromise)(message);
        if (response) write(response);
      } catch (error: unknown) {
        process.stderr.write(`[xmap-mcp] ${errorMessage(error)}\n`);
      } finally {
        inFlight--;
        finishIfIdle();
      }
    })();
  };

  process.stdin.on('data', lineReader(onLine, MAX_LINE_CHARS, () => process.stderr.write('[xmap-mcp] messaggio troppo lungo, scartato\n')));
  process.stdin.on('end', () => {
    inputClosed = true;
    finishIfIdle();
  });
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  let response: HostResponse;
  if (name === 'list_maps') {
    response = await hostRequest({ op: 'maps' });
  } else {
    const { map, ...rest } = args;
    const mapId = typeof map === 'number' && Number.isInteger(map) ? map : undefined;
    if (map !== undefined && mapId === undefined) {
      return { text: 'map deve essere il numero di una mappa elencata da list_maps.', isError: true };
    }
    response = await hostRequest({ op: 'call', map: mapId, tool: name, args: rest });
  }
  return response.ok ? { text: response.text } : { text: response.error, isError: true };
}

let nextId = 1;

type HostPayload = { op: 'maps' } | { op: 'call'; map?: number; tool: string; args: Record<string, unknown> };

/** Una connessione per richiesta: se l'app si chiude e si riapre, la chiamata successiva funziona comunque. */
function hostRequest(payload: HostPayload): Promise<HostResponse> {
  const id = nextId++;
  const request: HostRequest = { id, ...payload };
  return new Promise((resolve, reject) => {
    const socket = net.connect(mcpSocketPath());
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(() => settle(() => reject(new Error('XMap Studio non ha risposto in tempo.'))), HOST_TIMEOUT_MS);
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on(
      'data',
      lineReader(
        (line) => {
          let response: HostResponse;
          try {
            response = JSON.parse(line) as HostResponse;
          } catch {
            settle(() => reject(new Error('Risposta non valida da XMap Studio.')));
            return;
          }
          if (response.id === id || response.id === 0) settle(() => resolve(response));
        },
        MAX_LINE_CHARS,
        () => settle(() => reject(new Error('Risposta troppo lunga da XMap Studio.')))
      )
    );
    socket.on('error', (error: NodeJS.ErrnoException) => {
      const notRunning = error.code === 'ENOENT' || error.code === 'ECONNREFUSED';
      settle(() => reject(new Error(notRunning ? NOT_RUNNING : `Collegamento con XMap Studio non riuscito: ${error.message}`)));
    });
    socket.on('close', () => settle(() => reject(new Error('XMap Studio ha chiuso il collegamento senza rispondere.'))));
  });
}

function packageVersion(): string {
  for (const candidate of ['../package.json', '../../../package.json']) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require(candidate) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // Struttura diversa (sviluppo o pacchetto): si prova il percorso successivo.
    }
  }
  return '0.0.0';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) runMcpBridge();
