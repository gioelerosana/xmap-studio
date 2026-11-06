import { contextBridge, ipcRenderer, webFrame } from 'electron';

/** Esito di un salvataggio sotto guardia (vedi `guardedSave` in @xmap/core/node). */
export type SaveOutcome =
  | { ok: true; backup?: string; bytes: number }
  | { ok: false; code: string; message: string; processes?: string[] };

export type SaveBytesOutcome =
  | { path: string }
  | { ok: false; code: string; message: string; processes?: string[]; path: string };

/**
 * Aggiornamenti (vedi `updater.ts`). Lo stato vive nel main process ed è
 * unico per tutta l'app: ogni finestra lo riceve con `onUpdateStatus`.
 *
 * - `appimage`: AppImage avviata da un file scrivibile, si aggiorna in place con zsync;
 * - `portable`: exe portable di Windows, la nuova versione si scarica accanto alla vecchia;
 * - `manual`: altre installazioni (pacchetto Arch, sviluppo): si segnala soltanto.
 */
export type UpdateInstallMode = 'appimage' | 'portable' | 'manual';

export type UpdateRelease = {
  /** "26.3.0", senza prefisso. */
  version: string;
  /** "v26.3.0". */
  tag: string;
  /** Pagina della release su GitHub. */
  url: string;
  /** Note della release (Markdown di GitHub), eventualmente vuote. */
  notes: string;
  publishedAt: string | null;
};

export type UpdateStep = 'scanning' | 'downloading' | 'verifying' | 'installing';

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate'; latestVersion: string }
  | { phase: 'available'; release: UpdateRelease }
  /** `progress` da 0 a 1, `null` se non stimabile. */
  | { phase: 'downloading'; release: UpdateRelease; step: UpdateStep; progress: number | null }
  /** Installata (AppImage) o scaricata (exe in `path`): si applica al riavvio. */
  | { phase: 'ready'; release: UpdateRelease; path: string; downloadedBytes: number; reusedBytes: number }
  | { phase: 'error'; message: string; release: UpdateRelease | null };

export type UpdateStatus = {
  currentVersion: string;
  mode: UpdateInstallMode;
  /** Controllo automatico all'avvio e ogni poche ore. */
  autoCheck: boolean;
  /** Ultimo controllo riuscito (ms dall'epoch). */
  lastCheckedAt: number | null;
  state: UpdateState;
};

/** File letto dal main process; `bytes` arriva come Uint8Array (structured clone di IPC). */
/** Formato del PDF: carta standard oppure dimensioni personalizzate in mm (pagina grande quanto la mappa). */
export type PrintToPdfOptions = {
  pageSize: 'A4' | 'A3' | { widthMm: number; heightMm: number };
  landscape: boolean;
};
export type OpenedFile = { path: string; name: string; bytes: Uint8Array };

export interface ElectronAPI {
  getUpdateStatus: () => Promise<UpdateStatus>;
  /** Controlla l'ultima release su GitHub. */
  checkForUpdates: () => Promise<UpdateStatus>;
  /** AppImage: aggiorna in place con zsync; exe portable: scarica la nuova versione. */
  installUpdate: () => Promise<UpdateStatus>;
  /** Chiude le finestre (con la solita conferma per le modifiche) e riavvia sulla nuova versione. */
  restartToUpdate: () => void;
  setUpdateAutoCheck: (enabled: boolean) => Promise<UpdateStatus>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
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
  /** La chiusura chiesta dal main process è stata annullata dall'utente. */
  cancelClose: () => void;
  isMaximized: () => Promise<boolean>;
  getInitialFile: () => Promise<string | null>;
  onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
  onBeforeClose: (callback: () => void) => () => void;
  /** Zoom di Chromium sulla pagina (Impostazioni > Scala interfaccia): 1 = 100%. */
  setZoomFactor: (factor: number) => void;
  /** Tema effettivo dell'app: allinea lo sfondo nativo della finestra. */
  setDarkMode: (dark: boolean) => void;
  /** Avvisa quando cambia l'aspetto del sistema (`nativeTheme` di Electron). */
  onThemeUpdated: (callback: (dark: boolean) => void) => () => void;
}

const api: ElectronAPI = {
  getUpdateStatus: () => ipcRenderer.invoke('update:getStatus'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  restartToUpdate: () => ipcRenderer.send('update:restart'),
  setUpdateAutoCheck: (enabled) => ipcRenderer.invoke('update:setAutoCheck', enabled),
  onUpdateStatus: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
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
  cancelClose: () => ipcRenderer.send('window:closeCancelled'),
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
  setDarkMode: (dark) => ipcRenderer.send('theme:setDark', dark),
  onThemeUpdated: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, dark: boolean) => callback(dark);
    ipcRenderer.on('theme:updated', handler);
    return () => ipcRenderer.removeListener('theme:updated', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
