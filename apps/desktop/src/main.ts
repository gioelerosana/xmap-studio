import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import type { GuardedSaveResult } from '@xmap/core/node';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cancelRestartRequest, registerUpdater, relaunchIfRequested } from './updater.js';
import type { PrintToPdfOptions } from './preload.js';

// @xmap/core è solo ESM e questo processo è CommonJS: Electron 34 (Node 20) non
// può fare `require()` di un modulo ESM, quindi lo carichiamo con import()
// dinamico, una sola volta e solo quando serve.
type Core = typeof import('@xmap/core/node');
let corePromise: Promise<Core> | null = null;
function loadCore(): Promise<Core> {
  corePromise ??= import('@xmap/core/node');
  return corePromise;
}

const MM_PER_INCH = 25.4;
const DEV_SERVER_URL = 'http://localhost:3000';
const DEV_SERVER_ORIGIN = new URL(DEV_SERVER_URL).origin;
const webDistPath = path.resolve(__dirname, '../../web/dist/index.html');
const webDistPrefix = pathToFileURL(`${path.dirname(webDistPath)}${path.sep}`).href;
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 520;
const ERR_ABORTED = -3;
const DARK_BACKGROUND = '#0a0a0a';
const LIGHT_BACKGROUND = '#fcfcfc';
const MAX_BYTE = 255;
/**
 * Accetta "mappa.xmind" e "MAPPA.XMIND"; rifiuta "mappa.xmap" e "mappa.xmind.bak".
 * Verifica: https://regex101.com/?regex=%5C.xmind%24&flags=i
 */
const XMIND_EXTENSION = /\.xmind$/i;
const initialFiles = new Map<number, string | null>();
const allowedCloseIds = new Set<number>();
/**
 * Percorso scelto nel dialogo di `dialog:saveBytes` e rifiutato perché XMind è
 * aperto: è l'unico `targetPath` che il renderer può ripresentare con `force`,
 * così non può far scrivere il main process in un percorso arbitrario.
 */
const pendingForcedSaves = new Map<number, string>();
const startupFiles = findXmindFiles(process.argv);
const startupFile = startupFiles.shift() ?? null;
const queuedFiles: string[] = startupFiles;

function findXmindFiles(args: string[]): string[] {
  return args
    .filter((arg) => XMIND_EXTENSION.test(arg) && fs.existsSync(arg))
    .map((arg) => path.resolve(arg));
}

// Ogni workbook ha una finestra e uno stato React indipendenti.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_, commandLine) => {
    const files = commandLine
      .filter((arg) => XMIND_EXTENSION.test(arg) && fs.existsSync(arg))
      .map((arg) => path.resolve(arg));
    if (files.length > 0) {
      if (app.isReady()) {
        files.forEach((file) => createWindow(file));
      } else {
        queuedFiles.push(...files);
      }
    } else {
      const windows = BrowserWindow.getAllWindows();
      windows[windows.length - 1]?.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) createWindow(filePath);
    else queuedFiles.push(path.resolve(filePath));
  });

  void openStartupWindows();
}

async function openStartupWindows(): Promise<void> {
  await app.whenReady();
  // Con file in coda (macOS `open-file` all'avvio) la finestra vuota è superflua.
  if (startupFile !== null || queuedFiles.length === 0) createWindow(startupFile);
  queuedFiles.splice(0).forEach((file) => createWindow(file));
}

function isAppUrl(url: string): boolean {
  if (URL.canParse(url) && new URL(url).origin === DEV_SERVER_ORIGIN) return true;
  return url.startsWith(webDistPrefix);
}

/** Apre nel browser o nel client di posta solo i link web e mail; il resto viene ignorato. */
async function openExternalUrl(url: string): Promise<void> {
  if (!URL.canParse(url) || !EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) return;
  try {
    await shell.openExternal(url);
  } catch (error: unknown) {
    console.warn('[xmap] apertura del link esterno non riuscita:', error);
  }
}

/** Un caricamento fallito non deve far cadere il main process: la UI gestisce il resto in `did-fail-load`. */
async function loadSafely(load: Promise<void>): Promise<void> {
  try {
    await load;
  } catch (error: unknown) {
    console.warn('[xmap] caricamento della UI non riuscito:', error);
  }
}

