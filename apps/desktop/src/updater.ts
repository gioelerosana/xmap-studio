import { app, shell } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = 'gioelerosana/xmap-studio';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
// Accetta "XMap-Studio-26.2.0-portable-x64.exe"; rifiuta "XMap-Studio-26.2.0-x86_64.AppImage".
const WINDOWS_ASSET = /^XMap-Studio-\d+\.\d+\.\d+-portable-x64\.exe$/;
const CHECKSUMS_ASSET = 'SHA256SUMS-windows.txt';
// Senza timeout il pulsante "Controllo in corso…" resterebbe bloccato su una rete che non risponde.
const API_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

export type UpdateOutcome =
  | { status: 'unsupported'; message: string }
  | { status: 'upToDate'; version: string }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'error'; message: string };

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

/** Confronta due versioni `X.Y.Z` numericamente: > 0 se `a` è più recente di `b`. */
export function compareVersions(a: string, b: string): number {
  // Toglie il prefisso: "v26.2.0" → "26.2.0"; "26.2.0" resta invariato.
  const parts = (version: string) => version.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, index) => (left[index] ?? 0) - (right[index] ?? 0)).find((diff) => diff !== 0) ?? 0;
}

async function fetchOk(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`GitHub ha risposto ${response.status} per ${new URL(url).pathname}.`);
  return response;
}

/** Messaggio per l'utente: il timeout di AbortSignal arriva con un testo in inglese. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'GitHub non ha risposto in tempo: riprova più tardi.';
  return error instanceof Error ? error.message : String(error);
}

/** Pulizia best effort: un errore qui non deve coprire quello originale. */
function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Nulla da fare: conta l'errore che ha interrotto il salvataggio.
  }
}

/** Scarica solo da asset della release del repository, mai da URL arbitrari. */
function trustedAsset(release: Release, match: (name: string) => boolean): ReleaseAsset | undefined {
  return release.assets.find(
    (asset) => match(asset.name) && asset.browser_download_url.startsWith(DOWNLOAD_PREFIX),
  );
}

async function expectedSha256(release: Release, fileName: string): Promise<string> {
  const asset = trustedAsset(release, (name) => name === CHECKSUMS_ASSET);
  if (!asset) throw new Error('La release non ha il file dei checksum: download annullato.');
  const text = await (await fetchOk(asset.browser_download_url, API_TIMEOUT_MS)).text();
  const line = text.split('\n').find((row) => row.trim().endsWith(fileName));
  // Separa hash e nome: "ab12… file.exe" → ["ab12…", "file.exe"].
  const hash = line?.trim().split(/\s+/)[0]?.toLowerCase();
  // Accetta 64 cifre esadecimali; rifiuta "abc" o hash con altri caratteri.
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Checksum della release non leggibile.');
  return hash;
}

async function downloadVerified(url: string, target: string, sha256: string): Promise<void> {
  const response = await fetchOk(url, DOWNLOAD_TIMEOUT_MS);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error('Il file scaricato non corrisponde al checksum: scartato.');
  // Il file parziale non deve mai sembrare un'installazione completa.
  const partial = `${target}.part`;
  try {
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, target);
  } catch (error) {
    removeQuietly(partial);
    throw error;
  }
}

/**
 * Controlla l'ultima release su GitHub e, se è più recente, scarica l'exe
 * portable nella cartella Download, verificandone lo SHA-256. Su Linux gli
 * aggiornamenti passano dal gestore di AppImage (zsync), non da qui.
 */
export async function checkAndDownloadUpdate(): Promise<UpdateOutcome> {
  if (process.platform !== 'win32') {
    return { status: 'unsupported', message: 'Su questo sistema gli aggiornamenti passano dal gestore di AppImage.' };
  }
  try {
    const release = (await (
      await fetchOk(LATEST_URL, API_TIMEOUT_MS, { headers: { Accept: 'application/vnd.github+json' } })
    ).json()) as Release;
    // "v26.2.0" → "26.2.0".
    const version = release.tag_name.replace(/^v/, '');
    if (compareVersions(version, app.getVersion()) <= 0) return { status: 'upToDate', version };

    const asset = trustedAsset(release, (name) => WINDOWS_ASSET.test(name));
    if (!asset) throw new Error(`La release ${release.tag_name} non contiene l'exe portable per Windows.`);

    const sha256 = await expectedSha256(release, asset.name);
    const target = path.join(app.getPath('downloads'), asset.name);
    await downloadVerified(asset.browser_download_url, target, sha256);
    shell.showItemInFolder(target);
    return { status: 'downloaded', version, path: target };
  } catch (error) {
    return { status: 'error', message: describeError(error) };
  }
}
