/**
 * Riconoscimento puro di XMind a partire dall'argv di un processo. La scansione
 * dei processi (che richiede Node) vive in `node/process.ts`.
 */

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
