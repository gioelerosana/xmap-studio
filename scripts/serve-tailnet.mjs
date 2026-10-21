// Compila e serve la web app in HTTPS sulla tailnet, per provarla (anche
// offline, come PWA) su tablet e telefoni. Safari registra il service worker
// solo in un contesto sicuro: l'HTTPS lo dà `tailscale serve` con un
// certificato *.ts.net valido, senza certificati locali.
//
// Se il Tailscale Service `svc:xmap` è configurato (vedi AGENTS.md §"Mobile e
// PWA") l'indirizzo è lo stesso da qualunque PC: https://xmap.<tailnet>.ts.net.
// Altrimenti si ripiega sul nome della macchina: https://<pc>.<tailnet>.ts.net.
//
// `--no-service` (o XMAP_TS_SERVICE vuota) serve solo sul nome della macchina e
// toglie questo PC dagli host del Service: un host non raggiunge l'indirizzo del
// proprio Service, quindi un PC che vuole aprire xmap.<tailnet>.ts.net non deve
// pubblicarlo.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Porta dedicata, alta apposta per non collidere con altri servizi.
const PORT = 60417;
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web');
const SERVICE = process.argv.includes('--no-service') ? '' : (process.env.XMAP_TS_SERVICE ?? 'svc:xmap');
const target = `http://127.0.0.1:${PORT}`;

function tailscale(args, options = {}) {
  return execFileSync('tailscale', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function listeners(port) {
  try {
    const out = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
    return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  } catch {
    return [];
  }
}

function ancestors() {
  const chain = new Set();
  for (let pid = process.pid; pid > 1; ) {
    chain.add(pid);
    try {
      pid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0]);
    } catch {
      break;
    }
  }
  return chain;
}

// Processi da fermare: chi ascolta sulla porta dedicata, altre istanze di
// questo script e i `vite preview` lanciati da apps/web (anche su altre porte).
function staleProcesses() {
  const mine = ancestors();
  const found = new Map();
  for (const pid of listeners(PORT)) found.set(pid, `porta ${PORT}`);
  for (const name of readdirSync('/proc')) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || mine.has(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (cmd.includes('scripts/serve-tailnet.mjs')) found.set(pid, 'serve:tailnet');
      else if (cmd.includes('vite.js preview') && readlinkSync(`/proc/${pid}/cwd`) === WEB_DIR) found.set(pid, 'vite preview');
    } catch {
      // processo terminato o non leggibile
    }
  }
  return [...found].filter(([pid]) => !mine.has(pid)).map(([pid, reason]) => ({ pid, reason }));
}

async function killAll(pids) {
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const pid of pids.filter(alive)) {
      try {
        process.kill(pid, signal);
      } catch {
        // già terminato
      }
    }
    for (let i = 0; i < 30 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 100));
  }
}

let status;
try {
  status = JSON.parse(tailscale(['status', '--json']));
} catch {
  console.error('Tailscale non risponde: è installato e avviato (tailscale up)?');
  process.exit(1);
}
if (status.BackendState !== 'Running') {
  console.error(`Tailscale non è connesso (stato: ${status.BackendState}). Esegui "tailscale up".`);
  process.exit(1);
}

// La porta è dedicata a questo script: chiunque la occupi (di norma un
// `vite preview` o un `serve:tailnet` rimasti da una run precedente) viene
// fermato, così non serve mai liberarla a mano.
const stale = staleProcesses();
if (stale.length > 0) {
  console.log(`Fermo ${stale.length} processo/i rimasto/i da prima: ${stale.map((p) => `${p.pid} (${p.reason})`).join(', ')}`);
  await killAll(stale.map((p) => p.pid));
}
if (listeners(PORT).length > 0) {
  console.error(`Impossibile liberare la porta ${PORT}.`);
  process.exit(1);
}

// Toglie questo PC dagli host dei Service che pubblica (la preferenza resta
// salvata in tailscaled anche dopo una run precedente con il Service).
function stopAdvertising() {
  let advertised = [];
  try {
    advertised = JSON.parse(tailscale(['debug', 'prefs'])).AdvertiseServices ?? [];
  } catch (err) {
    console.warn(`Impossibile leggere i Service pubblicati da questo PC: ${String(err.stderr ?? err.message).trim()}`);
  }
  for (const service of advertised) {
    try {
      tailscale(['serve', 'drain', service]);
      tailscale(['serve', `--service=${service}`, 'off']);
      console.log(`Questo PC non pubblica più ${service}.`);
    } catch (err) {
      console.warn(`Impossibile smettere di pubblicare ${service}: ${String(err.stderr ?? err.message).trim()}`);
    }
  }
}

execFileSync('pnpm', ['build'], { stdio: 'inherit' });

const machineUrl = `https://${status.Self.DNSName.replace(/\.$/, '')}/`;
let url = machineUrl;
if (SERVICE) {
  try {
    tailscale(['serve', `--service=${SERVICE}`, '--https=443', '--bg', target]);
    url = `https://${SERVICE.replace(/^svc:/, '')}.${status.MagicDNSSuffix}/`;
  } catch (err) {
    const reason = String(err.stderr ?? err.message).trim();
    console.warn(`Tailscale Service ${SERVICE} non disponibile (${reason}): uso il nome della macchina.`);
  }
} else {
  stopAdvertising();
}
// Il Service non è raggiungibile dal PC che lo ospita: l'URL col nome della
// macchina serve a provare l'app da qui.
tailscale(['serve', '--https=443', '--bg', target]);

console.log(`\nXMap Studio sulla tailnet: ${url}`);
if (url !== machineUrl) {
  console.log(`Il dominio del Service non è raggiungibile da questo PC: provalo da un altro dispositivo.\nDa questo PC: ${machineUrl}`);
}
console.log();
const preview = spawn('pnpm', ['--filter', '@xmap/web', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
});
preview.on('exit', (code) => process.exit(code ?? 0));
