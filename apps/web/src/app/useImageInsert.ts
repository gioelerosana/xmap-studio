import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { AppController, TopicView } from '@xmap/core';
import type { SelectionState } from './useSelection.js';
import type { AddToast } from './useToasts.js';
import { readImageBlob } from './readImageBlob.js';

interface ImageInsertOptions {
  controller: AppController;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  refreshState: () => void;
  addToast: AddToast;
  selection: SelectionState;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
}

/** Inserimento di immagini come blocchi (da incolla o trascinamento) e come sommario. */
export function useImageInsert({
  controller,
  selectedTopic,
  allTopics,
  refreshState,
  addToast,
  selection,
  setCollapsedIds,
}: ImageInsertOptions) {
  const { setSelectedTopicId, selectSingle } = selection;

  const handleAddImage = useCallback(
    async (file: Blob, source: 'paste' | 'drop' = 'paste') => {
      try {
        const targetParentId =
          selectedTopic?.id ?? allTopics.find((t) => t.depth === 0)?.id ?? allTopics[0]?.id;
        if (!targetParentId) return;

        const { bytes, width, height, mimeType } = await readImageBlob(file);
        const { newId } = controller.addImageTopic(targetParentId, bytes, mimeType, { width, height });

        setCollapsedIds((prev) => {
          if (!prev.has(targetParentId)) return prev;
          const next = new Set(prev);
          next.delete(targetParentId);
          return next;
        });

        setSelectedTopicId(newId);
        refreshState();
        addToast(
          'success',
          source === 'paste' ? 'Immagine incollata sulla mappa' : 'Immagine aggiunta alla mappa'
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile aggiungere l'immagine: ${msg}`);
      }
    },
    [controller, selectedTopic, allTopics, refreshState, addToast, setSelectedTopicId, setCollapsedIds]
  );

  // Ctrl+V con più blocchi fratelli selezionati: l'immagine diventa il sommario di quella selezione.
  const handlePasteImageAsSummary = useCallback(
    async (file: Blob, ids: string[]) => {
      try {
        const { bytes, width, height, mimeType } = await readImageBlob(file);
        const { summaryTopicId } = controller.addSummaryImageForSiblings(ids, bytes, mimeType, { width, height });
        selectSingle(summaryTopicId);
        refreshState();
        addToast('success', 'Immagine incollata come sommario');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile creare il sommario con l'immagine: ${msg}`);
      }
    },
    [controller, refreshState, addToast, selectSingle]
  );

  return { handleAddImage, handlePasteImageAsSummary };
}
