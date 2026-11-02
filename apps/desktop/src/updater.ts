/**
 * Aggiornamenti dell'app desktop, gestiti dal main process.
 *
 * - AppImage: si scarica il file `.zsync` dell'ultima release e si ricostruisce
 *   la nuova AppImage riusando i blocchi di quella in uso; si scaricano solo i
 *   blocchi cambiati (HTTP Range). Il file nuovo, verificato con SHA-1 (zsync)
 *   e SHA-256 (checksum della release), sostituisce quello vecchio con un
 *   `rename` atomico: l'istanza in esecuzione continua a usare il vecchio inode.
 * - Exe portable di Windows: si scarica la nuova versione accanto a quella in
 *   uso (o nei Download), verificata con SHA-256; il riavvio la avvia.
 * - Altre installazioni: si segnala soltanto la nuova versione.
 *
 * Si scarica solo da asset della release del repository, mai da URL arbitrari.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UpdateInstallMode, UpdateRelease, UpdateState, UpdateStatus, UpdateStep } from './preload.js';

type UpdateCore = typeof import('@xmap/core/update');
let corePromise: Promise<UpdateCore> | null = null;
function loadUpdateCore(): Promise<UpdateCore> {
  corePromise ??= import('@xmap/core/update');
  return corePromise;
}

const REPO = 'gioelerosana/xmap-studio';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const RELEASE_PAGE_PREFIX = `https://github.com/${REPO}/releases/`;
// Accetta "XMap-Studio-26.2.0-portable-x64.exe"; rifiuta "XMap-Studio-26.2.0-x86_64.AppImage".
// Verifica: https://regex101.com/?regex=%5EXMap-Studio-%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B-portable-x64%5C.exe%24&testString=XMap-Studio-26.2.0-portable-x64.exe
const WINDOWS_ASSET = /^XMap-Studio-\d+\.\d+\.\d+-portable-x64\.exe$/;
// Accetta "XMap-Studio-26.2.0-x86_64.AppImage"; rifiuta "XMap-Studio-26.2.0-x86_64.AppImage.zsync".
// Verifica: https://regex101.com/?regex=%5EXMap-Studio-%5Cd%2B%5C.%5Cd%2B%5C.%5Cd%2B-x86_64%5C.AppImage%24&testString=XMap-Studio-26.2.0-x86_64.AppImage
const APPIMAGE_ASSET = /^XMap-Studio-\d+\.\d+\.\d+-x86_64\.AppImage$/;
const WINDOWS_CHECKSUMS = 'SHA256SUMS-windows.txt';
const LINUX_CHECKSUMS = 'SHA256SUMS-linux.txt';
const PREFS_FILE = 'updates.json';
// Separatore dei campi di SHA256SUMS: "ab12  file" → ["ab12", "file"]; non separa "ab12file".
// Verifica: https://regex101.com/?regex=%5Cs%2B&testString=ab12%20%20file
const WHITESPACE = /\s+/;
// Senza timeout il controllo resterebbe "in corso" per sempre su una rete che non risponde.
const API_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const RANGE_TIMEOUT_MS = 120_000;
const FIRST_CHECK_DELAY_MS = 10_000;
/** 6 ore. */
const CHECK_INTERVAL_MS = 21_600_000;
const PROGRESS_THROTTLE_MS = 150;
/** Intervalli mancanti separati da meno di così si scaricano insieme: meno richieste, pochi byte in più. */
const RANGE_MERGE_GAP = 262_144;
/** Oltre questo numero di richieste, o di byte da scaricare, conviene scaricare il file intero. */
const MAX_RANGE_REQUESTS = 400;
const FULL_DOWNLOAD_RATIO = 0.85;
const RANGE_CONCURRENCY = 4;
const EXECUTABLE_BITS = 0o111;
const PERMISSION_BITS = 0o777;
const HTTP_PARTIAL_CONTENT = 206;

