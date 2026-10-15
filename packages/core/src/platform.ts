import type { WriteReport } from './archive/types.js';

/**
 * Accesso al disco e ai processi, iniettato nel controller: il core non
 * importa moduli Node, quindi gira identico nel browser. L'implementazione
 * per Node/Electron è `nodePlatform` in `@xmap/core/node`.
 */
export interface Platform {
  readFile(path: string): Promise<Uint8Array>;
  /** Scrittura atomica; con `expectedHash` fallisce con CODE_CONFLICT se il file è cambiato. */
  atomicWrite(
    path: string,
    bytes: Uint8Array,
    options?: { makeBackup?: boolean; expectedHash?: string }
  ): Promise<WriteReport>;
  /** Righe descrittive dei processi XMind in esecuzione (vuoto se nessuno). */
  xmindProcesses(): Promise<string[]>;
  /** Normalizza un percorso (es. rende assoluto); opzionale. */
  resolvePath?(path: string): string;
}
