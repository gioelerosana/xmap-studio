import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { checkAndDownloadUpdate } from './updater.js';

// @xmap/core è solo ESM e questo processo è CommonJS: Electron 34 (Node 20) non
// può fare `require()` di un modulo ESM, quindi lo carichiamo con import()
// dinamico, una sola volta e solo quando serve.
type Core = typeof import('@xmap/core/node');
let corePromise: Promise<Core> | null = null;
function loadCore(): Promise<Core> {
  corePromise ??= import('@xmap/core/node');
  return corePromise;
}

const DEV_SERVER_URL = 'http://localhost:3000';
const initialFiles = new Map<number, string | null>();
const allowedCloseIds = new Set<number>();
const startupFiles = findXmindFiles(process.argv);
const startupFile = startupFiles.shift() ?? null;
const queuedFiles: string[] = startupFiles;

function findXmindFiles(args: string[]): string[] {
  return args
    .filter((arg) => /\.xmind$/i.test(arg) && fs.existsSync(arg))
    .map((arg) => path.resolve(arg));
}

// Ogni workbook ha una finestra e uno stato React indipendenti.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_, commandLine) => {
    const files = commandLine
      .filter((arg) => /\.xmind$/i.test(arg) && fs.existsSync(arg))
      .map((arg) => path.resolve(arg));
    if (files.length > 0) {
      if (app.isReady()) {
        for (const file of files) createWindow(file);
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

  app.whenReady().then(() => {
    createWindow(startupFile);
    for (const file of queuedFiles.splice(0)) createWindow(file);
  });
}

function createWindow(initialFile: string | null = null): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#fcfcfc',
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
  });

  const webDistPath = path.resolve(__dirname, '../../web/dist/index.html');
  // Se il server di sviluppo non risponde si ripiega sulla UI compilata; se
  // fallisce anche quella la finestra si mostra comunque, invece di restare
  // nascosta in attesa di un `ready-to-show` che non arriverà.
  window.webContents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED: navigazione sostituita */) return;
    if (url.startsWith(DEV_SERVER_URL) && fs.existsSync(webDistPath)) {
      console.warn(`[xmap] ${DEV_SERVER_URL} non raggiungibile, carico ${webDistPath}`);
      void window.loadFile(webDistPath);
      return;
    }
    window.show();
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (!isDev && fs.existsSync(webDistPath)) void window.loadFile(webDistPath);
  else void window.loadURL(DEV_SERVER_URL);

  return window;
}

function senderWindow(event: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

// IPC handlers
ipcMain.handle('app:getInitialFile', (event) => {
  const id = event.sender.id;
  const filePath = initialFiles.get(id) ?? null;
  initialFiles.delete(id);
  return filePath;
});

ipcMain.handle('update:checkAndDownload', () => checkAndDownloadUpdate());
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
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return { path: filePath, name: path.basename(filePath), bytes: Array.from(buffer) };
});

ipcMain.handle('fs:openPath', async (_, filePath: string) => {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return { path: filePath, name: path.basename(filePath), bytes: Array.from(buffer) };
});

ipcMain.handle('dialog:saveFile', async (event, suggestedName?: string) => {
  const owner = senderWindow(event);
  if (!owner) return null;
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: suggestedName || 'mappa.xmind',
    filters: [{ name: 'XMind Map', extensions: ['xmind'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle(
  'dialog:openAnyFile',
  async (event, options?: { description?: string; extensions?: string[] }) => {
    const owner = senderWindow(event);
    if (!owner) return null;
    const extensions = options?.extensions ?? ['xmind'];
    const result = await dialog.showOpenDialog(owner, {
      properties: ['openFile'],
      filters: [{ name: options?.description || 'File', extensions }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    return { path: filePath, name: path.basename(filePath), bytes: Array.from(buffer) };
  }
);

ipcMain.handle(
  'dialog:saveBytes',
  async (
    event,
    suggestedName: string,
    bytesArr: number[],
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
    const extensions = options?.extensions ?? ['bin'];
    let outputPath = options?.targetPath;
    if (!outputPath) {
      const result = await dialog.showSaveDialog(owner, {
        defaultPath: suggestedName,
        filters: [{ name: options?.description || 'File', extensions }],
      });
      if (result.canceled || !result.filePath) return null;
      outputPath = result.filePath;
    }
    const bytes = new Uint8Array(bytesArr);
    const writesXmind = extensions.some((extension) => extension.toLowerCase() === 'xmind');
    if (writesXmind && !outputPath.toLowerCase().endsWith('.xmind')) {
      outputPath += '.xmind';
    }
    if (writesXmind || outputPath.toLowerCase().endsWith('.xmind')) {
      const { guardedSave } = await loadCore();
      const res = await guardedSave(outputPath, bytes, { force: options?.force === true });
      return res.ok ? { path: outputPath } : { ...res, path: outputPath };
    }
    fs.writeFileSync(outputPath, Buffer.from(bytes));
    return { path: outputPath };
  }
);

ipcMain.on('window:forceClose', (event) => {
  const window = senderWindow(event);
  if (!window) return;
  allowedCloseIds.add(window.webContents.id);
  window.close();
});

// L'IPC di Electron perde le proprietà custom degli errori: l'esito è un
// valore discriminato ({ ok, code, message, processes }), non un'eccezione.
ipcMain.handle(
  'fs:saveAtomic',
  async (_, filePath: string, bytesArr: number[], options?: { expectedHash?: string; force?: boolean }) => {
    const { guardedSave } = await loadCore();
    return guardedSave(filePath, new Uint8Array(bytesArr), {
      expectedHash: options?.expectedHash,
      force: options?.force === true,
    });
  }
);

// Stampa su file PDF della finestra mittente
ipcMain.handle(
  'print:toPdf',
  async (event, opts: { pageSize: 'A4' | 'A3'; landscape: boolean }) => {
    const owner = senderWindow(event);
    const target = owner?.webContents ?? event.sender;
    const buffer = await target.printToPDF({
      pageSize: opts.pageSize,
      landscape: opts.landscape,
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    });
    return Array.from(buffer);
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
  if (process.platform !== 'darwin') app.quit();
});