type ReleaseAsset = { name: string; url: string };
type Release = UpdateRelease & { assets: ReleaseAsset[] };
type Prefs = { autoCheck: boolean; lastCheckedAt: number | null };

let state: UpdateState = { phase: 'idle' };
let latest: Release | null = null;
let prefs: Prefs = { autoCheck: true, lastCheckedAt: null };
let relaunchPath: string | null = null;
let restartRequested = false;
let lastBroadcast = 0;

function installMode(): UpdateInstallMode {
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (process.platform === 'linux' && process.env.APPIMAGE) return 'appimage';
  return 'manual';
}

function currentStatus(): UpdateStatus {
  return {
    currentVersion: app.getVersion(),
    mode: installMode(),
    autoCheck: prefs.autoCheck,
    lastCheckedAt: prefs.lastCheckedAt,
    state,
  };
}

/** Aggiorna lo stato e lo invia a tutte le finestre; l'avanzamento si invia al massimo ogni 150 ms. */
function setState(next: UpdateState, throttle = false): void {
  state = next;
  const now = Date.now();
  if (throttle && now - lastBroadcast < PROGRESS_THROTTLE_MS) return;
  lastBroadcast = now;
  const status = currentStatus();
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('update:status', status);
  });
}

function progressState(release: Release, step: UpdateStep, progress: number | null, throttle = true): void {
  setState({ phase: 'downloading', release: publicRelease(release), step, progress }, throttle);
}

function publicRelease({ assets: _assets, ...release }: Release): UpdateRelease {
  return release;
}

function isBusy(): boolean {
  return state.phase === 'checking' || state.phase === 'downloading';
}

// --- Preferenze -------------------------------------------------------------

function prefsPath(): string {
  return path.join(app.getPath('userData'), PREFS_FILE);
}

function loadPrefs(): void {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    if (!isRecord(raw)) return;
    prefs = {
      autoCheck: typeof raw.autoCheck === 'boolean' ? raw.autoCheck : true,
      lastCheckedAt: typeof raw.lastCheckedAt === 'number' ? raw.lastCheckedAt : null,
    };
  } catch {
    // Primo avvio o file illeggibile: valgono i predefiniti.
  }
}

async function savePrefs(): Promise<void> {
  try {
    await fs.promises.writeFile(prefsPath(), JSON.stringify(prefs));
  } catch (error: unknown) {
    console.warn('[xmap] preferenze degli aggiornamenti non salvate:', error);
  }
}

// --- GitHub -----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchOk(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`GitHub ha risposto ${response.status} per ${new URL(url).pathname}.`);
  return response;
}

/** Messaggio per l'utente: il timeout di AbortSignal arriva con un testo in inglese. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'GitHub non ha risposto in tempo: riprova più tardi.';
  if (error instanceof TypeError) return 'Connessione a GitHub non riuscita: controlla la rete.';
  return error instanceof Error ? error.message : String(error);
}

/** Legge la risposta dell'API GitHub tenendo solo i campi usati e gli asset del repository. */
async function parseRelease(json: unknown): Promise<Release> {
  if (!isRecord(json) || typeof json.tag_name !== 'string') throw new Error('Risposta di GitHub non valida.');
  const { stripVersionPrefix } = await loadUpdateCore();
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const url = typeof json.html_url === 'string' && json.html_url.startsWith(RELEASE_PAGE_PREFIX)
    ? json.html_url
    : `${RELEASE_PAGE_PREFIX}tag/${encodeURIComponent(json.tag_name)}`;
  return {
    tag: json.tag_name,
    version: stripVersionPrefix(json.tag_name),
    url,
    notes: typeof json.body === 'string' ? json.body : '',
    publishedAt: typeof json.published_at === 'string' ? json.published_at : null,
    assets: assets.flatMap((asset: unknown) =>
      isRecord(asset) && typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
        && asset.browser_download_url.startsWith(DOWNLOAD_PREFIX)
        ? [{ name: asset.name, url: asset.browser_download_url }]
        : [],
    ),
  };
}

