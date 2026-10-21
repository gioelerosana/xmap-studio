import { useMemo } from 'react';
import type { AppController, RelationshipShape } from '@xmap/core';

export type TextStylePatch = Parameters<AppController['setTopicTextStyle']>[1];
export type ToastFn = (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;

/**
 * Modifiche a un blocco richieste dalla barra flottante. Ogni azione è un passo di undo,
 * aggiorna lo stato e trasforma gli errori del core in un toast: i chiamanti non gestiscono eccezioni.
 */
export interface TopicActions {
  setTextStyle: (topicId: string, patch: TextStylePatch) => void;
  setBranchColor: (topicId: string, color: string | null) => void;
  setNotes: (topicId: string, notes: string) => void;
  setNotesDisplay: (topicId: string, display: 'icon' | 'block' | null) => void;
  toggleMarker: (topicId: string, markerId: string) => void;
  setLabels: (topicId: string, labels: string[]) => void;
  setHref: (topicId: string, href: string | null) => void;
  addRelationship: (fromId: string, toId: string, title?: string) => void;
  removeRelationship: (relationshipId: string) => void;
  setRelationshipShape: (relationshipId: string, shape: RelationshipShape) => void;
  addBoundary: (topicId: string) => void;
  removeBoundary: (topicId: string, boundaryId: string) => void;
  addSummary: (topicId: string) => void;
  removeSummary: (topicId: string, summaryId: string) => void;
}

export function useTopicActions({
  controller,
  refreshState,
  addToast,
}: {
  controller: AppController;
  refreshState: () => void;
  addToast: ToastFn;
}): TopicActions {
  return useMemo(() => {
    const run = (action: () => void, success?: string) => {
      try {
        action();
        refreshState();
        if (success) addToast('success', success);
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : String(err));
      }
    };
    return {
      setTextStyle: (id, patch) => run(() => controller.setTopicTextStyle(id, patch)),
      setBranchColor: (id, color) => run(() => controller.setTopicColor(id, color)),
      setNotes: (id, notes) => run(() => controller.setTopicNotes(id, notes)),
      setNotesDisplay: (id, display) => run(() => controller.setTopicNotesDisplay(id, display)),
      toggleMarker: (id, markerId) => run(() => controller.toggleTopicMarker(id, markerId)),
      setLabels: (id, labels) => run(() => controller.setTopicLabels(id, labels)),
      setHref: (id, href) => run(() => controller.setTopicHref(id, href)),
      addRelationship: (fromId, toId, title) =>
        run(() => controller.addTopicRelationship(fromId, toId, title), 'Relazione aggiunta'),
      removeRelationship: (relId) => run(() => controller.removeTopicRelationship(relId)),
      setRelationshipShape: (relId, shape) => run(() => controller.setRelationshipShape(relId, shape)),
      addBoundary: (id) => run(() => controller.addTopicBoundary(id), 'Cornice aggiunta'),
      removeBoundary: (id, boundaryId) => run(() => controller.removeTopicBoundary(id, boundaryId)),
      addSummary: (id) => run(() => controller.addTopicSummary(id), 'Sommario aggiunto'),
      removeSummary: (id, summaryId) => run(() => controller.removeTopicSummary(id, summaryId)),
    };
  }, [controller, refreshState, addToast]);
}
