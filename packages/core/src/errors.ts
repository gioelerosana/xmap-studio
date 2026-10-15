/**
 * Errori con codice stabile, speculari a `src-tauri/src/error.rs`: il `code`
 * permette alla UI di reagire (es. proporre "Salva comunque" su conflitto o su
 * XMind aperto) senza dover interpretare i messaggi, che sono in italiano.
 */

export const CODE_XMIND_RUNNING = 'xmind_running';
export const CODE_CONFLICT = 'conflict';
export const CODE_LATEX = 'latex';
export const CODE_NO_WORKBOOK = 'no_workbook';
export const CODE_TOPIC_NOT_FOUND = 'topic_not_found';
export const CODE_RENDERER = 'renderer';
export const CODE_VALIDATION = 'validation';
export const CODE_IO = 'io';
export const CODE_FORMAT = 'format';
export const CODE_MOVE = 'move';
/** Richiesta non valida (argomenti fuori dominio, stato non ammesso). */
export const CODE_INVALID_INPUT = 'invalid_input';
/** Il workbook non ha un percorso su disco: serve "Salva con nome". */
export const CODE_NO_PATH = 'no_path';

export interface ErrorPayload {
  code: string;
  message: string;
}

export class XmapError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'XmapError';
    this.code = code;
    this.details = details;
  }
}

/** Codice di un errore, se è un `XmapError`. */
export function errorCode(err: unknown): string | undefined {
  return err instanceof XmapError ? err.code : undefined;
}

/** Converte qualunque errore in payload serializzabile; il default è `io`, come `from_anyhow`. */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof XmapError) return { code: err.code, message: err.message };
  return { code: CODE_IO, message: err instanceof Error ? err.message : String(err) };
}