function createWindow(initialFile: string | null = null): BrowserWindow {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const id = window.webContents.id;
  initialFiles.set(id, initialFile);
  window.once('ready-to-show', () => window.show());

  // I link esterni si aprono nel browser di sistema, mai in una nuova finestra dell'app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  // La conferma di chiusura è già gestita dal main process (evento 'close' →
  // 'app:beforeClose' → dialog nel renderer), quindi il beforeunload del
  // renderer non deve bloccare la chiusura.
  window.webContents.on('will-prevent-unload', (event) => event.preventDefault());

  // Senza renderer caricato nessuno risponderebbe a `app:beforeClose` e la
  // finestra non si chiuderebbe più: la conferma si chiede solo a UI pronta.
  let rendererReady = false;
  window.webContents.on('did-finish-load', () => {
    rendererReady = true;
  });
  // Renderer morto: nessuno risponderebbe più a `app:beforeClose`, quindi la finestra deve poter chiudersi.
  window.webContents.on('render-process-gone', () => {
    rendererReady = false;
  });

  // Chiede conferma al renderer prima di chiudere, per non perdere modifiche.
  window.on('close', (event) => {
    if (allowedCloseIds.has(id) || !rendererReady) return;
    event.preventDefault();
    window.webContents.send('app:beforeClose');
  });

  window.on('maximize', () => window.webContents.send('window:maximizedChanged', true));
  window.on('unmaximize', () => window.webContents.send('window:maximizedChanged', false));
  window.on('closed', () => {
    initialFiles.delete(id);
    allowedCloseIds.delete(id);
    pendingForcedSaves.delete(id);
  });

  // Se il server di sviluppo non risponde si ripiega sulla UI compilata; se
  // fallisce anche quella la finestra si mostra comunque, invece di restare
  // nascosta in attesa di un `ready-to-show` che non arriverà.
  window.webContents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    // ERR_ABORTED: navigazione sostituita da un'altra, non è un errore.
    if (!isMainFrame || errorCode === ERR_ABORTED) return;
    if (url.startsWith(DEV_SERVER_URL) && fs.existsSync(webDistPath)) {
      console.warn(`[xmap] ${DEV_SERVER_URL} non raggiungibile, carico ${webDistPath}`);
      void loadSafely(window.loadFile(webDistPath));
      return;
    }
    window.show();
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  const loading =
    !isDev && fs.existsSync(webDistPath) ? window.loadFile(webDistPath) : window.loadURL(DEV_SERVER_URL);
  void loadSafely(loading);

  return window;
}

function windowBackground(dark = nativeTheme.shouldUseDarkColors): string {
  return dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

/*
 * Tema «Sistema» sul desktop: quando cambia l'aspetto del sistema si avvisano i
 * renderer, che rileggono `prefers-color-scheme` anche se l'evento `change` non
 * arriva. `nativeTheme.themeSource` non si tocca: su Linux, una volta forzato,
 * tornare a 'system' lascia Electron fermo sul tema forzato.
 */
nativeTheme.on('updated', () => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('theme:updated', nativeTheme.shouldUseDarkColors);
  }
});

// Sfondo nativo della finestra (visibile ridimensionando) allineato al tema effettivo dell'app.
ipcMain.on('theme:setDark', (event, dark: unknown) => {
  if (typeof dark !== 'boolean') return;
  senderWindow(event)?.setBackgroundColor(windowBackground(dark));
});

function senderWindow(event: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Byte da inviare al renderer: la copia ha un ArrayBuffer di dimensione esatta (un Buffer può essere una vista su un pool più grande). */
function toIpcBytes(buffer: Uint8Array): Uint8Array {
  return new Uint8Array(buffer);
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_BYTE;
}

/** Byte ricevuti dal renderer: Uint8Array (formato attuale) o array di numeri (compatibilità). */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every(isByte)) return Uint8Array.from(value);
  throw new Error('Dati del file non validi: attesi byte.');
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && path.isAbsolute(value);
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    // File inesistente o non accessibile: per il chiamante non è un file apribile.
    return false;
  }
}

