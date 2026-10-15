/**
 * Rileva processi XMind in esecuzione per evitare corruzioni di file (Desktop / Linux / Posix).
 */
export async function xmindProcesses(): Promise<string[]> {
  const found: string[] = [];

  // Se siamo in ambiente Node/Electron
  if (typeof process === 'undefined' || !process.versions?.node) {
    return found;
  }

  try {
    const fs = await import('node:fs');
    const path = await import('node:path');

    if (!fs.existsSync('/proc')) {
      return found;
    }

    const selfPid = process.pid;
    const entries = fs.readdirSync('/proc');

    for (const name of entries) {
      const pid = parseInt(name, 10);
      if (isNaN(pid) || pid === selfPid) continue;

      const cmdPath = path.join('/proc', name, 'cmdline');
      try {
        const raw = fs.readFileSync(cmdPath);
        const tokens = raw
          .toString('utf8')
          .split('\0')
          .filter((s) => s.length > 0);
        if (tokens.length === 0) continue;

        const cmdline = tokens.join(' ');
        if (isXmindInvocation(cmdline)) {
          found.push(`${pid}: ${truncate(cmdline, 200)}`);
        }
      } catch {
        // Processo terminato o permessi insufficienti
      }
    }
  } catch {
    // Non su Linux o /proc non accessibile
  }

  return found;
}

export function isXmindInvocation(cmdline: string): boolean {
  const lower = cmdline.toLowerCase();
  if (
    lower.includes('xmap-studio') ||
    lower.includes('xmap studio') ||
    lower.includes('xmind-equation-studio') ||
    lower.includes('xmind equation studio') ||
    lower.includes('xmind-latex') ||
    lower.includes('appimage_extracted')
  ) {
    return false;
  }

  const parts = cmdline.split(/\s+/);
  return parts.some((tok) => {
    const clean = tok.replace(/^["']|["']$/g, '');
    const base = clean.split('/').pop() || clean;
    return (
      base === 'xmind' ||
      clean.endsWith('/app/main/xmind') ||
      clean.includes('net.xmind.XMind')
    );
  });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
