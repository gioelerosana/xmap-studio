import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppController, Layout, TopicView } from '@xmap/core';
import type { MapEditing } from '../components/MapView.js';
import { selectionAfterDelete } from '../components/map/navigation.js';
import type { SelectionState } from './useSelection.js';
import type { AddToast } from './useToasts.js';

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
}: TopicClipboardOptions) {
  const { selectSingle } = selection;
  const inMemoryClipboard = useRef<string | null>(null);
  const [canPaste, setCanPaste] = useState(false);

  const handleCopyTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      try {
        const payload = controller.copyTopic(id);
        inMemoryClipboard.current = payload;
        setCanPaste(true);
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
        setCanPaste(true);
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
      let text = '';
      try {
        text = await navigator.clipboard?.readText();
      } catch {
        text = inMemoryClipboard.current || '';
      }
      if (!text && inMemoryClipboard.current) {
        text = inMemoryClipboard.current;
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
    [controller, selectedTopic, allTopics, refreshState, addToast, selectSingle, setCollapsedIds]
  );

  return {
    inMemoryClipboard,
    /** Vero se c'è qualcosa da incollare (copia interna o già copiato in questa sessione). */
    canPaste: canPaste || Boolean(inMemoryClipboard.current),
    handleCopyTopic,
    handleCutTopic,
    handleDuplicateTopic,
    handlePasteTopic,
  };
}