function findAsset(release: Release, match: (name: string) => boolean, description: string): ReleaseAsset {
  const asset = release.assets.find((candidate) => match(candidate.name));
  if (!asset) throw new Error(`La release ${release.tag} non contiene ${description}.`);
  return asset;
}

async function expectedSha256(release: Release, checksumsName: string, fileName: string): Promise<string> {
  const asset = findAsset(release, (name) => name === checksumsName, 'il file dei checksum');
  const text = await (await fetchOk(asset.url, API_TIMEOUT_MS)).text();
  // Riga "ab12…  file": hash e nome separati da spazi, quindi i campi sono il primo e l'ultimo.
  const fields = text.split('\n').map((row) => row.trim().split(WHITESPACE));
  const hash = fields.find((row) => row[row.length - 1] === fileName)?.[0]?.toLowerCase();
  // 64 cifre esadecimali: "e3b0c442…" sì, "abc" no.
  // Verifica: https://regex101.com/?regex=%5E%5B0-9a-f%5D%7B64%7D%24&testString=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Checksum della release non leggibile.');
  return hash;
}

// --- Controllo --------------------------------------------------------------

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (isBusy()) return currentStatus();
  const previous = state;
  setState({ phase: 'checking' });
  try {
    const response = await fetchOk(LATEST_URL, API_TIMEOUT_MS, { headers: { Accept: 'application/vnd.github+json' } });
    const release = await parseRelease(await response.json());
    const { compareVersions } = await loadUpdateCore();
    latest = release;
    prefs.lastCheckedAt = Date.now();
    void savePrefs();
    if (previous.phase === 'ready' && previous.release.version === release.version) setState(previous);
    else if (compareVersions(release.version, app.getVersion()) > 0) setState({ phase: 'available', release: publicRelease(release) });
    else setState({ phase: 'upToDate', latestVersion: release.version });
  } catch (error: unknown) {
    setState({ phase: 'error', message: `Controllo non riuscito: ${describeError(error)}`, release: null });
  }
  return currentStatus();
}

// --- Installazione ----------------------------------------------------------

export async function installUpdate(): Promise<UpdateStatus> {
  if (isBusy()) return currentStatus();
  const release = latest;
  if (!release || !(state.phase === 'available' || state.phase === 'error')) return currentStatus();
  const mode = installMode();
  if (mode === 'manual') {
    await shell.openExternal(release.url);
    return currentStatus();
  }
  try {
    progressState(release, 'downloading', null, false);
    const result = mode === 'appimage' ? await installAppImage(release) : await downloadPortable(release);
    setState({ phase: 'ready', release: publicRelease(release), ...result });
  } catch (error: unknown) {
    setState({ phase: 'error', message: `Aggiornamento non riuscito: ${describeError(error)}`, release: publicRelease(release) });
  }
  return currentStatus();
}

type InstallResult = { path: string; downloadedBytes: number; reusedBytes: number };

