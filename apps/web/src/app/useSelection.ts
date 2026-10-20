import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export interface SelectionState {
  selectedTopicId: string | undefined;
  selectedTopicIds: string[];
  setSelectedTopicId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedTopicIds: Dispatch<SetStateAction<string[]>>;
  /** Selezione singola (o vuota) con primaria e lista allineate. */
  selectSingle: (id: string | undefined) => void;
  onSelectTopic: (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
}

export function useSelection(): SelectionState {
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  // La selezione multipla contiene sempre la primaria: ogni altro cambio di
  // `selectedTopicId` (nuovo blocco, undo, immagine incollata…) la riporta a singola.
  useEffect(() => {
    setSelectedTopicIds((prev) =>
      selectedTopicId && prev.includes(selectedTopicId) ? prev : selectedTopicId ? [selectedTopicId] : []
    );
  }, [selectedTopicId]);

  const selectSingle = useCallback((id: string | undefined) => {
    setSelectedTopicId(id);
    setSelectedTopicIds(id ? [id] : []);
  }, []);

  const onSelectTopic = useCallback(
    (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => {
      const isMulti = Boolean(modifiers?.shiftKey || modifiers?.ctrlKey);
      if (!isMulti) {
        // Clic semplice: torna alla selezione singola
        setSelectedTopicId(topicId);
        setSelectedTopicIds([topicId]);
        return;
      }

      // Maiusc+clic o Ctrl/Cmd+clic: aggiunge o toglie dalla selezione
      setSelectedTopicIds((prev) => {
        const base = prev.length > 0 ? prev : (selectedTopicId ? [selectedTopicId] : []);
        const alreadySelected = base.includes(topicId);
        let next: string[];

        if (alreadySelected) {
          next = base.filter((id) => id !== topicId);
        } else {
          next = [...base, topicId];
        }

        // Mantiene la selezione primaria se ancora valida, altrimenti aggiorna
        if (next.length === 0) {
          setSelectedTopicId(undefined);
        } else if (alreadySelected && selectedTopicId === topicId) {
          setSelectedTopicId(next[next.length - 1]);
        } else if (!alreadySelected && !selectedTopicId) {
          setSelectedTopicId(topicId);
        }
        return next;
      });
    },
    [selectedTopicId]
  );

  return {
    selectedTopicId,
    selectedTopicIds,
    setSelectedTopicId,
    setSelectedTopicIds,
    selectSingle,
    onSelectTopic,
  };
}
