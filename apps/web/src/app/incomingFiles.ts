/**
 * File `.xmind` che arrivano da fuori dell'app, non da un dialogo aperto qui:
 *
 * - **Condividi** su Android (PWA installata): `share_target` del manifest. Il
 *   service worker riceve il POST, mette i file nella cache `SHARE_INBOX` e
 *   riapre l'app con `?shared=1` (vedi `sw.js`).
 * - **Apri con…** su Chromium desktop (PWA installata): `file_handlers` del
 *   manifest, che consegna i file a `window.launchQueue`.
 *
 * Le due strade finiscono in un'unica coda: i file arrivati prima che la UI sia
 * pronta aspettano il primo `subscribeIncomingFiles`.
 */

export interface IncomingFile {
  name: string;
  bytes: Uint8Array;
  /** Solo da `launchQueue`: permette di risalvare sullo stesso file. */
  handle?: FileSystemFileHandle;
}

export type IncomingFilesHandler = (files: IncomingFile[]) => void;

/** Nome condiviso con `sw.js`: lì si scrive, qui si legge e si svuota. */
export const SHARE_INBOX = 'xmap-share-inbox';
const SHARED_PARAM = 'shared';

interface LaunchParams {
  files: readonly FileSystemHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

let handler: IncomingFilesHandler | null = null;
const pending: IncomingFile[][] = [];
let installed = false;

function deliver(files: IncomingFile[]) {
  if (files.length === 0) return;
  if (handler) handler(files);
  else pending.push(files);
}

async function readShareInbox(): Promise<IncomingFile[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARE_INBOX);
  const requests = await cache.keys();
  const files: IncomingFile[] = [];
  for (const request of requests) {
    const response = await cache.match(request);
    await cache.delete(request);
    if (!response) continue;
    const encoded = response.headers.get('X-File-Name');
    const name = encoded ? decodeURIComponent(encoded) : 'Mappa condivisa.xmind';
    files.push({ name, bytes: new Uint8Array(await response.arrayBuffer()) });
  }
  return files;
}

async function readLaunchedFiles(params: LaunchParams): Promise<IncomingFile[]> {
  const files: IncomingFile[] = [];
  for (const entry of params.files) {
    if (entry.kind !== 'file') continue;
    const handle = entry as FileSystemFileHandle;
    const file = await handle.getFile();
    files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle });
  }
  return files;
}

/** Da chiamare una volta all'avvio, prima del render: aggancia le due sorgenti. */
export function installIncomingFiles() {
  if (installed) return;
  installed = true;

  window.launchQueue?.setConsumer((params) => {
    readLaunchedFiles(params).then(deliver, (err: unknown) => {
      console.warn('File aperto dal sistema non leggibile:', err);
    });
  });

  const url = new URL(location.href);
  if (url.searchParams.has(SHARED_PARAM)) {
    // Toglie il parametro: un ricarica non deve riaprire la condivisione.
    url.searchParams.delete(SHARED_PARAM);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    readShareInbox().then(deliver, (err: unknown) => {
      console.warn('File condiviso non leggibile:', err);
    });
  }
}

/** Riceve i file in arrivo, compresi quelli giunti prima della chiamata. */
export function subscribeIncomingFiles(next: IncomingFilesHandler): () => void {
  handler = next;
  while (pending.length > 0) {
    const files = pending.shift();
    if (files) next(files);
  }
  return () => {
    if (handler === next) handler = null;
  };
}
