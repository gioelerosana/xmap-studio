// Avvio di sviluppo dell'app desktop con un solo comando (`pnpm dev:desktop`).
//
// Perché esiste: in modalità --dev Electron carica la UI da Vite su
// localhost:3000. Se il server non c'è, la pagina non si carica e la finestra
// (creata nascosta fino a `ready-to-show`) non compare mai. Qui avviamo Vite se
// non è già attivo, aspettiamo che risponda, compiliamo il processo principale
// e lanciamo Electron; alla chiusura di Electron fermiamo il Vite che abbiamo
// avviato noi. Nessuna dipendenza esterna: solo Node.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_URL = 'http://localhost:3000';
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(desktopDir, '../..');
const require = createRequire(import.meta.url);

async function isServing(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServing(url)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function run(cmd, args, options = {}) {
  return spawn(cmd, args, { stdio: 'inherit', ...options });
}

let vite = null;
function stopVite() {
  if (vite && vite.exitCode === null) {
    // Gruppo di processi: pnpm → vite, va chiuso tutto insieme.
    try {
      process.kill(-vite.pid, 'SIGTERM');
    } catch {
      vite.kill('SIGTERM');
    }
  }
}
process.on('exit', stopVite);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopVite();
    process.exit(130);
  });
}

if (await isServing(DEV_URL)) {
  console.log(`[dev:desktop] server web già attivo su ${DEV_URL}`);
} else {
  console.log('[dev:desktop] avvio del server web (Vite)…');
  vite = run('pnpm', ['--filter', '@xmap/web', 'dev'], { cwd: repoRoot, detached: true });
  if (!(await waitFor(DEV_URL, 60_000))) {
    console.error(`[dev:desktop] il server web non risponde su ${DEV_URL} dopo 60 s`);
    stopVite();
    process.exit(1);
  }
}

const tsc = run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', desktopDir]);
const tscCode = await new Promise((r) => tsc.on('exit', r));
if (tscCode !== 0) {
  stopVite();
  process.exit(tscCode ?? 1);
}

// `electron` esporta il percorso del binario; se l'installazione è incompleta
// il require stesso lancia un errore esplicito.
const electronPath = require('electron');
const electron = run(electronPath, ['.', '--dev'], { cwd: desktopDir });
electron.on('exit', (code) => {
  stopVite();
  process.exit(code ?? 0);
});
