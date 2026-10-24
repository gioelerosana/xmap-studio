import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AppController, Layout, TopicView } from '@xmap/core';
import type { MapEditing } from '../components/MapView.js';
import { selectionAfterDelete } from '../components/map/navigation.js';
import type { SelectionState } from './useSelection.js';
import type { ImageInsertSource } from './useImageInsert.js';
import type { AddToast } from './useToasts.js';

/**
 * Prima immagine negli appunti di sistema, o `null` se non c'è. Permesso negato o API assente
 * non sono errori per l'utente: si ripiega sul testo.
 */
async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (imageType) return await item.getType(imageType);
    }
    return null;
  } catch {
    return null;
  }
}

interface TopicClipboardOptions {
  controller: AppController;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  currentLayout: Layout | null;
  refreshState: () => void;
  addToast: AddToast;
  selection: SelectionState;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
  setEditing: Dispatch<SetStateAction<MapEditing | null>>;
  insertImage: (file: Blob, source: ImageInsertSource) => Promise<void>;
}

/** Copia, taglia, incolla e duplica blocchi. Il payload è JSON con marcatore `xmapStudioClipboard`. */
export function useTopicClipboard({
  controller,
  selectedTopic,
  allTopics,
  currentLayout,
  refreshState,
  addToast,
  selection,
  setCollapsedIds,
  setEditing,
  insertImage,
}: TopicClipboardOptions) {
  const { selectSingle } = selection;
  const inMemoryClipboard = useRef<string | null>(null);

  const handleCopyTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      try {
        const payload = controller.copyTopic(id);
        inMemoryClipboard.current = payload;
        navigator.clipboard?.writeText(payload).catch(() => {});
        addToast('info', 'Blocco copiato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile copiare il blocco: ${msg}`);
      }
    },
    [controller, selectedTopic, addToast]
  );

  const handleCutTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      const topic = allTopics.find((t) => t.id === id);
      if (!topic || topic.depth === 0) {
        addToast('warning', 'La radice non può essere tagliata');
        return;
      }
      try {
        const payload = controller.copyTopic(id);
        inMemoryClipboard.current = payload;
        navigator.clipboard?.writeText(payload).catch(() => {});
        const next = currentLayout ? selectionAfterDelete(currentLayout, id) : undefined;
        controller.removeTopic(id);
        selectSingle(next);
        setEditing(null);
        refreshState();
        addToast('info', 'Blocco tagliato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile tagliare il blocco: ${msg}`);
      }
    },
    [controller, selectedTopic, allTopics, currentLayout, refreshState, addToast, selectSingle, setEditing]
  );

  const handleDuplicateTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      try {
        const { newId } = controller.duplicateTopic(id);
        selectSingle(newId);
        refreshState();
        addToast('success', 'Blocco duplicato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile duplicare il blocco: ${msg}`);
      }
    },
    [controller, selectedTopic, refreshState, addToast, selectSingle]
  );

  const handlePasteTopic = useCallback(
    async (targetParentId?: string) => {
      const image = await readClipboardImage();
      if (image) {
        await insertImage(image, 'paste');
        return;
      }

      let text = '';
      try {
        text = await navigator.clipboard?.readText();
      } catch {
        text = inMemoryClipboard.current || '';
      }
      if (!text && inMemoryClipboard.current) {
        text = inMemoryClipboard.current;
      }
      if (!text) {
        addToast('info', 'Niente da incollare');
        return;
      }

      const targetId =
        targetParentId ??
        selectedTopic?.id ??
        allTopics.find((t) => t.depth === 0)?.id;

      if (!targetId) return;

      if (text && text.includes('"xmapStudioClipboard"')) {
        try {
          const { newId } = controller.pasteTopic(targetId, text);
          setCollapsedIds((prev) => {
            if (!prev.has(targetId)) return prev;
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          selectSingle(newId);
          refreshState();
          addToast('success', 'Blocco incollato');
          return;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile incollare il blocco: ${msg}`);
          return;
        }
      }

      const clean = text?.trim() ?? '';
      if (clean.length > 0) {
        try {
          const { newId } = controller.addTopic(targetId, clean);
          setCollapsedIds((prev) => {
            if (!prev.has(targetId)) return prev;
            const next = new Set(prev);
            next.delete(targetId);
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
    },
    [controller, selectedTopic, allTopics, refreshState, addToast, selectSingle, setCollapsedIds, insertImage]
  );

  return {
    inMemoryClipboard,
    /**
     * Sempre vero: un'immagine negli appunti di sistema non si legge in modo sincrono, quindi
     * il comando resta attivo e l'assenza di contenuto si segnala al momento dell'incolla.
     */
    canPaste: true,
    handleCopyTopic,
    handleCutTopic,
    handleDuplicateTopic,
    handlePasteTopic,
  };
}