async function readFileForRenderer(filePath: string) {
  const buffer = await fs.promises.readFile(filePath);
  return { path: filePath, name: path.basename(filePath), bytes: toIpcBytes(buffer) };
}

// IPC handlers
registerUpdater();
ipcMain.handle('app:getInitialFile', (event) => {
  const id = event.sender.id;
  const filePath = initialFiles.get(id) ?? null;
  initialFiles.delete(id);
  return filePath;
});

ipcMain.handle('app:platform', () => process.platform);

ipcMain.handle('safety:checkXMind', async () => (await loadCore()).xmindProcesses());

ipcMain.handle('dialog:openFile', async (event) => {
  const owner = senderWindow(event);
  if (!owner) return null;
  const result = await dialog.showOpenDialog(owner, {
    properties: ['openFile'],
    filters: [{ name: 'XMind Map', extensions: ['xmind'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readFileForRenderer(result.filePaths[0]);
});

// Usato solo per il file passato all'avvio (sempre `.xmind`): niente letture di file arbitrari.
ipcMain.handle('fs:openPath', async (_, filePath: unknown) => {
  if (!isAbsolutePath(filePath) || !XMIND_EXTENSION.test(filePath) || !isRegularFile(filePath)) return null;
  return readFileForRenderer(filePath);
});

/**
 * Aggiunge `.xmind` a un percorso scelto senza estensione. Il dialogo di sistema
 * ha chiesto conferma solo per il nome senza estensione: se il file con
 * l'estensione esiste già, la sovrascrittura va confermata qui. `null` = annullato.
 */
async function withXmindExtension(owner: BrowserWindow, filePath: string): Promise<string | null> {
  if (XMIND_EXTENSION.test(filePath)) return filePath;
  const target = `${filePath}.xmind`;
  if (!fs.existsSync(target)) return target;
  const { response } = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: ['Sostituisci', 'Annulla'],
    defaultId: 1,
    cancelId: 1,
    title: 'Sostituire il file?',
    message: `«${path.basename(target)}» esiste già.`,
    detail: 'Sostituendolo, il contenuto attuale verrà sovrascritto (resta un backup).',
  });
  return response === 0 ? target : null;
}

ipcMain.handle('dialog:saveFile', async (event, suggestedName?: string) => {
  const owner = senderWindow(event);
  if (!owner) return null;
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: suggestedName || 'mappa.xmind',
    filters: [{ name: 'XMind Map', extensions: ['xmind'] }],
  });
  if (result.canceled || !result.filePath) return null;
  // Su Linux il dialogo GTK non aggiunge l'estensione del filtro: senza, `fs:saveAtomic` rifiuterebbe il percorso.
  return withXmindExtension(owner, result.filePath);
});

/** Estensioni dei filtri dei dialoghi: solo stringhe non vuote, senza punto iniziale. */
function sanitizeExtensions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const extensions = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/^\./, '').trim())
    .filter((item) => item !== '');
  return extensions.length > 0 ? extensions : undefined;
}

