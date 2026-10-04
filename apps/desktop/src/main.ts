import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { atomicWrite, xmindProcesses } from '@xmap/core';

let mainWindow: BrowserWindow | null = null;
let initialFilePath: string | null = null;

// Gestione file da riga di comando (es. doppio clic su .xmind)
for (let i = 1; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.endsWith('.xmind') && fs.existsSync(arg)) {
    initialFilePath = path.resolve(arg);
    break;
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      for (let i = 1; i < commandLine.length; i++) {
        const arg = commandLine[i];
        if (arg.endsWith('.xmind') && fs.existsSync(arg)) {
          const resolved = path.resolve(arg);
          mainWindow.webContents.send('app:openFile', resolved);
          break;
        }
      }
    }
  });

  app.whenReady().then(createWindow);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    frame: false, // Frameless Client-Side Decorations (Adwaita CSD)
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#242424' : '#fafafa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizedChanged', false);
  });

  // Carica la web app
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const webDistPath = path.resolve(__dirname, '../../web/dist/index.html');
    if (fs.existsSync(webDistPath)) {
      mainWindow.loadFile(webDistPath);
    } else {
      mainWindow.loadURL('http://localhost:3000');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('app:getInitialFile', () => initialFilePath);

ipcMain.handle('safety:checkXMind', async () => {
  return await xmindProcesses();
});

ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'XMind Map', extensions: ['xmind'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: Array.from(buffer),
  };
});

ipcMain.handle('fs:openPath', async (_, filePath: string) => {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: Array.from(buffer),
  };
});

ipcMain.handle('dialog:saveFile', async (_, suggestedName?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName || 'mappa.xmind',
    filters: [{ name: 'XMind Map', extensions: ['xmind'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('fs:saveAtomic', async (_, filePath: string, bytesArr: number[]) => {
  const bytes = new Uint8Array(bytesArr);
  const report = await atomicWrite(filePath, bytes, true);
  return {
    backup: report.backup,
    bytes: report.bytesWritten,
  };
});

// Controlli Finestra CSD
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
