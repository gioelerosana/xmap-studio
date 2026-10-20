// Compila e serve la web app in HTTPS sulla tailnet, per provarla (anche
// offline, come PWA) su tablet e telefoni. Safari registra il service worker
// solo in un contesto sicuro: l'HTTPS lo dà `tailscale serve` con un
// certificato *.ts.net valido, senza certificati locali.
//
// Se il Tailscale Service `svc:xmap` è configurato (vedi AGENTS.md §"Mobile e
// PWA") l'indirizzo è lo stesso da qualunque PC: https://xmap.<tailnet>.ts.net.
// Altrimenti si ripiega sul nome della macchina: https://<pc>.<tailnet>.ts.net.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';

const PORT = 4173;
const SERVICE = process.env.XMAP_TS_SERVICE ?? 'svc:xmap';
const target = `http://127.0.0.1:${PORT}`;

function tailscale(args, options = {}) {
  return execFileSync('tailscale', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
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

// Un `vite preview` rimasto da una run precedente occupa la porta: meglio
// fermarsi subito che compilare, configurare il serve e poi morire.
const portFree = await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(PORT, () => probe.close(() => resolve(true)));
});
if (!portFree) {
  console.error(
    `La porta ${PORT} è già occupata (di solito un "vite preview" rimasto da una run precedente).\n` +
      `Fermalo con: pkill -f "vite.js preview --port ${PORT}"`,
  );
  process.exit(1);
}

execFileSync('pnpm', ['build'], { stdio: 'inherit' });

const machineUrl = `https://${status.Self.DNSName.replace(/\.$/, '')}/`;
let url;
try {
  tailscale(['serve', `--service=${SERVICE}`, '--https=443', '--bg', target]);
  url = `https://${SERVICE.replace(/^svc:/, '')}.${status.MagicDNSSuffix}/`;
} catch (err) {
  const reason = String(err.stderr ?? err.message).trim();
  console.warn(`Tailscale Service ${SERVICE} non disponibile (${reason}): uso il nome della macchina.`);
  url = machineUrl;
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
