import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Layout, TopicView } from '@xmap/core';
import type { MapEditing } from '../components/MapView.js';
import { neighborId } from '../components/map/navigation.js';
import type { SelectionState } from './useSelection.js';
import { INTERACTIVE } from './constants.js';

interface MapKeyboardOptions {
  /** Vero solo con la mappa attiva e senza modali o editing in corso. */
  enabled: boolean;
  selectedTopic: TopicView | null;
  currentLayout: Layout | null;
  selection: SelectionState;
  setEditing: Dispatch<SetStateAction<MapEditing | null>>;
  startEdit: (id: string) => void;
  createTopic: (anchorId: string, kind: 'child' | 'after' | 'before') => void;
  handleDeleteSelected: () => void;
  handleDuplicateTopic: (topicId?: string) => void;
}

/** Scorciatoie sulla mappa (stile XMind): solo con il focus fuori da campi e controlli. */
export function useMapKeyboard({
  enabled,
  selectedTopic,
  currentLayout,
  selection,
  setEditing,
  startEdit,
  createTopic,
  handleDeleteSelected,
  handleDuplicateTopic,
}: MapKeyboardOptions) {
  const { selectedTopicId, selectedTopicIds, setSelectedTopicId, setSelectedTopicIds } = selection;
  // Il listener è agganciato una volta sola: legge le azioni più recenti da questo ref.
  const keyCtx = useRef({ startEdit, createTopic, handleDeleteSelected });
  keyCtx.current = { startEdit, createTopic, handleDeleteSelected };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;

      // Scorciatoia Ctrl+D / Cmd+D: duplica il blocco selezionato
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
        const target = e.target as Element | null;
        if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;
        if (selectedTopic && selectedTopic.depth > 0) {
          e.preventDefault();
          handleDuplicateTopic(selectedTopic.id);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;
      const sel = selectedTopic;
      if (!sel) return;
      const c = keyCtx.current;
      const go = (dir: 'up' | 'down' | 'left' | 'right') => {
        const id = currentLayout ? neighborId(currentLayout, sel.id, dir) : undefined;
        if (id) {
          setSelectedTopicId(id);
          setSelectedTopicIds([id]);
        }
      };
      switch (e.key) {
        case 'Tab':
          if (e.shiftKey) return;
          c.createTopic(sel.id, 'child');
          break;
        case 'Enter':
          c.createTopic(sel.id, e.shiftKey ? 'before' : 'after');
          break;
        case 'F2':
        case ' ':
          c.startEdit(sel.id);
          break;
        case 'Delete':
        case 'Backspace':
          if (sel.depth === 0) return;
          c.handleDeleteSelected();
          break;
        case 'ArrowUp': go('up'); break;
        case 'ArrowDown': go('down'); break;
        case 'ArrowLeft': go('left'); break;
        case 'ArrowRight': go('right'); break;
        case 'Escape':
          if (selectedTopicIds.length > 1) {
            setSelectedTopicIds(selectedTopicId ? [selectedTopicId] : []);
          } else {
            setSelectedTopicId(undefined);
            setSelectedTopicIds([]);
          }
          break;
        default:
          if (e.key.length !== 1 || sel.kind !== 'text') return;
          setEditing({ id: sel.id, mode: 'text', text: e.key });
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, selectedTopic, currentLayout, selectedTopicIds, selectedTopicId, handleDuplicateTopic, setEditing, setSelectedTopicId, setSelectedTopicIds]);
}
