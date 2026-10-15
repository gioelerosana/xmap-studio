import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  openFileDialog: () => Promise<{ path: string; name: string; bytes: number[] } | null>;
  openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: number[] } | null>;
  openFile: (options?: {
    description?: string;
    extensions?: string[];
  }) => Promise<{ path: string; name: string; bytes: number[] } | null>;
  saveFileDialog: (suggestedName?: string) => Promise<string | null>;
  saveBytes: (
    suggestedName: string,
    bytes: number[],
    options?: { description?: string; extensions?: string[] }
  ) => Promise<{ path: string } | null>;
  saveAtomic: (
    filePath: string,
    bytes: number[],
    expectedHash?: string
  ) => Promise<{ backup?: string; bytes: number }>;
  checkXMindRunning: () => Promise<string[]>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  forceClose: () => void;
  isMaximized: () => Promise<boolean>;
  getInitialFile: () => Promise<string | null>;
  onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
  onBeforeClose: (callback: () => void) => () => void;
}

const api: ElectronAPI = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openFilePath: (filePath: string) => ipcRenderer.invoke('fs:openPath', filePath),
  openFile: (options) => ipcRenderer.invoke('dialog:openAnyFile', options),
  saveFileDialog: (suggestedName?: string) => ipcRenderer.invoke('dialog:saveFile', suggestedName),
  saveBytes: (suggestedName, bytes, options) =>
    ipcRenderer.invoke('dialog:saveBytes', suggestedName, bytes, options),
  saveAtomic: (filePath: string, bytes: number[], expectedHash?: string) =>
    ipcRenderer.invoke('fs:saveAtomic', filePath, bytes, expectedHash),
  checkXMindRunning: () => ipcRenderer.invoke('safety:checkXMind'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  forceClose: () => ipcRenderer.send('window:forceClose'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getInitialFile: () => ipcRenderer.invoke('app:getInitialFile'),
  onMaximizedChange: (callback) => {
    const handler = (_: any, isMax: boolean) => callback(isMax);
    ipcRenderer.on('window:maximizedChanged', handler);
    return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
  },
  onBeforeClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:beforeClose', handler);
    return () => ipcRenderer.removeListener('app:beforeClose', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
