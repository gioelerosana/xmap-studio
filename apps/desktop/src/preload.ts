import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  openFileDialog: () => Promise<{ path: string; name: string; bytes: number[] } | null>;
  openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: number[] } | null>;
  saveFileDialog: (suggestedName?: string) => Promise<string | null>;
  saveAtomic: (filePath: string, bytes: number[]) => Promise<{ backup?: string; bytes: number }>;
  checkXMindRunning: () => Promise<string[]>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  getInitialFile: () => Promise<string | null>;
  onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
}

const api: ElectronAPI = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openFilePath: (filePath: string) => ipcRenderer.invoke('fs:openPath', filePath),
  saveFileDialog: (suggestedName?: string) => ipcRenderer.invoke('dialog:saveFile', suggestedName),
  saveAtomic: (filePath: string, bytes: number[]) =>
    ipcRenderer.invoke('fs:saveAtomic', filePath, bytes),
  checkXMindRunning: () => ipcRenderer.invoke('safety:checkXMind'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getInitialFile: () => ipcRenderer.invoke('app:getInitialFile'),
  onMaximizedChange: (callback) => {
    const handler = (_: any, isMax: boolean) => callback(isMax);
    ipcRenderer.on('window:maximizedChanged', handler);
    return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
