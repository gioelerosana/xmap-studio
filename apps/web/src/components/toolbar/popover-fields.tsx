import React, { useEffect, useRef, useState } from 'react';

/** Larghezza e altezza massima comuni ai pannelli: densi, con scroll interno. */
export const POPOVER_PANEL_CLASS = 'w-[19rem] max-w-[calc(100vw-1rem)] max-h-[60dvh] overflow-y-auto p-3';

/** Intestazione di un gruppo dentro un pannello. */
export const PopoverGroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium">{children}</div>
);

/**
 * Bozza locale di un campo di testo: si risincronizza quando il modello cambia sotto di lei
 * (undo/redo) e si committa con `flush()` (blur, Invio) e alla chiusura del pannello.
 * Il commit parte solo se la bozza è diversa dall'ultimo valore noto, così blur e chiusura
 * nello stesso istante non creano due passi di undo.
 */
export function useCommitDraft(modelValue: string, commit: (draft: string) => void) {
  const [draft, setDraft] = useState(modelValue);
  const draftRef = useRef(draft);
  const knownRef = useRef(modelValue);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const update = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };

  useEffect(() => {
    knownRef.current = modelValue;
    draftRef.current = modelValue;
    setDraft(modelValue);
  }, [modelValue]);

  const flush = () => {
    if (draftRef.current === knownRef.current) return;
    knownRef.current = draftRef.current;
    commitRef.current(draftRef.current);
  };

  // Alla chiusura il pannello viene smontato: l'ultima bozza va salvata.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  return { draft, setDraft: update, flush };
}
