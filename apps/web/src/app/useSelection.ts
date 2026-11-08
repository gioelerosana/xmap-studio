import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export interface SelectionState {
  selectedTopicId: string | undefined;
  selectedTopicIds: string[];
  setSelectedTopicId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedTopicIds: Dispatch<SetStateAction<string[]>>;
  /** Selezione singola (o vuota) con primaria e lista allineate. */
  selectSingle: (id: string | undefined) => void;
  /**
   * Sostituisce la selezione con `ids` (selezione ad area): la primaria resta la stessa se è
   * ancora selezionata, altrimenti diventa il primo blocco dell'elenco.
   */
  selectMany: (ids: string[]) => void;
  onSelectTopic: (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  /**
   * Modalità selezione (pulsante della barra, pensato per il touch dove non ci sono Maiusc/Ctrl):
   * ogni tap su un blocco lo aggiunge o lo toglie dalla selezione, come Ctrl+clic, e trascinando
   * sullo sfondo si disegna un'area che seleziona i blocchi che tocca.
   */
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  /**
   * Chiude la modalità selezione: la chiamano le operazioni sulla selezione (copia, sommario,
   * eliminazione, nuovi blocchi, …) a lavoro fatto, così si torna da soli alla modalità normale.
   */
  exitSelectionMode: () => void;
}

export function useSelection(): SelectionState {
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionModeRef = useRef(selectionMode);
  selectionModeRef.current = selectionMode;
  const exitSelectionMode = useCallback(() => setSelectionMode(false), []);
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

  const selectMany = useCallback((ids: string[]) => {
    setSelectedTopicIds(ids);
    setSelectedTopicId((prev) => (prev !== undefined && ids.includes(prev) ? prev : ids[0]));
  }, []);

  const onSelectTopic = useCallback(
    (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => {
      const isMulti = Boolean(modifiers?.shiftKey || modifiers?.ctrlKey || selectionModeRef.current);
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
    selectMany,
    onSelectTopic,
    selectionMode,
    setSelectionMode,
    exitSelectionMode,
  };
}
