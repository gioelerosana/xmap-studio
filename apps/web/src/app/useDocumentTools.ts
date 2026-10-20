import { type AppController, type TopicView } from '@xmap/core';
import { pickAnyFile, saveBytes } from '../adapters/fileSystem.js';
import { sanitizeName } from './fileNames.js';
import type { AddToast } from './useToasts.js';

interface DocumentToolsOptions {
  controller: AppController;
  selectedTopic: TopicView | null;
  hasWorkbook: boolean;
  refreshState: () => void;
  addToast: AddToast;
}

/** Strumenti del menu ⋮ che operano sul documento o sul blocco selezionato: allegati, unione, estrazione, equazioni. */
export function useDocumentTools({ controller, selectedTopic, hasWorkbook, refreshState, addToast }: DocumentToolsOptions) {
  const handleExportEquation = async (format: 'svg' | 'png') => {
    if (!selectedTopic || selectedTopic.kind !== 'equation') return;
    try {
      const { bytes, mime, extension } = await controller.exportEquation(selectedTopic.id, format);
      const base = sanitizeName(selectedTopic.title || controller.mapTitle() || 'equazione');
      await saveBytes(bytes, `${base}.${extension}`, mime, {
        description: format.toUpperCase(),
        extensions: [extension],
      });
      addToast('success', `Equazione esportata in ${format.toUpperCase()}`);
    } catch (err: any) {
      addToast('error', `Esportazione non riuscita: ${err.message}`);
    }
  };

  const handleAttach = async () => {
    if (!selectedTopic) return;
    try {
      const picked = await pickAnyFile({ description: 'Tutti i file' });
      if (!picked) return;
      controller.attachFileToTopic(selectedTopic.id, picked.name, picked.bytes);
      refreshState();
      addToast('success', `Allegato: ${picked.name}`);
    } catch (err: any) {
      addToast('error', `Allegato non aggiunto: ${err.message}`);
    }
  };

  const handleMerge = async () => {
    if (!hasWorkbook) return;
    try {
      const picked = await pickAnyFile({ description: 'File XMind', extensions: ['xmind'] });
      if (!picked) return;
      const res = await controller.mergeWorkbook(picked.bytes);
      refreshState();
      addToast('success', `Unite ${res.addedSheets} mappe (${res.addedTopics} blocchi)`);
    } catch (err: any) {
      addToast('error', `Unione non riuscita: ${err.message}`);
    }
  };

  const handleSplit = async () => {
    if (!selectedTopic || selectedTopic.depth === 0) {
      addToast('warning', 'Seleziona un blocco non radice da estrarre.');
      return;
    }
    try {
      const bytes = await controller.splitTopic(selectedTopic.id);
      const base = sanitizeName(selectedTopic.title || 'mappa');
      const saved = await saveBytes(bytes, `${base}.xmind`, 'application/vnd.xmind.workbook', {
        description: 'File XMind',
        extensions: ['xmind'],
      });
      if (!saved) return;
      addToast('success', 'Ramo estratto in una nuova mappa');
    } catch (err: any) {
      addToast('error', `Estrazione non riuscita: ${err.message}`);
    }
  };

  return { handleExportEquation, handleAttach, handleMerge, handleSplit };
}
