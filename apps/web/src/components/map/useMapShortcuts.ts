import { useEffect } from 'react';
import type { MapEditing, MapHandlers } from './types.js';

const INTERACTIVE = 'input, textarea, select, button, [contenteditable="true"]';

/** Scorciatoie da tastiera della mappa (Ctrl/Cmd + lettera o parentesi) sul blocco selezionato. */
export function useMapShortcuts({
  selectedTopicId,
  editing,
  handlers,
}: {
  selectedTopicId?: string;
  editing: MapEditing | null;
  handlers: { readonly current: MapHandlers };
}) {
  // Scorciatoie da tastiera della mappa su desktop:
  // - Ctrl+Maiusc+L / Cmd+Maiusc+L: apre l'editor della formula LaTeX.
  // Usiamo Ctrl/Cmd anziché lettere semplici (D, L) perché la digitazione
  // di lettere su un blocco di testo selezionato avvia l'editing in place del titolo.
  useEffect(() => {
    if (!selectedTopicId || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta || e.altKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();
      // Ctrl+] (sommario) è una scorciatoia globale (useGlobalShortcuts): gestirla
      // anche qui creava due sommari con un solo tasto.
      if (e.shiftKey && key === 'l') {
        e.preventDefault();
        handlers.current.onOpenLatex(selectedTopicId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTopicId, editing]);

}
