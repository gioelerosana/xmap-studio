import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { atomicWrite, validateArchiveBytes, xmindProcesses } from '@xmap/core';

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#242424' : '#fafafa',
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

  // Chiede conferma al renderer prima di chiudere, per non perdere modifiche.
  window.on('close', (event) => {
    if (allowedCloseIds.has(id)) return;
    event.preventDefault();
    window.webContents.send('app:beforeClose');
  });

  window.on('maximize', () => window.webContents.send('window:maximizedChanged', true));
  window.on('unmaximize', () => window.webContents.send('window:maximizedChanged', false));
  window.on('closed', () => {
    initialFiles.delete(id);
    allowedCloseIds.delete(id);
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (isDev) {
    void window.loadURL('http://localhost:3000');
  } else {
    const webDistPath = path.resolve(__dirname, '../../web/dist/index.html');
    if (fs.existsSync(webDistPath)) void window.loadFile(webDistPath);
    else void window.loadURL('http://localhost:3000');
  }

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

ipcMain.handle('safety:checkXMind', async () => xmindProcesses());

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
    options?: { description?: string; extensions?: string[] }
  ) => {
    const owner = senderWindow(event);
    if (!owner) return null;
    const extensions = options?.extensions ?? ['bin'];
    const result = await dialog.showSaveDialog(owner, {
      defaultPath: suggestedName,
      filters: [{ name: options?.description || 'File', extensions }],
    });
    if (result.canceled || !result.filePath) return null;
    const bytes = new Uint8Array(bytesArr);
    const writesXmind = extensions.some((extension) => extension.toLowerCase() === 'xmind');
    let outputPath = result.filePath;
    if (writesXmind && !outputPath.toLowerCase().endsWith('.xmind')) {
      outputPath += '.xmind';
    }
    if (writesXmind || outputPath.toLowerCase().endsWith('.xmind')) {
      await validateArchiveBytes(bytes);
      await atomicWrite(outputPath, bytes, true);
    } else {
      fs.writeFileSync(outputPath, Buffer.from(bytes));
    }
    return { path: outputPath };
  }
);

ipcMain.on('window:forceClose', (event) => {
  const window = senderWindow(event);
  if (!window) return;
  allowedCloseIds.add(window.webContents.id);
  window.close();
});

ipcMain.handle(
  'fs:saveAtomic',
  async (_, filePath: string, bytesArr: number[], expectedHash?: string) => {
    const bytes = new Uint8Array(bytesArr);
    await validateArchiveBytes(bytes);
    const report = await atomicWrite(filePath, bytes, true, expectedHash);
    return { backup: report.backup, bytes: report.bytesWritten };
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
