import type { WriteReport } from '../archive/types.js';
import { CODE_XMIND_RUNNING, toErrorPayload } from '../errors.js';
import { validateArchiveBytes } from '../safety/validate.js';
import { atomicWrite } from './atomic.js';
import { xmindProcesses } from './process.js';

/** Dipendenze iniettabili: nei test si sostituiscono con finti. */
export interface GuardedSaveDeps {
  xmindProcesses(): Promise<string[]>;
  validate(bytes: Uint8Array): Promise<unknown>;
  atomicWrite(
    path: string,
    bytes: Uint8Array,
    options: { makeBackup?: boolean; expectedHash?: string }
  ): Promise<WriteReport>;
}

export type GuardedSaveResult =
  | { ok: true; backup?: string; bytes: number }
  | { ok: false; code: string; message: string; processes?: string[] };

const defaultDeps: GuardedSaveDeps = {
  xmindProcesses,
  validate: validateArchiveBytes,
  atomicWrite,
};

/**
 * Salvataggio per il processo main di Electron (regole 2-4 di AGENTS.md):
 * blocca se XMind è aperto (salvo `force`), valida in memoria, scrive in modo
 * atomico. L'esito è un valore discriminato e non un'eccezione perché l'IPC di
 * Electron perde le proprietà custom degli errori (il `code`).
 */
export async function guardedSave(
  filePath: string,
  bytes: Uint8Array,
  options: { expectedHash?: string; force?: boolean } = {},
  deps: GuardedSaveDeps = defaultDeps
): Promise<GuardedSaveResult> {
  try {
    if (options.force !== true) {
      const running = await deps.xmindProcesses();
      if (running.length > 0) {
        return {
          ok: false,
          code: CODE_XMIND_RUNNING,
          message: `XMind è in esecuzione (${running.join(', ')}). Chiudi XMind o forza il salvataggio.`,
          processes: running,
        };
      }
    }
    await deps.validate(bytes);
    const report = await deps.atomicWrite(filePath, bytes, {
      makeBackup: true,
      expectedHash: options.expectedHash,
    });
    return { ok: true, backup: report.backup, bytes: report.bytesWritten };
  } catch (err) {
    return { ok: false, ...toErrorPayload(err) };
  }
}
