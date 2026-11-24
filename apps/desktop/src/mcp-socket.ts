// Canale locale tra l'app desktop (che ospita le mappe aperte) e il server MCP
// su stdio (`mcp-bridge.ts`) avviato dal client di Claude. Un messaggio JSON per
// riga, su un socket Unix (Linux, macOS) o una named pipe (Windows) dell'utente.
// Niente import di Electron: il bridge gira anche con il solo Node.
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** Richiesta dal bridge all'app. `map` è l'id di finestra elencato da `list_maps`. */
export type HostRequest =
  | { id: number; op: 'maps' }
  | { id: number; op: 'call'; map?: number; tool: string; args: Record<string, unknown> };

export type HostResponse = { id: number; ok: true; text: string } | { id: number; ok: false; error: string };

/** Override per sviluppo e test. */
const SOCKET_ENV = 'XMAP_MCP_SOCKET';

/** Percorso del canale: uguale per l'app e per il bridge, senza bisogno di Electron. */
export function mcpSocketPath(): string {
  const override = process.env[SOCKET_ENV];
  if (override) return override;
  const user = safeUserName();
  if (process.platform === 'win32') return `\\\\.\\pipe\\xmap-studio-mcp-${user}`;
  // XDG_RUNTIME_DIR è privato dell'utente (0700); in alternativa la cartella temporanea, con il nome utente nel file.
  const dir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(dir, `xmap-studio-mcp-${user}.sock`);
}

function safeUserName(): string {
  try {
    return os.userInfo().username.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'user';
  } catch {
    // Utente senza voce in /etc/passwd (container): basta un nome stabile.
    return typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  }
}

/**
 * Divide un flusso in righe: restituisce la funzione da chiamare a ogni blocco
 * di dati ricevuto. Le righe vuote si ignorano; una riga più lunga di
 * `maxLength` caratteri chiama `onOverflow` e svuota il buffer.
 */
export function lineReader(
  onLine: (line: string) => void,
  maxLength = Number.POSITIVE_INFINITY,
  onOverflow?: () => void
): (chunk: Buffer | string) => void {
  let buffer = '';
  // Un carattere UTF-8 può arrivare spezzato tra due blocchi: il decoder lo ricompone.
  const decoder = new StringDecoder('utf8');
  return (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== '') onLine(line);
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > maxLength) {
      buffer = '';
      onOverflow?.();
    }
  };
}