async function installAppImage(release: Release): Promise<InstallResult> {
  const target = process.env.APPIMAGE;
  if (!target) throw new Error('AppImage in uso non trovata.');
  const dir = path.dirname(target);
  try {
    await fs.promises.access(dir, fs.constants.W_OK);
  } catch {
    throw new Error(`La cartella ${dir} non è scrivibile: scarica la nuova versione dalla pagina della release.`);
  }
  const appImage = findAsset(release, (name) => APPIMAGE_ASSET.test(name), "l'AppImage");
  const zsyncAsset = findAsset(release, (name) => name === `${appImage.name}.zsync`, 'il file .zsync');
  const sha256 = await expectedSha256(release, LINUX_CHECKSUMS, appImage.name);
  const { parseZsyncControl, planZsync } = await loadUpdateCore();
  const control = parseZsyncControl(new Uint8Array(await (await fetchOk(zsyncAsset.url, API_TIMEOUT_MS)).arrayBuffer()));

  // Il `.zsync` deve riferirsi all'AppImage della stessa release: niente URL esterni.
  if (new URL(control.url, zsyncAsset.url).href !== appImage.url) {
    throw new Error('Il file .zsync punta a un file diverso dall’AppImage della release.');
  }

  const original = await fs.promises.stat(target);
  const partial = path.join(dir, `.${path.basename(target)}.update-${process.pid}.part`);
  try {
    progressState(release, 'scanning', 0, false);
    const local = await fs.promises.readFile(target);
    const plan = await planZsync(control, local, {
      onProgress: (fraction) => progressState(release, 'scanning', fraction),
    });
    const ranges = mergeRanges(plan.missing);
    const rangeBytes = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    const useZsync = ranges.length <= MAX_RANGE_REQUESTS && rangeBytes <= control.length * FULL_DOWNLOAD_RATIO;

    let downloadedBytes: number;
    let reusedBytes = 0;
    if (useZsync) {
      const handle = await fs.promises.open(partial, 'w');
      try {
        await handle.truncate(control.length);
        await writeCopies(handle, local, plan.copies, control.blocksize, control.length);
        downloadedBytes = await fetchRanges(handle, appImage.url, ranges, release);
        await handle.sync();
      } finally {
        await handle.close();
      }
      reusedBytes = plan.reusedBytes;
    } else {
      downloadedBytes = await downloadFile(appImage.url, partial, release);
    }

    progressState(release, 'verifying', null, false);
    let digests = await fileDigests(partial);
    if (useZsync && (digests.sha1 !== control.sha1 || digests.sha256 !== sha256)) {
      // Ricostruzione incoerente (es. collisione di checksum): si riparte dal file intero.
      downloadedBytes = await downloadFile(appImage.url, partial, release);
      reusedBytes = 0;
      progressState(release, 'verifying', null, false);
      digests = await fileDigests(partial);
    }
    if (digests.sha256 !== sha256) throw new Error('Il file scaricato non corrisponde al checksum: scartato.');

    progressState(release, 'installing', null, false);
    await fs.promises.chmod(partial, (original.mode & PERMISSION_BITS) | EXECUTABLE_BITS);
    await fs.promises.rename(partial, target);
    await syncDirectory(dir);
    relaunchPath = target;
    return { path: target, downloadedBytes, reusedBytes };
  } finally {
    await fs.promises.rm(partial, { force: true });
  }
}

async function downloadPortable(release: Release): Promise<InstallResult> {
  const asset = findAsset(release, (name) => WINDOWS_ASSET.test(name), "l'exe portable per Windows");
  const sha256 = await expectedSha256(release, WINDOWS_CHECKSUMS, asset.name);
  const dir = await portableTargetDir();
  const target = path.join(dir, asset.name);
  // Il file parziale non deve mai sembrare un eseguibile completo.
  const partial = `${target}.part`;
  let downloadedBytes = 0;
  try {
    downloadedBytes = await downloadFile(asset.url, partial, release);
    progressState(release, 'verifying', null, false);
    if ((await fileDigests(partial)).sha256 !== sha256) throw new Error('Il file scaricato non corrisponde al checksum: scartato.');
    await fs.promises.rename(partial, target);
  } finally {
    await fs.promises.rm(partial, { force: true });
  }
  relaunchPath = target;
  shell.showItemInFolder(target);
  return { path: target, downloadedBytes, reusedBytes: 0 };
}

/** Accanto all'exe in uso, se la cartella è scrivibile; altrimenti nei Download. */
async function portableTargetDir(): Promise<string> {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (dir) {
    try {
      await fs.promises.access(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // Cartella di sola lettura (es. chiavetta protetta): si ripiega sui Download.
    }
  }
  return app.getPath('downloads');
}

type ByteRange = { start: number; end: number };

function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  return ranges.reduce<ByteRange[]>((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end <= RANGE_MERGE_GAP) last.end = range.end;
    else merged.push({ ...range });
    return merged;
  }, []);
}

