import { useEffect } from 'react';
import { isDialogOpen } from '../../app/dialogOpen.js';
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
  // - Ctrl+Maiusc+L / Cmd+Maiusc+L: apre l'editor della formula LaTeX sul blocco selezionato,
  //   anche mentre se ne modifica il titolo (es. blocco appena creato): il testo si conferma
  //   prima, togliendo il focus all'editor.
  // Usiamo Ctrl/Cmd anziché lettere semplici (D, L) perché la digitazione
  // di lettere su un blocco di testo selezionato avvia l'editing in place del titolo.
  const targetId = editing?.id ?? selectedTopicId;
  useEffect(() => {
    if (!targetId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta || e.altKey) return;
      const target = e.target as Element | null;
      const inNodeEditor = !!target?.closest?.('[data-node-editor]');
      if ((!inNodeEditor && target?.closest?.(INTERACTIVE)) || isDialogOpen()) return;

      const key = e.key.toLowerCase();
      // Ctrl+] (sommario) è una scorciatoia globale (useGlobalShortcuts): gestirla
      // anche qui creava due sommari con un solo tasto.
      if (e.shiftKey && key === 'l') {
        e.preventDefault();
        if (inNodeEditor && target instanceof HTMLElement) target.blur();
        handlers.current.onOpenLatex(targetId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targetId]);

}
