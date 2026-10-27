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
  zenMode: boolean;
  setZenMode: Dispatch<SetStateAction<boolean>>;
}

/** Scorciatoie globali: Ctrl+lettera (undo, salva, apri, stampa…), Ctrl+Alt+Z per la modalità Zen ed Esc per ridurre o togliere la selezione (e, a selezione vuota, uscire da Zen). */
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
  zenMode,
  setZenMode,
}: GlobalShortcutsOptions) {
  const { selectedTopicId, selectedTopicIds, setSelectedTopicIds, selectSingle } = selection;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.defaultPrevented || e.isComposing) return;
      const key = e.key.toLowerCase();
      const inField = (e.target as Element | null)?.closest?.(TEXT_FIELD);
      // Con un dialogo aperto (editor LaTeX, conferme, …) le azioni sulla mappa
      // sotto di lui non partono: valgono solo salvataggio, impostazioni e Zen.
      const inDialog = document.querySelector('[role="dialog"]') !== null;
      if (inDialog && !(key === 's' || key === ',' || (e.altKey && e.code === 'KeyZ'))) return;
      // Ctrl+Alt+Z: modalità Zen (prima di Ctrl+Z, che è l'annulla).
      if (e.altKey && (key === 'z' || e.code === 'KeyZ')) {
        e.preventDefault();
        if (hasWorkbook) setZenMode((on) => !on);
        return;
      }
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
  }, [doUndoRedo, handleSave, handleSaveAs, handleOpenLocalFile, selectedTopic, allTopics, handleAddChild, handleCreateSummary, hasWorkbook, setSettingsOpen, setPrintModalOpen, setZenMode]);

  // Esc fuori dai campi di testo: la selezione multipla torna singola, quella singola si toglie.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (editing) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      // Senza selezione da togliere, Esc esce dalla modalità Zen.
      if (zenMode && selectedTopicIds.length === 0 && !selectedTopicId) {
        e.preventDefault();
        setZenMode(false);
        return;
      }
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
  }, [editing, selectedTopicIds, selectedTopicId, setSelectedTopicIds, selectSingle, zenMode, setZenMode]);
}
