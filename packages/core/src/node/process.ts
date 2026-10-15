import * as fs from 'node:fs';
import * as path from 'node:path';
import { isXmindInvocation } from '../safety/process.js';

/**
 * Rileva processi XMind in esecuzione per evitare corruzioni di file.
 * Scansiona `/proc` (Linux); altrove non rileva nulla.
 */
export async function xmindProcesses(): Promise<string[]> {
  const found: string[] = [];

  try {
    if (!fs.existsSync('/proc')) return found;

    const selfPid = process.pid;
    for (const name of fs.readdirSync('/proc')) {
      const pid = parseInt(name, 10);
      if (isNaN(pid) || pid === selfPid) continue;

      try {
        const raw = fs.readFileSync(path.join('/proc', name, 'cmdline'));
        const tokens = raw
          .toString('utf8')
          .split('\0')
          .filter((s) => s.length > 0);
        if (tokens.length === 0) continue;

        if (isXmindInvocation(tokens)) {
          found.push(`${pid}: ${truncate(tokens.join(' '), 200)}`);
        }
      } catch {
        // Processo terminato o permessi insufficienti
      }
    }
  } catch {
    // /proc non accessibile
  }

  return found;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
