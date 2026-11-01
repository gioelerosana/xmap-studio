const cached = new Map<string, boolean>();

function isRoleOpen(role: 'dialog' | 'listbox'): boolean {
  let open = cached.get(role);
  if (open === undefined) {
    open = document.querySelector(`[role="${role}"]`) !== null;
    if (cached.size === 0) setTimeout(() => cached.clear(), 0);
    cached.set(role, open);
  }
  return open;
}

/**
 * true se è aperto un dialog (modale, editor LaTeX, popover della barra): le
 * scorciatoie della mappa allora tacciono. Una pressione di tasto attraversa
 * diversi listener e ognuno lo chiede: la query scorre tutto il documento
 * (migliaia di elementi con una mappa grande), quindi se ne fa una per task.
 */
export function isDialogOpen(): boolean {
  return isRoleOpen('dialog');
}

/** true se è aperto un elenco a discesa (Select); stessa cache per task di `isDialogOpen`. */
export function isListboxOpen(): boolean {
  return isRoleOpen('listbox');
}
