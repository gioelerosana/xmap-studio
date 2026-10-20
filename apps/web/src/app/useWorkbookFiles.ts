import { useCallback, useEffect, useState } from 'react';
import {
  buildArchiveBytes,
  type AppController,
  type RawArchive,
  type WorkbookDto,
} from '@xmap/core';
import { openLocalXmindFile } from '../adapters/fileSystem.js';
import type { AddToast } from './useToasts.js';
import { UNTITLED_FILE_NAME } from './fileNames.js';

export type CloseAction = null | 'confirm';
export type ReplacementAction = 'save' | 'discard' | 'cancel';

interface WorkbookFilesOptions {
  controller: AppController;
  isElectron: boolean;
  /** Mostra una mappa appena aperta: azzera selezione, sheet e blocchi ripiegati. */
  adoptWorkbook: (dto: WorkbookDto, handle?: FileSystemFileHandle) => void;
  addToast: AddToast;
  writeWorkbook: (force: boolean, saveAs: boolean) => Promise<boolean>;
}

/**
 * Apertura, creazione e sostituzione delle mappe. Chiede di salvare prima di
 * sostituire una mappa modificata e prima di chiudere la finestra.
 */
export function useWorkbookFiles({ controller, isElectron, adoptWorkbook, addToast, writeWorkbook }: WorkbookFilesOptions) {
  const [pendingReplacement, setPendingReplacement] = useState<(() => Promise<void>) | null>(null);
  const [replacePrompt, setReplacePrompt] = useState(false);
  const [closePrompt, setClosePrompt] = useState<CloseAction>(null);

  const requestWorkbookReplacement = useCallback(
    async (replace: () => Promise<void>) => {
      if (controller.isDirty()) {
        setPendingReplacement(() => replace);
        setReplacePrompt(true);
        return;
      }
      await replace();
    },
    [controller]
  );

  const openFromPath = useCallback(
    async (filePath: string) => {
      if (!window.electronAPI) return;
      const res = await window.electronAPI.openFilePath(filePath);
      if (!res) return;
      try {
        await requestWorkbookReplacement(async () => {
          const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
          adoptWorkbook(dto);
          addToast('success', `Aperto: ${res.name}`);
        });
      } catch (err: any) {
        addToast('error', `Errore apertura file: ${err.message || String(err)}`);
      }
    },
    [controller, addToast, requestWorkbookReplacement, adoptWorkbook]
  );

  const handleOpenLocalFile = useCallback(async () => {
    try {
      if (isElectron && window.electronAPI) {
        const res = await window.electronAPI.openFileDialog();
        if (!res) return;
        await requestWorkbookReplacement(async () => {
          const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
          adoptWorkbook(dto);
          addToast('success', `Mappa aperta: ${res.name}`);
        });
        return;
      }

      const res = await openLocalXmindFile();
      if (!res) return;
      await requestWorkbookReplacement(async () => {
        const dto = await controller.open(res.data, undefined, res.name);
        adoptWorkbook(dto, res.handle);
        addToast('success', `Mappa aperta: ${res.name}`);
      });
    } catch (err: any) {
      addToast('error', `Errore apertura file: ${err.message || String(err)}`);
    }
  }, [controller, isElectron, addToast, requestWorkbookReplacement, adoptWorkbook]);

  const handleLoadDemo = async () => {
    try {
      const response = await fetch('demo.xmind');
      if (!response.ok) throw new Error('File demo non reperibile');
      const buffer = await response.arrayBuffer();
      await requestWorkbookReplacement(async () => {
        const dto = await controller.open(new Uint8Array(buffer), undefined, 'Relazioni.xmap-studio.xmind');
        adoptWorkbook(dto);
        addToast('info', 'Mappa demo caricata');
      });
    } catch (err: any) {
      addToast('error', `Impossibile caricare la demo: ${err.message}`);
    }
  };

  const handleNewMap = async () => {
    const blank = JSON.stringify([
      {
        id: 'sheet-1',
        class: 'sheet',
        title: 'Nuova Mappa',
        rootTopic: {
          id: 'root-topic-1',
          title: 'Argomento Centrale',
          children: {
            attached: [
              { id: 'child-1', title: 'Sotto-argomento 1' },
              { id: 'child-2', title: 'Sotto-argomento 2' },
            ],
          },
        },
      },
    ]);
    const enc = new TextEncoder();
    const raw: RawArchive = {
      entries: new Map([
        ['content.json', enc.encode(blank)],
        ['manifest.json', enc.encode(JSON.stringify({ 'file-entries': { 'content.json': {} } }))],
        ['metadata.json', enc.encode(JSON.stringify({ creator: { name: 'XMap Studio' } }))],
      ]),
      resources: new Map(),
    };
    const bytes = await buildArchiveBytes(raw);
    await requestWorkbookReplacement(async () => {
      const dto = await controller.open(bytes, undefined, UNTITLED_FILE_NAME);
      adoptWorkbook(dto);
      addToast('success', 'Nuova mappa creata');
    });
  };

  // Drop di un file sulla schermata vuota: nessuna richiesta di salvataggio, la mappa è la prima.
  const openDroppedFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const dto = await controller.open(new Uint8Array(buffer), undefined, file.name);
    adoptWorkbook(dto);
    addToast('success', `Aperto ${file.name}`);
  };

  const handleConfirmReplacement = async (action: ReplacementAction) => {
    if (action === 'cancel') {
      setReplacePrompt(false);
      setPendingReplacement(null);
      return;
    }
    if (action === 'save') {
      const ok = await writeWorkbook(false, false);
      if (!ok) return;
    }
    const replace = pendingReplacement;
    setReplacePrompt(false);
    setPendingReplacement(null);
    try {
      await replace?.();
    } catch (err: any) {
      addToast('error', `Impossibile aprire la mappa: ${err.message || String(err)}`);
    }
  };

  const handleConfirmClose = async (action: 'save' | 'discard' | 'cancel') => {
    if (action === 'cancel') {
      setClosePrompt(null);
      return;
    }
    if (action === 'save') {
      const ok = await writeWorkbook(false, false);
      if (!ok) return;
    }
    window.electronAPI?.forceClose();
  };

  // Chiusura del tab/finestra del browser con modifiche non salvate.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [controller]);

  return {
    openFromPath,
    handleOpenLocalFile,
    handleLoadDemo,
    handleNewMap,
    openDroppedFile,
    replacePrompt,
    handleConfirmReplacement,
    closePrompt,
    setClosePrompt,
    handleConfirmClose,
  };
}
