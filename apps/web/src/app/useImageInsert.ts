import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { AppController, TopicView } from '@xmap/core';
import type { SelectionState } from './useSelection.js';
import type { AddToast } from './useToasts.js';
import { readImageBlob } from './readImageBlob.js';

/** Da dove arriva l'immagine: cambia solo il messaggio di conferma. */
export type ImageInsertSource = 'paste' | 'drop' | 'picker';

interface ImageInsertOptions {
  controller: AppController;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  refreshState: () => void;
  addToast: AddToast;
  selection: SelectionState;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
}

type DecodedImage = Awaited<ReturnType<typeof readImageBlob>>;

/**
 * Inserimento di immagini da incolla, trascinamento o selettore file. Una sola funzione
 * decide dove va l'immagine, così i tre canali si comportano allo stesso modo.
 */
export function useImageInsert({
  controller,
  selectedTopic,
  allTopics,
  refreshState,
  addToast,
  selection,
  setCollapsedIds,
}: ImageInsertOptions) {
  const { selectedTopicIds, setSelectedTopicId, selectSingle } = selection;

  const insertImage = useCallback(
    async (file: Blob, source: ImageInsertSource) => {
      try {
        const image: DecodedImage = await readImageBlob(file);
        const size = { width: image.width, height: image.height };

        // Un solo sommario selezionato: l'immagine diventa il contenuto del sommario stesso.
        if (selectedTopic?.group === 'summary' && selectedTopicIds.length === 1) {
          controller.setTopicImage(selectedTopic.id, image.bytes, image.mimeType, size);
          refreshState();
          addToast('success', 'Immagine inserita nel sommario');
          return;
        }

        // Più fratelli selezionati: l'immagine diventa il sommario di quell'intervallo.
        if (selectedTopicIds.length > 1 && controller.siblingRange(selectedTopicIds)) {
          const { summaryTopicId } = controller.addSummaryImageForSiblings(
            selectedTopicIds,
            image.bytes,
            image.mimeType,
            size
          );
          selectSingle(summaryTopicId);
          refreshState();
          addToast('success', source === 'paste' ? 'Immagine incollata come sommario' : 'Immagine aggiunta come sommario');
          return;
        }

        // Altrimenti è un nuovo sotto-blocco immagine del blocco selezionato (o della radice).
        const targetParentId =
          selectedTopic?.id ?? allTopics.find((t) => t.depth === 0)?.id ?? allTopics[0]?.id;
        if (!targetParentId) return;

        const { newId } = controller.addImageTopic(targetParentId, image.bytes, image.mimeType, size);
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
    [
      controller,
      selectedTopic,
      selectedTopicIds,
      allTopics,
      refreshState,
      addToast,
      setSelectedTopicId,
      selectSingle,
      setCollapsedIds,
    ]
  );

  return { insertImage };
}
