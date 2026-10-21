import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { TopicView } from '@xmap/core';
import type { MapEditing } from '../components/MapView.js';
import type { SelectionState } from './useSelection.js';
import { TEXT_FIELD } from './constants.js';

interface GlobalShortcutsOptions {
  hasWorkbook: boolean;
  selectedTopic: TopicView | null;
  allTopics: TopicView[];
  editing: MapEditing | null;
  selection: SelectionState;
  doUndoRedo: (kind: 'undo' | 'redo') => void;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleOpenLocalFile: () => Promise<void>;
  handleAddChild: (parentId: string) => void;
  handleCreateSummary: () => void;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setPrintModalOpen: Dispatch<SetStateAction<boolean>>;
}

/** Scorciatoie globali: Ctrl+lettera (undo, salva, apri, stampa…) ed Esc per ridurre o togliere la selezione. */
export function useGlobalShortcuts({
  hasWorkbook,
  selectedTopic,
  allTopics,
  editing,
  selection,
  doUndoRedo,
  handleSave,
  handleSaveAs,
  handleOpenLocalFile,
  handleAddChild,
  handleCreateSummary,
  setSettingsOpen,
  setPrintModalOpen,
}: GlobalShortcutsOptions) {
  const { selectedTopicId, selectedTopicIds, setSelectedTopicIds, selectSingle } = selection;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const inField = (e.target as Element | null)?.closest?.(TEXT_FIELD);
      if (key === 'z' || key === 'y') {
        // In un campo di testo vale l'undo nativo del campo.
        if (inField) return;
        e.preventDefault();
        doUndoRedo(key === 'y' || e.shiftKey ? 'redo' : 'undo');
      } else if (key === 's') {
        e.preventDefault();
        e.shiftKey ? handleSaveAs() : handleSave();
      } else if (key === 'o') {
        e.preventDefault();
        handleOpenLocalFile();
      } else if (e.shiftKey && key === 'n') {
        e.preventDefault();
        if (selectedTopic) handleAddChild(selectedTopic.id);
        else if (allTopics[0]) handleAddChild(allTopics[0].id);
      } else if (key === ',') {
        e.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (key === ']' || e.code === 'BracketRight') {
        if (inField) return;
        e.preventDefault();
        handleCreateSummary();
      } else if (key === 'p') {
        if (hasWorkbook) {
          e.preventDefault();
          setPrintModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doUndoRedo, handleSave, handleSaveAs, handleOpenLocalFile, selectedTopic, allTopics, handleAddChild, handleCreateSummary, hasWorkbook, setSettingsOpen, setPrintModalOpen]);

  // Esc fuori dai campi di testo: la selezione multipla torna singola, quella singola si toglie.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (editing) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      if (selectedTopicIds.length > 1) {
        e.preventDefault();
        setSelectedTopicIds(selectedTopicId ? [selectedTopicId] : []);
        return;
      }
      if (selectedTopicId) {
        e.preventDefault();
        selectSingle(undefined);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, selectedTopicIds, selectedTopicId, setSelectedTopicIds, selectSingle]);
}
