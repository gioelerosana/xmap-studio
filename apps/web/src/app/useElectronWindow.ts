import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppController } from '@xmap/core';
import type { CloseAction } from './useWorkbookFiles.js';

interface ElectronWindowOptions {
  isElectron: boolean;
  controller: AppController;
  openInitialFile: (filePath: string) => Promise<void>;
  setClosePrompt: Dispatch<SetStateAction<CloseAction>>;
}

/** Ponte con la shell Electron: stato massimizzato, file aperto dal sistema, chiusura finestra. */
export function useElectronWindow({ isElectron, controller, openInitialFile, setClosePrompt }: ElectronWindowOptions): boolean {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    window.electronAPI.isMaximized().then(setIsWindowMaximized);
    return window.electronAPI.onMaximizedChange(setIsWindowMaximized);
  }, [isElectron]);

  // File iniziale + aperture successive (Electron)
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    void window.electronAPI.getInitialFile().then((p) => {
      if (p) void openInitialFile(p);
    });
  }, [isElectron, openInitialFile]);

  // Chiusura con modifiche non salvate
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    return window.electronAPI.onBeforeClose(() => {
      if (controller.isDirty()) setClosePrompt('confirm');
      else window.electronAPI?.forceClose();
    });
  }, [isElectron, controller, setClosePrompt]);

  return isWindowMaximized;
}
