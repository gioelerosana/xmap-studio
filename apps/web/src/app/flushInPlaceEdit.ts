/** L'elemento con il focus è l'editor in place del titolo di un blocco (NodeEditor)? */
function activeInPlaceEditor(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isContentEditable) return null;
  return active.closest('[data-map-ui]') ? active : null;
}

/** true se è in corso l'editing in place di un titolo: il testo non è ancora nel controller. */
export function isEditingInPlace(): boolean {
  return activeInPlaceEditor() !== null;
}

/**
 * Conferma l'editing in place del titolo di un blocco, se in corso: il blur
 * dell'editor (NodeEditor) scrive il testo nel controller. Da chiamare prima di
 * leggere lo stato per salvare, esportare o chiudere, altrimenti finirebbe nel
 * file il titolo vecchio (es. Ctrl+S premuto mentre si scrive).
 * Il tick d'attesa lascia applicare a React l'uscita dall'editing.
 */
export async function flushInPlaceEdit(): Promise<void> {
  const editor = activeInPlaceEditor();
  if (!editor) return;
  editor.blur();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