ipcMain.handle(
  'dialog:openAnyFile',
  async (event, options?: { description?: string; extensions?: string[] }) => {
    const owner = senderWindow(event);
    if (!owner) return null;
    // Senza estensioni (es. "Allega file") si accetta qualunque file, non solo i `.xmind`.
    const extensions = sanitizeExtensions(options?.extensions) ?? ['*'];
    const result = await dialog.showOpenDialog(owner, {
      properties: ['openFile'],
      filters: [{ name: options?.description || 'File', extensions }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return readFileForRenderer(result.filePaths[0]);
  }
);

ipcMain.handle(
  'dialog:saveBytes',
  async (
    event,
    suggestedName: string,
    bytesValue: unknown,
    options?: {
      description?: string;
      extensions?: string[];
      /** Percorso già scelto (ripetizione dopo conferma "forza"): salta il dialogo. */
      targetPath?: string;
      force?: boolean;
    }
  ) => {
    const owner = senderWindow(event);
    if (!owner) return null;
    const bytes = toBytes(bytesValue);
    const extensions = sanitizeExtensions(options?.extensions) ?? ['bin'];
    const ownerId = owner.webContents.id;
    let outputPath: string | undefined;
    if (options?.targetPath !== undefined) {
      // Ripetizione dopo la conferma "forza": vale solo il percorso appena rifiutato per XMind aperto.
      const pending = pendingForcedSaves.get(ownerId);
      pendingForcedSaves.delete(ownerId);
      if (pending === undefined || pending !== options.targetPath) {
        throw new Error('Percorso di salvataggio non valido: ripeti il salvataggio.');
      }
      outputPath = pending;
    }
    if (!outputPath) {
      const result = await dialog.showSaveDialog(owner, {
        defaultPath: typeof suggestedName === 'string' ? suggestedName : undefined,
        filters: [{ name: options?.description || 'File', extensions }],
      });
      if (result.canceled || !result.filePath) return null;
      outputPath = result.filePath;
    }
    const writesXmind = extensions.some((extension) => extension.toLowerCase() === 'xmind');
    if (writesXmind && !outputPath.toLowerCase().endsWith('.xmind')) {
      const confirmed = await withXmindExtension(owner, outputPath);
      if (!confirmed) return null;
      outputPath = confirmed;
    }
    if (writesXmind || outputPath.toLowerCase().endsWith('.xmind')) {
      const { guardedSave } = await loadCore();
      const res = await guardedSave(outputPath, bytes, { force: options?.force === true });
      if (!res.ok && res.code === 'xmind_running') pendingForcedSaves.set(ownerId, outputPath);
      return res.ok ? { path: outputPath } : { ...res, path: outputPath };
    }
    // Asincrono: un export grande (PNG, PDF) non deve bloccare il main process e tutte le finestre.
    await fs.promises.writeFile(outputPath, bytes);
    return { path: outputPath };
  }
);

ipcMain.on('window:forceClose', (event) => {
  const window = senderWindow(event);
  if (!window) return;
  allowedCloseIds.add(window.webContents.id);
  window.close();
});

// Chiusura annullata dall'utente: un eventuale «Riavvia per aggiornare» decade.
ipcMain.on('window:closeCancelled', () => cancelRestartRequest());

// L'IPC di Electron perde le proprietà custom degli errori: l'esito è un
// valore discriminato ({ ok, code, message, processes }), non un'eccezione.
ipcMain.handle(
  'fs:saveAtomic',
  async (
    _,
    filePath: unknown,
    bytesValue: unknown,
    options?: { expectedHash?: string; force?: boolean }
  ): Promise<GuardedSaveResult> => {
    if (!isAbsolutePath(filePath) || !filePath.toLowerCase().endsWith('.xmind')) {
      return {
        ok: false,
        code: 'invalid_input',
        message: 'Percorso di salvataggio non valido: serve un file .xmind con percorso assoluto.',
      };
    }
    const bytes = toBytes(bytesValue);
    const { guardedSave } = await loadCore();
    return guardedSave(filePath, bytes, {
      expectedHash: options?.expectedHash,
      force: options?.force === true,
    });
  }
);

// Stampa su file PDF della finestra mittente
ipcMain.handle(
  'print:toPdf',
  async (event, opts: PrintToPdfOptions) => {
    const owner = senderWindow(event);
    const target = owner?.webContents ?? event.sender;
    const buffer = await target.printToPDF({
      pageSize:
        typeof opts.pageSize === 'string'
          ? opts.pageSize
          : { width: opts.pageSize.widthMm / MM_PER_INCH, height: opts.pageSize.heightMm / MM_PER_INCH },
      landscape: opts.landscape,
      printBackground: true,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    });
    return toIpcBytes(buffer);
  }
);

// Controlli finestra CSD, indirizzati alla finestra che ha inviato il messaggio.
ipcMain.on('window:minimize', (event) => senderWindow(event)?.minimize());

ipcMain.on('window:maximize', (event) => {
  const window = senderWindow(event);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on('window:close', (event) => senderWindow(event)?.close());
ipcMain.handle('window:isMaximized', (event) => senderWindow(event)?.isMaximized() ?? false);

app.on('window-all-closed', () => {
  if (relaunchIfRequested()) return;
  if (process.platform !== 'darwin') app.quit();
});