/** Copia nel file nuovo i blocchi già presenti in quello locale, unendo le sequenze contigue. */
async function writeCopies(
  handle: fs.promises.FileHandle,
  local: Buffer,
  copies: { block: number; sourceOffset: number }[],
  blocksize: number,
  length: number,
): Promise<void> {
  let run: { start: number; source: number; length: number } | null = null;
  const flush = async () => {
    if (!run) return;
    // Oltre la fine del file locale il blocco era padding a zero: il file nuovo, troncato, è già a zero.
    const available = Math.max(0, Math.min(run.length, local.length - run.source));
    if (available > 0) await handle.write(local, run.source, available, run.start);
    run = null;
  };
  for (const { block, sourceOffset } of copies) {
    const start = block * blocksize;
    const size = Math.min(blocksize, length - start);
    if (run && run.start + run.length === start && run.source + run.length === sourceOffset) {
      run.length += size;
      continue;
    }
    await flush();
    run = { start, source: sourceOffset, length: size };
  }
  await flush();
}

/** Scarica gli intervalli mancanti con poche richieste in parallelo; restituisce i byte scaricati. */
async function fetchRanges(
  handle: fs.promises.FileHandle,
  url: string,
  ranges: ByteRange[],
  release: Release,
): Promise<number> {
  const total = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  let done = 0;
  let next = 0;
  progressState(release, 'downloading', total === 0 ? 1 : 0, false);
  const worker = async () => {
    while (next < ranges.length) {
      const range = ranges[next++];
      if (!range) return;
      const response = await fetchOk(url, RANGE_TIMEOUT_MS, { headers: { Range: `bytes=${range.start}-${range.end - 1}` } });
      if (response.status !== HTTP_PARTIAL_CONTENT) throw new Error('Il server non supporta il download parziale.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== range.end - range.start) throw new Error('Risposta parziale di lunghezza inattesa.');
      await handle.write(bytes, 0, bytes.length, range.start);
      done += bytes.length;
      progressState(release, 'downloading', total === 0 ? 1 : done / total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(RANGE_CONCURRENCY, ranges.length) }, worker));
  return total;
}

/** Scarica `url` in `target` a flusso, con l'avanzamento; restituisce i byte scritti. */
async function downloadFile(url: string, target: string, release: Release): Promise<number> {
  const response = await fetchOk(url, DOWNLOAD_TIMEOUT_MS);
  if (!response.body) throw new Error('Risposta vuota da GitHub.');
  const total = Number(response.headers.get('content-length')) || null;
  const handle = await fs.promises.open(target, 'w');
  let written = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await handle.write(value, 0, value.length, written);
      written += value.length;
      progressState(release, 'downloading', total ? written / total : null);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (total !== null && written !== total) throw new Error('Download interrotto: file incompleto.');
  return written;
}

async function fileDigests(file: string): Promise<{ sha1: string; sha256: string }> {
  const sha1 = crypto.createHash('sha1');
  const sha256 = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) {
    sha1.update(chunk as Buffer);
    sha256.update(chunk as Buffer);
  }
  return { sha1: sha1.digest('hex'), sha256: sha256.digest('hex') };
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await fs.promises.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Alcuni filesystem non permettono fsync su una directory: il rename è già avvenuto.
  }
}

// --- Riavvio e registrazione ------------------------------------------------

/** Chiude tutte le finestre (ognuna chiede conferma se ha modifiche); il riavvio avviene a finestre chiuse. */
function restartToUpdate(): void {
  if (state.phase !== 'ready' || !relaunchPath) return;
  BrowserWindow.getAllWindows().forEach((window) => window.close());
}

