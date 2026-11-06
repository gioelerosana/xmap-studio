import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { sha256HexAsync, type AppController, type NextcloudAccount, type NextcloudEntry, type WorkbookDto } from '@xmap/core';
import { saveLocalXmindFile, confirmForceSave } from '../adapters/fileSystem.js';
import { nextcloudClient, type NextcloudFileRef } from '../adapters/nextcloud.js';
import type { AddToast } from './useToasts.js';
import { UNTITLED_FILE_NAME, sanitizeName } from './fileNames.js';

interface WorkbookSaveOptions {
  controller: AppController;
  workbook: WorkbookDto | null;
  fileHandle: FileSystemFileHandle | undefined;
  setFileHandle: Dispatch<SetStateAction<FileSystemFileHandle | undefined>>;
  /** File su Nextcloud da cui viene la mappa: "Salva" lo riscrive lì. */
  cloudFile: NextcloudFileRef | undefined;
  setCloudFile: Dispatch<SetStateAction<NextcloudFileRef | undefined>>;
  nextcloudAccount: NextcloudAccount | null;
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
  cloudFile,
  setCloudFile,
  nextcloudAccount,
  setBusy,
  isElectron,
  refreshState,
  addToast,
}: WorkbookSaveOptions) {
  // Un salvataggio alla volta: due scritture sovrapposte dello stesso file
  // supererebbero entrambe il controllo dell'hash.
  const savingRef = useRef(false);
  const writeWorkbook = useCallback(
    async (force: boolean, saveAs: boolean): Promise<boolean> => {
      if (!workbook || savingRef.current) return false;
      savingRef.current = true;
      setBusy(true);
      try {
        const { bytes, validation, revision } = await controller.prepareArchiveBytes();
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
          let outcome = await window.electronAPI.saveAtomic(savePath, bytes, { expectedHash, force });
          if (!outcome.ok && outcome.code === 'xmind_running') {
            if (!confirmForceSave(outcome.processes ?? [])) {
              addToast('warning', 'Salvataggio annullato.');
              return false;
            }
            outcome = await window.electronAPI.saveAtomic(savePath, bytes, { expectedHash, force: true });
          }
          if (!outcome.ok) {
            addToast('error', `Errore durante il salvataggio: ${outcome.message}`);
            return false;
          }
          controller.markSaved(savePath, contentHash, revision);
          refreshState();
          addToast('success', `Salvato (${bytes.length.toLocaleString('it-IT')} byte)`);
          return true;
        }

        // Mappa aperta da Nextcloud: si riscrive lì, solo se nessuno l'ha cambiata nel frattempo (If-Match).
        if (!saveAs && cloudFile && nextcloudAccount) {
          const { etag } = await nextcloudClient(nextcloudAccount).upload(
            cloudFile.path,
            bytes,
            cloudFile.etag ? { ifMatch: cloudFile.etag } : undefined
          );
          setCloudFile({ path: cloudFile.path, etag });
          controller.markSaved(undefined, contentHash, revision);
          refreshState();
          addToast('success', 'Mappa salvata su Nextcloud');
          return true;
        }

        const written = await saveLocalXmindFile(
          bytes,
          suggestedName,
          saveAs ? undefined : fileHandle,
          expectedHash
        );
        // Dialogo annullato: niente è stato scritto, la mappa resta da salvare.
        if (!written) return false;
        if (written.handle) setFileHandle(written.handle);
        // Da qui il file di riferimento è quello locale: "Salva" non deve più scrivere su Nextcloud.
        setCloudFile(undefined);
        controller.markSaved(undefined, contentHash, revision);
        refreshState();
        addToast('success', `Mappa salvata (${validation.resourceRefs} risorse registrate)`);
        return true;
      } catch (err: any) {
        addToast('error', `Errore durante il salvataggio: ${err.message}`);
        return false;
      } finally {
        savingRef.current = false;
        setBusy(false);
      }
    },
    [
      workbook,
      controller,
      fileHandle,
      cloudFile,
      nextcloudAccount,
      isElectron,
      addToast,
      refreshState,
      setFileHandle,
      setCloudFile,
      setBusy,
    ]
  );

  /**
   * "Salva su Nextcloud…": scrive la mappa in `path`. `existing` è il file con lo
   * stesso nome che l'utente ha scelto di sostituire: si sovrascrive solo se è
   * ancora quello elencato (If-Match), altrimenti il file non deve esistere.
   */
  const saveToNextcloud = useCallback(
    async (path: string, existing: NextcloudEntry | undefined): Promise<boolean> => {
      if (!workbook || !nextcloudAccount || savingRef.current) return false;
      savingRef.current = true;
      setBusy(true);
      try {
        const { bytes, revision } = await controller.prepareArchiveBytes();
        const contentHash = await sha256HexAsync(bytes);
        const { etag } = await nextcloudClient(nextcloudAccount).upload(
          path,
          bytes,
          existing?.etag ? { ifMatch: existing.etag } : existing ? undefined : { createOnly: true }
        );
        setCloudFile({ path, etag });
        setFileHandle(undefined);
        controller.markSaved(undefined, contentHash, revision);
        refreshState();
        addToast('success', 'Mappa salvata su Nextcloud');
        return true;
      } catch (err: unknown) {
        addToast('error', `Errore durante il salvataggio: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      } finally {
        savingRef.current = false;
        setBusy(false);
      }
    },
    [workbook, nextcloudAccount, controller, setCloudFile, setFileHandle, refreshState, addToast, setBusy]
  );

  const handleSave = useCallback(async () => {
    if (!workbook) return;
    // Mappa nuova mai salvata: "Salva" deve poterla scrivere anche senza modifiche.
    const neverSaved =
      workbook.path === null && workbook.fileName === UNTITLED_FILE_NAME && !fileHandle && !cloudFile;
    if (!workbook.dirty && !neverSaved) {
      addToast('info', 'Nessuna modifica da salvare.');
      return;
    }
    await writeWorkbook(false, false);
  }, [workbook, writeWorkbook, addToast, fileHandle, cloudFile]);

  const handleSaveAs = useCallback(async () => {
    if (!workbook) return;
    await writeWorkbook(false, true);
  }, [workbook, writeWorkbook]);

  return { writeWorkbook, handleSave, handleSaveAs, saveToNextcloud };
}
