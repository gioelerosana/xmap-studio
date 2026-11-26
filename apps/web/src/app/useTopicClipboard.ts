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

/**
 * Blocchi su cui agisce copia/taglia: tutta la selezione multipla se `id` ne fa parte,
 * altrimenti solo `id` (es. menu contestuale su un blocco fuori dalla selezione).
 */
function clipboardTargets(id: string, selectedIds: string[]): string[] {
  return selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : [id];
}

/** Primo antenato di `id` che resta sulla mappa dopo aver tolto `removed`. */
function survivingAncestor(allTopics: TopicView[], id: string, removed: Set<string>): string | undefined {
  const byId = new Map(allTopics.map((t) => [t.id, t]));
  let parentId = byId.get(id)?.parentId;
  while (parentId && removed.has(parentId)) parentId = byId.get(parentId)?.parentId;
  return parentId;
}

interface TopicClipboardOptions {
  controller: AppController;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  currentLayout: Layout | null;
  refreshState: () => void;
  addToast: AddToast;
  selection: SelectionState;
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
  setEditing,
  insertImage,
}: TopicClipboardOptions) {
  const { selectSingle, selectMany, exitSelectionMode, selectedTopicIds } = selection;
  const inMemoryClipboard = useRef<string | null>(null);

  const handleCopyTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      const ids = clipboardTargets(id, selectedTopicIds);
      try {
        const payload = controller.copyTopics(ids);
        inMemoryClipboard.current = payload;
        navigator.clipboard?.writeText(payload).catch(() => {});
        exitSelectionMode();
        addToast('info', ids.length > 1 ? `${ids.length} blocchi copiati` : 'Blocco copiato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile copiare i blocchi: ${msg}`, err);
      }
    },
    [controller, selectedTopic, selectedTopicIds, addToast, exitSelectionMode]
  );

  const handleCutTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      const rootIds = new Set(allTopics.filter((t) => t.depth === 0).map((t) => t.id));
      const ids = clipboardTargets(id, selectedTopicIds).filter((t) => !rootIds.has(t));
      if (ids.length === 0) {
        addToast('warning', 'La radice non può essere tagliata');
        return;
      }
      try {
        const payload = controller.copyTopics(ids);
        inMemoryClipboard.current = payload;
        navigator.clipboard?.writeText(payload).catch(() => {});
        const next =
          ids.length === 1
            ? currentLayout
              ? selectionAfterDelete(currentLayout, ids[0] as string)
              : undefined
            : survivingAncestor(allTopics, ids[0] as string, new Set(ids));
        controller.removeTopics(ids);
        selectSingle(next);
        exitSelectionMode();
        setEditing(null);
        refreshState();
        addToast('info', ids.length > 1 ? `${ids.length} blocchi tagliati` : 'Blocco tagliato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile tagliare i blocchi: ${msg}`, err);
      }
    },
    [controller, selectedTopic, selectedTopicIds, allTopics, currentLayout, refreshState, addToast, selectSingle, exitSelectionMode, setEditing]
  );

  const handleDuplicateTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      try {
        const { newId } = controller.duplicateTopic(id);
        selectSingle(newId);
        exitSelectionMode();
        refreshState();
        addToast('success', 'Blocco duplicato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile duplicare il blocco: ${msg}`, err);
      }
    },
    [controller, selectedTopic, refreshState, addToast, selectSingle, exitSelectionMode]
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
          const { newIds } = controller.pasteTopic(targetId, text);
          selectMany(newIds);
          exitSelectionMode();
          refreshState();
          addToast('success', newIds.length > 1 ? `${newIds.length} blocchi incollati` : 'Blocco incollato');
          return;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile incollare il blocco: ${msg}`, err);
          return;
        }
      }

      const clean = text?.trim() ?? '';
      if (clean.length > 0) {
        try {
          const { newId } = controller.addTopic(targetId, clean);
          selectSingle(newId);
          exitSelectionMode();
          refreshState();
          addToast('success', 'Nuovo blocco creato dal testo');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile creare il blocco: ${msg}`, err);
        }
      }
    },
    [controller, selectedTopic, allTopics, refreshState, addToast, selectSingle, selectMany, exitSelectionMode, insertImage]
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
