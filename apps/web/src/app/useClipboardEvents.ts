import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AppController, TopicView } from '@xmap/core';
import type { MapEditing } from '../components/MapView.js';
import type { SelectionState } from './useSelection.js';
import type { ImageInsertSource } from './useImageInsert.js';
import type { AddToast } from './useToasts.js';
import { TEXT_FIELD } from './constants.js';

interface ClipboardEventsOptions {
  controller: AppController;
  editing: MapEditing | null;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  selection: SelectionState;
  refreshState: () => void;
  addToast: AddToast;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
  inMemoryClipboard: { current: string | null };
  insertImage: (file: Blob, source: ImageInsertSource) => Promise<void>;
  handleCopyTopic: (topicId?: string) => void;
  handleCutTopic: (topicId?: string) => void;
}

/**
 * Eventi globali di clipboard e trascinamento sulla mappa: Ctrl+V (immagini, blocchi,
 * testo), Ctrl+C, Ctrl+X e drop di immagini. Ignorati dentro campi di testo e modali.
 */
export function useClipboardEvents({
  controller,
  editing,
  selectedTopic,
  allTopics,
  selection,
  refreshState,
  addToast,
  setCollapsedIds,
  inMemoryClipboard,
  insertImage,
  handleCopyTopic,
  handleCutTopic,
}: ClipboardEventsOptions) {
  const { selectSingle } = selection;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (editing) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;

      // 1. Se c'è un'immagine, usa il flusso immagini esistente
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              void insertImage(file, 'paste');
              return;
            }
          }
        }
      }

      // 2. Altrimenti testo / payload blocco XMap Studio
      const text = e.clipboardData?.getData('text/plain') || inMemoryClipboard.current;
      if (!text) return;

      const targetParentId =
        selectedTopic?.id ?? allTopics.find((t) => t.depth === 0)?.id ?? allTopics[0]?.id;
      if (!targetParentId) return;

      if (text.includes('"xmapStudioClipboard"')) {
        e.preventDefault();
        try {
          const { newId } = controller.pasteTopic(targetParentId, text);
          setCollapsedIds((prev) => {
            if (!prev.has(targetParentId)) return prev;
            const next = new Set(prev);
            next.delete(targetParentId);
            return next;
          });
          selectSingle(newId);
          refreshState();
          addToast('success', 'Blocco incollato');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile incollare il blocco: ${msg}`);
        }
        return;
      }

      // Altrimenti se c'è un blocco selezionato e testo semplice, crea un sotto-blocco con quel testo
      const clean = text.trim();
      if (clean.length > 0 && selectedTopic) {
        e.preventDefault();
        try {
          const { newId } = controller.addTopic(selectedTopic.id, clean);
          setCollapsedIds((prev) => {
            if (!prev.has(selectedTopic.id)) return prev;
            const next = new Set(prev);
            next.delete(selectedTopic.id);
            return next;
          });
          selectSingle(newId);
          refreshState();
          addToast('success', 'Nuovo blocco creato dal testo');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile creare il blocco: ${msg}`);
        }
      }
    };

    // Testo selezionato nella pagina (note, popover, …): copia e taglia restano quelli nativi.
    const hasTextSelection = () => {
      const sel = window.getSelection();
      return Boolean(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
    };

    const onCopy = (e: ClipboardEvent) => {
      if (editing || hasTextSelection()) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      if (!selectedTopic) return;

      e.preventDefault();
      handleCopyTopic(selectedTopic.id);
    };

    const onCut = (e: ClipboardEvent) => {
      if (editing || hasTextSelection()) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      if (!selectedTopic || selectedTopic.depth === 0) return;

      e.preventDefault();
      handleCutTopic(selectedTopic.id);
    };

    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (types && Array.from(types).includes('Files')) {
        e.preventDefault();
      }
    };

    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return;
      if (editing) return;
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          void insertImage(file, 'drop');
          return;
        }
      }
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [editing, insertImage, controller, selectedTopic, allTopics, refreshState, addToast, handleCopyTopic, handleCutTopic, selectSingle, setCollapsedIds, inMemoryClipboard]);
}
