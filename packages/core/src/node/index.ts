import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Platform } from '../platform.js';
import { atomicWrite } from './atomic.js';
import { xmindProcesses } from './process.js';

export { atomicWrite } from './atomic.js';
export { xmindProcesses } from './process.js';
export { guardedSave } from './guarded-save.js';
export type { GuardedSaveDeps, GuardedSaveResult } from './guarded-save.js';

/** Implementazione di `Platform` per Node/Electron. */
export const nodePlatform: Platform = {
  readFile: async (filePath) => new Uint8Array(await fs.promises.readFile(filePath)),
  atomicWrite,
  xmindProcesses,
  resolvePath: (filePath) => path.resolve(filePath),
};
