import { contextBridge, ipcRenderer, webFrame } from 'electron';

/** Esito di un salvataggio sotto guardia (vedi `guardedSave` in @xmap/core/node). */
export type SaveOutcome =
  | { ok: true; backup?: string; bytes: number }
  | { ok: false; code: string; message: string; processes?: string[] };

export type SaveBytesOutcome =
  | { path: string }
  | { ok: false; code: string; message: string; processes?: string[]; path: string };

/** Esito del controllo aggiornamenti (vedi `updater.ts`). */
export type UpdateOutcome =
  | { status: 'unsupported'; message: string }
  | { status: 'upToDate'; version: string }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'error'; message: string };

/** File letto dal main process; `bytes` arriva come Uint8Array (structured clone di IPC). */
/** Formato del PDF: carta standard oppure dimensioni personalizzate in mm (pagina grande quanto la mappa). */
export type PrintToPdfOptions = {
  pageSize: 'A4' | 'A3' | { widthMm: number; heightMm: number };
  landscape: boolean;
};
export type OpenedFile = { path: string; name: string; bytes: Uint8Array };

export interface ElectronAPI {
  /** Windows: controlla GitHub e scarica l'exe portable più recente nei Download. */
  checkAndDownloadUpdate: () => Promise<UpdateOutcome>;
  platform: () => Promise<string>;
  openFileDialog: () => Promise<OpenedFile | null>;
  openFilePath: (filePath: string) => Promise<OpenedFile | null>;
  openFile: (options?: {
    description?: string;
    extensions?: string[];
  }) => Promise<OpenedFile | null>;
  saveFileDialog: (suggestedName?: string) => Promise<string | null>;
  saveBytes: (
    suggestedName: string,
    bytes: Uint8Array,
    options?: {
      description?: string;
      extensions?: string[];
      targetPath?: string;
      force?: boolean;
    }
  ) => Promise<SaveBytesOutcome | null>;
  saveAtomic: (
    filePath: string,
    bytes: Uint8Array,
    options?: { expectedHash?: string; force?: boolean }
  ) => Promise<SaveOutcome>;
  checkXMindRunning: () => Promise<string[]>;
  printToPdf: (opts: PrintToPdfOptions) => Promise<Uint8Array>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  forceClose: () => void;
  isMaximized: () => Promise<boolean>;
  getInitialFile: () => Promise<string | null>;
  onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
  onBeforeClose: (callback: () => void) => () => void;
  /** Zoom di Chromium sulla pagina (Impostazioni > Scala interfaccia): 1 = 100%. */
  setZoomFactor: (factor: number) => void;
}

const api: ElectronAPI = {
  checkAndDownloadUpdate: () => ipcRenderer.invoke('update:checkAndDownload'),
  platform: () => ipcRenderer.invoke('app:platform'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openFilePath: (filePath: string) => ipcRenderer.invoke('fs:openPath', filePath),
  openFile: (options) => ipcRenderer.invoke('dialog:openAnyFile', options),
  saveFileDialog: (suggestedName?: string) => ipcRenderer.invoke('dialog:saveFile', suggestedName),
  saveBytes: (suggestedName, bytes, options) =>
    ipcRenderer.invoke('dialog:saveBytes', suggestedName, bytes, options),
  saveAtomic: (filePath, bytes, options) =>
    ipcRenderer.invoke('fs:saveAtomic', filePath, bytes, options),
  checkXMindRunning: () => ipcRenderer.invoke('safety:checkXMind'),
  printToPdf: (opts) => ipcRenderer.invoke('print:toPdf', opts),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  forceClose: () => ipcRenderer.send('window:forceClose'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getInitialFile: () => ipcRenderer.invoke('app:getInitialFile'),
  onMaximizedChange: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, isMax: boolean) => callback(isMax);
    ipcRenderer.on('window:maximizedChanged', handler);
    return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
  },
  onBeforeClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:beforeClose', handler);
    return () => ipcRenderer.removeListener('app:beforeClose', handler);
  },
  setZoomFactor: (factor) => {
    if (Number.isFinite(factor) && factor > 0) webFrame.setZoomFactor(factor);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
