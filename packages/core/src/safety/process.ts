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
        if (isXmindInvocation(tokens)) {
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

/** Frammenti del percorso della nostra app (anche nomi storici e AppImage estratta). */
const OWN_APP_MARKERS = [
  'xmap-studio',
  'xmap studio',
  'xmind-equation-studio',
  'xmind equation studio',
  'xmind-latex',
  'appimage_extracted',
];

const XMIND_FLATPAK_ID = 'net.xmind.XMind';

function cleanToken(token: string): string {
  return token.replace(/^["']|["']$/g, '');
}

function baseName(token: string): string {
  return token.split('/').pop() || token;
}

/** Eseguibile di XMind: nome esatto e minuscolo "xmind" o il binario del Flatpak. */
function isXmindExecutable(token: string): boolean {
  return baseName(token) === 'xmind' || token.endsWith('/app/main/xmind');
}

/**
 * Decide se una riga di comando (argv di /proc/PID/cmdline) è XMind.
 *
 * Conta solo l'eseguibile, non gli argomenti: `xmind ~/xmap-studio/x.xmind`
 * è XMind anche se il file sta nella nostra cartella, mentre `vim xmind` non
 * lo è. Fanno eccezione i lanciatori del Flatpak (`flatpak run
 * net.xmind.XMind`, `bwrap … /app/main/xmind`), dove XMind è un argomento.
 * Una stringa viene divisa sugli spazi (percorsi con spazi: passare l'argv).
 */
export function isXmindInvocation(argv: string | readonly string[]): boolean {
  const tokens = (typeof argv === 'string' ? argv.trim().split(/\s+/) : [...argv])
    .map(cleanToken)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return false;

  const exe = tokens[0];
  const lowerExe = exe.toLowerCase();
  if (OWN_APP_MARKERS.some((marker) => lowerExe.includes(marker))) return false;
  if (isXmindExecutable(exe)) return true;

  const args = tokens.slice(1);
  switch (baseName(exe)) {
    case 'flatpak':
      // "net.xmind.XMind" oppure "net.xmind.XMind//stable"
      return args.some((arg) => arg.split('//')[0] === XMIND_FLATPAK_ID);
    case 'bwrap':
      return args.some(isXmindExecutable);
    default:
      return false;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
