import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { type AppController, type Layout, type Point, type TitleRun, type TopicView } from '@xmap/core';
import type { DropPlacement } from '../components/map/dragTarget.js';
import type { EditExit } from '../components/map/NodeEditor.js';
import type { MapEditing } from '../components/MapView.js';
import { selectionAfterDelete } from '../components/map/navigation.js';
import type { SelectionState } from './useSelection.js';
import type { AddToast } from './useToasts.js';

interface TopicEditingOptions {
  controller: AppController;
  refreshState: () => void;
  addToast: AddToast;
  selection: SelectionState;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  activeSheetIndex: number;
  currentLayout: Layout | null;
  editing: MapEditing | null;
  setEditing: Dispatch<SetStateAction<MapEditing | null>>;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
  /** Apre l'editor LaTeX del blocco (blocchi equazione, che non hanno un titolo modificabile in place). */
  openLatex: (id: string) => void;
}

/** Modifiche ai blocchi: creazione, testo, spostamento, dimensioni, eliminazione, sommari, undo/redo. */
export function useTopicEditing({
  controller,
  refreshState,
  addToast,
  selection,
  selectedTopic,
  allTopics,
  activeSheetIndex,
  currentLayout,
  editing,
  setEditing,
  setCollapsedIds,
  openLatex,
}: TopicEditingOptions) {
  const { selectedTopicId, selectedTopicIds, selectSingle } = selection;

  // Nuovo blocco da tastiera o dalla mappa: si seleziona ed entra subito in editing in place.
  const createTopic = useCallback(
    (anchorId: string, kind: 'child' | 'after' | 'before') => {
      try {
        const { newId } =
          kind === 'child'
            ? controller.addTopic(anchorId, 'Nuovo blocco')
            : controller.addSiblingTopic(anchorId, 'Nuovo blocco', kind);
        // Il genitore collassato va espanso (per i fratelli il genitore non cambia, ma è innocuo).
        setCollapsedIds((prev) => {
          if (!prev.has(anchorId)) return prev;
          const next = new Set(prev);
          next.delete(anchorId);
          return next;
        });
        selectSingle(newId);
        setEditing({ id: newId, mode: 'all', isNew: true });
        refreshState();
      } catch (err: any) {
        addToast('error', err.message);
      }
    },
    [controller, refreshState, addToast, selectSingle, setCollapsedIds, setEditing]
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      try {
        const { newId } = controller.addTopic(parentId, 'Nuovo blocco');
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
        selectSingle(newId);
        refreshState();
      } catch (err: any) {
        addToast('error', err.message);
      }
    },
    [controller, refreshState, addToast, selectSingle, setCollapsedIds]
  );

  const handleToggleCollapse = useCallback((topicId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(topicId) ? next.delete(topicId) : next.add(topicId);
      return next;
    });
  }, [setCollapsedIds]);

  const handleMove = useCallback(
    (id: string, targetId: string, placement: DropPlacement) => {
      try {
        controller.moveTopic(id, targetId, placement);
        refreshState();
        addToast('success', 'Blocco spostato');
      } catch (err: any) {
        addToast('error', `Spostamento non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleResizeTopicWidth = useCallback(
    (id: string, width: number | null) => {
      try {
        controller.setTopicCustomWidth(id, width);
        refreshState();
      } catch (err: any) {
        addToast('error', `Ridimensionamento non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleResizeTopicImage = useCallback(
    (id: string, size: { width: number; height: number }) => {
      try {
        controller.setTopicImageSize(id, size);
        refreshState();
      } catch (err: any) {
        addToast('error', `Ridimensionamento immagine non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleMoveFloating = useCallback(
    (id: string, position: Point) => {
      try {
        controller.setTopicPosition(id, position);
        refreshState();
      } catch (err: any) {
        addToast('error', `Spostamento non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleDeleteSelected = () => {
    if (!selectedTopic || selectedTopic.depth === 0) return;
    try {
      const next = currentLayout ? selectionAfterDelete(currentLayout, selectedTopic.id) : undefined;
      controller.removeTopic(selectedTopic.id);
      selectSingle(next);
      setEditing(null);
      refreshState();
      addToast('info', 'Blocco eliminato — Ctrl+Z per annullare');
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  const handleRemoveTopicKeepChildren = (topicId: string) => {
    const fallback = currentLayout ? selectionAfterDelete(currentLayout, topicId) : undefined;
    try {
      const { childIds } = controller.removeTopicKeepChildren(topicId);
      const next = childIds[0] ?? fallback;
      selectSingle(next);
      setEditing(null);
      refreshState();
      addToast('info', 'Blocco rimosso, figli ricollegati — Ctrl+Z per annullare');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  };

  const handleCreateSummary = useCallback(() => {
    const ids = selectedTopicIds.length > 0 ? selectedTopicIds : (selectedTopicId ? [selectedTopicId] : []);
    if (ids.length === 0) {
      addToast('warning', 'Seleziona almeno un blocco per creare un sommario.');
      return;
    }

    const range = controller.siblingRange(ids);
    if (!range) {
      addToast('warning', 'Impossibile creare un sommario con questa selezione (radice, blocchi liberi o fogli diversi).');
      return;
    }

    try {
      const { summaryTopicId } = controller.addTopicSummary(range.parentId, range.start, range.end, 'Sommario');
      selectSingle(summaryTopicId);
      setEditing({ id: summaryTopicId, mode: 'all', isNew: true });
      refreshState();
      addToast('success', 'Sommario aggiunto');
    } catch (err: any) {
      addToast('error', err.message || 'Impossibile creare il sommario.');
    }
  }, [selectedTopicIds, selectedTopicId, controller, refreshState, addToast, selectSingle, setEditing]);

  // Undo/redo: la selezione resta se il blocco esiste ancora, altrimenti risale al genitore.
  const doUndoRedo = useCallback(
    (kind: 'undo' | 'redo') => {
      const parentOf = new Map(allTopics.map((t) => [t.id, t.parentId]));
      kind === 'undo' ? controller.undo() : controller.redo();
      const dto = controller.workbook();
      const alive = new Set(dto?.sheets[activeSheetIndex]?.topics.map((t) => t.id));
      let cur = selectedTopicId;
      while (cur && !alive.has(cur)) cur = parentOf.get(cur);
      selectSingle(cur);
      setEditing(null);
      refreshState();
    },
    [controller, allTopics, activeSheetIndex, selectedTopicId, refreshState, selectSingle, setEditing]
  );

  const handleCommitEdit = (id: string, text: string, exit: EditExit, runs?: TitleRun[]) => {
    const isNew = editing?.id === id && editing.isNew;
    setEditing(null);
    const topic = allTopics.find((t) => t.id === id);
    try {
      if (topic) {
        if (runs && runs.length > 0) {
          controller.setTopicTitleRuns(id, runs, { mergeWithPrevious: isNew });
          refreshState();
        } else if (topic.titleRuns && topic.titleRuns.length > 0) {
          controller.setTopicTitleRuns(id, [{ text: text.trim().length > 0 ? text : topic.title }], {
            mergeWithPrevious: isNew,
          });
          refreshState();
        } else if (text.trim().length > 0 && text !== topic.title) {
          controller.setTopicTitle(id, text, { mergeWithPrevious: isNew });
          refreshState();
        }
      }
    } catch (err: any) {
      addToast('error', err.message);
      return;
    }
    if (exit === 'tab') createTopic(id, 'child');
  };

  const startEdit = (id: string) => {
    const t = allTopics.find((x) => x.id === id);
    if (!t) return;
    if (t.kind === 'equation') openLatex(id);
    else if (t.kind === 'text') setEditing({ id, mode: 'all' });
  };

  return {
    createTopic,
    handleAddChild,
    handleToggleCollapse,
    handleMove,
    handleResizeTopicWidth,
    handleResizeTopicImage,
    handleMoveFloating,
    handleDeleteSelected,
    handleRemoveTopicKeepChildren,
    handleCreateSummary,
    doUndoRedo,
    handleCommitEdit,
    startEdit,
  };
}