/**
 * Da chiamare in `window-all-closed`: se c'è un aggiornamento pronto e
 * l'utente ha chiesto il riavvio, riavvia sulla nuova versione.
 */
export function relaunchIfRequested(): boolean {
  if (state.phase !== 'ready' || !relaunchPath || !restartRequested) return false;
  if (installMode() === 'appimage') relaunchAppImage(relaunchPath);
  else app.relaunch({ execPath: relaunchPath, args: [] });
  app.quit();
  return true;
}

/**
 * Variabili che il runtime AppImage e l'AppRun impostano per l'istanza in uso:
 * puntano al mount FUSE della vecchia versione, che sparisce alla chiusura.
 */
const APPIMAGE_ENV = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'];
const APPIMAGE_PATH_LISTS = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR'];

/**
 * Lo script chiude i descrittori ereditati oltre stdin/stdout/stderr, aspetta
 * (al massimo 60 s) che il vecchio main process esca e poi avvia l'AppImage.
 * Senza la chiusura la nuova istanza erediterebbe la pipe keepalive del vecchio
 * runtime e i file aperti nel vecchio mount, tenendolo montato finché resta aperta.
 * Bash c'è sempre: lo richiede già l'AppRun di electron-builder.
 */
const RELAUNCH_SCRIPT = [
  'for fd in /proc/$$/fd/*; do fd=${fd##*/}; [ "$fd" -gt 2 ] 2>/dev/null && eval "exec $fd>&-"; done',
  'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.2; i=$((i+1)); done',
  'exec "$2"',
].join('\n');

/**
 * `app.relaunch` non funziona da un'AppImage: il processo `--type=relauncher` di
 * Electron gira dentro il mount FUSE della vecchia versione e muore quando il
 * runtime lo smonta, prima di avviare quella nuova. Si avvia quindi un processo
 * staccato, fuori dal mount e con l'ambiente ripulito, che aspetta la chiusura
 * di questa istanza (il lock d'istanza singola e il profilo devono essere liberi).
 */
function relaunchAppImage(target: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const mount = process.env.APPDIR;
  APPIMAGE_ENV.forEach((name) => delete env[name]);
  if (mount) {
    APPIMAGE_PATH_LISTS.forEach((name) => {
      const value = env[name];
      if (value) env[name] = value.split(':').filter((entry) => entry !== '' && !entry.startsWith(mount)).join(':');
    });
  }
  try {
    const child = spawn('bash', ['-c', RELAUNCH_SCRIPT, 'xmap-relaunch', String(process.pid), target], {
      detached: true,
      stdio: 'ignore',
      env,
      cwd: path.dirname(target),
    });
    child.on('error', (error) => console.warn('[xmap] riavvio dopo l\'aggiornamento non riuscito:', error));
    child.unref();
  } catch (error: unknown) {
    console.warn('[xmap] riavvio dopo l\'aggiornamento non riuscito:', error);
  }
}

export function registerUpdater(): void {
  loadPrefs();
  ipcMain.handle('update:getStatus', () => currentStatus());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('update:setAutoCheck', async (_event, enabled: unknown) => {
    if (typeof enabled === 'boolean') {
      prefs.autoCheck = enabled;
      await savePrefs();
      setState(state);
    }
    return currentStatus();
  });
  ipcMain.on('update:restart', () => {
    restartRequested = true;
    restartToUpdate();
  });

  const autoCheck = () => {
    if (prefs.autoCheck && (state.phase === 'idle' || state.phase === 'upToDate' || state.phase === 'error')) {
      void checkForUpdates();
    }
  };
  void scheduleAutoCheck(autoCheck);
}

async function scheduleAutoCheck(autoCheck: () => void): Promise<void> {
  await app.whenReady();
  setTimeout(autoCheck, FIRST_CHECK_DELAY_MS);
  setInterval(autoCheck, CHECK_INTERVAL_MS);
}
