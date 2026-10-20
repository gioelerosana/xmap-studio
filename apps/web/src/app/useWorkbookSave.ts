import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { sha256HexAsync, type AppController, type WorkbookDto } from '@xmap/core';
import { saveLocalXmindFile, confirmForceSave } from '../adapters/fileSystem.js';
import type { AddToast } from './useToasts.js';
import { UNTITLED_FILE_NAME, sanitizeName } from './fileNames.js';

interface WorkbookSaveOptions {
  controller: AppController;
  workbook: WorkbookDto | null;
  fileHandle: FileSystemFileHandle | undefined;
  setFileHandle: Dispatch<SetStateAction<FileSystemFileHandle | undefined>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  isElectron: boolean;
  refreshState: () => void;
  addToast: AddToast;
}

/** Salvataggio della mappa (browser via File System Access, desktop via IPC con controllo XMind aperto). */
export function useWorkbookSave({
  controller,
  workbook,
  fileHandle,
  setFileHandle,
  setBusy,
  isElectron,
  refreshState,
  addToast,
}: WorkbookSaveOptions) {
  const writeWorkbook = useCallback(
    async (force: boolean, saveAs: boolean): Promise<boolean> => {
      if (!workbook) return false;
      setBusy(true);
      try {
        const { bytes, validation } = await controller.prepareArchiveBytes();
        const hasDesktopPath = isElectron && workbook.path !== null;
        const expectedHash =
          !saveAs && (hasDesktopPath || Boolean(fileHandle))
            ? controller.expectedFileHash()
            : undefined;
        const contentHash = await sha256HexAsync(bytes);
        const suggestedName =
          workbook.path === null && workbook.fileName === UNTITLED_FILE_NAME
            ? `${sanitizeName(controller.mapTitle() || 'mappa')}.xmind`
            : workbook.fileName || 'mappa.xmind';

        if (isElectron && window.electronAPI) {
          let savePath = workbook.path;
          if (saveAs || !savePath) {
            const selected = await window.electronAPI.saveFileDialog(suggestedName);
            if (!selected) return false;
            savePath = selected;
          }
          const payload = Array.from(bytes);
          let outcome = await window.electronAPI.saveAtomic(savePath, payload, { expectedHash, force });
          if (!outcome.ok && outcome.code === 'xmind_running') {
            if (!confirmForceSave(outcome.processes ?? [])) {
              addToast('warning', 'Salvataggio annullato.');
              return false;
            }
            outcome = await window.electronAPI.saveAtomic(savePath, payload, { expectedHash, force: true });
          }
          if (!outcome.ok) {
            addToast('error', `Errore durante il salvataggio: ${outcome.message}`);
            return false;
          }
          controller.markSaved(savePath, contentHash);
          refreshState();
          addToast('success', `Salvato (${bytes.length.toLocaleString('it-IT')} byte)`);
          return true;
        }

        const handle = await saveLocalXmindFile(
          bytes,
          suggestedName,
          saveAs ? undefined : fileHandle,
          expectedHash
        );
        if (handle) setFileHandle(handle);
        controller.markSaved(undefined, contentHash);
        refreshState();
        addToast('success', `Mappa salvata (${validation.resourceRefs} risorse registrate)`);
        return true;
      } catch (err: any) {
        addToast('error', `Errore durante il salvataggio: ${err.message}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [workbook, controller, fileHandle, isElectron, addToast, refreshState, setFileHandle, setBusy]
  );

  const handleSave = useCallback(async () => {
    if (!workbook) return;
    if (!workbook.dirty) {
      addToast('info', 'Nessuna modifica da salvare.');
      return;
    }
    await writeWorkbook(false, false);
  }, [workbook, writeWorkbook, addToast]);

  const handleSaveAs = useCallback(async () => {
    if (!workbook) return;
    await writeWorkbook(false, true);
  }, [workbook, writeWorkbook]);

  return { writeWorkbook, handleSave, handleSaveAs };
}
