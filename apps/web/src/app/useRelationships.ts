import { useCallback, useEffect, useState } from 'react';
import { type AppController, type Point } from '@xmap/core';
import type { AddToast } from './useToasts.js';

interface RelationshipsOptions {
  controller: AppController;
  refreshState: () => void;
  addToast: AddToast;
}

/** Relazioni tra blocchi: modalità di collegamento (clic sul secondo blocco) e punti di controllo. */
export function useRelationships({ controller, refreshState, addToast }: RelationshipsOptions) {
  const [connectingTopicId, setConnectingTopicId] = useState<string | null>(null);

  const handleConnectRelationshipTarget = useCallback(
    (targetTopicId: string) => {
      if (!connectingTopicId) return;
      if (connectingTopicId === targetTopicId) {
        addToast('warning', 'Non puoi collegare un blocco a se stesso');
        setConnectingTopicId(null);
        return;
      }
      try {
        controller.addTopicRelationship(connectingTopicId, targetTopicId);
        refreshState();
        addToast('success', 'Relazione creata');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile creare la relazione: ${msg}`);
      }
      setConnectingTopicId(null);
    },
    [connectingTopicId, controller, refreshState, addToast]
  );

  const handleRelationshipControlPoint = useCallback(
    (relationshipId: string, points: [Point | null | undefined, Point | null | undefined]) => {
      try {
        controller.setRelationshipControlPoints(relationshipId, points);
        refreshState();
      } catch (err: any) {
        addToast('error', `Relazione non modificata: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  // Annulla la modalità di connessione relazione con Esc
  useEffect(() => {
    if (!connectingTopicId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConnectingTopicId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [connectingTopicId]);

  return {
    connectingTopicId,
    setConnectingTopicId,
    handleConnectRelationshipTarget,
    handleRelationshipControlPoint,
  };
}
