import { lazy, useState, type ComponentType } from 'react';

/**
 * Componente caricato su richiesta (chunk separato) con un `preload` esplicito:
 * l'avvio non scarica né valuta le finestre che non servono subito.
 */
function lazyNamed<P extends object>(load: () => Promise<ComponentType<P>>) {
  let promise: Promise<ComponentType<P>> | null = null;
  const preload = () => {
    promise ??= load().catch((err: unknown) => {
      // Un chunk non arrivato (rete assente) non resta in cache: il prossimo tentativo riprova.
      promise = null;
      throw err;
    });
    return promise;
  };
  return { Component: lazy(async () => ({ default: await preload() })), preload };
}

export const LazyExportModal = lazyNamed(() => import('../components/ExportModal.js').then((m) => m.ExportModal));
export const LazyPrintModal = lazyNamed(() => import('../components/PrintModal.js').then((m) => m.PrintModal));
export const LazyThemeEditorModal = lazyNamed(() =>
  import('../components/ThemeEditorModal.js').then((m) => m.ThemeEditorModal)
);
export const LazyImportModal = lazyNamed(() => import('../components/ImportModal.js').then((m) => m.ImportModal));
export const LazySettingsPage = lazyNamed(() => import('../components/SettingsPage.js').then((m) => m.SettingsPage));
// Solo con un account Nextcloud collegato: chi non lo usa non lo scarica all'avvio.
export const LazyNextcloudBrowserModal = lazyNamed(() =>
  import('../components/NextcloudBrowserModal.js').then((m) => m.NextcloudBrowserModal)
);
export const LazyLatexEditorModal = lazyNamed(() =>
  import('../components/latex/LatexEditorModal.js').then((m) => m.LatexEditorModal)
);

/** Precarica tutte le finestre quando il browser è libero: alla prima apertura sono già pronte. */
export function preloadPanels(): void {
  const all = [LazyExportModal, LazyPrintModal, LazyThemeEditorModal, LazyImportModal, LazySettingsPage, LazyLatexEditorModal];
  const run = () => {
    for (const panel of all) panel.preload().catch((err: unknown) => console.warn('Pannello non precaricato:', err));
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 500);
}

/**
 * true dalla prima volta che `active` è vero: la finestra si monta alla prima apertura
 * e poi resta montata, così conserva lo stato tra un'apertura e l'altra come prima.
 */
export function useMountedOnce(active: boolean): boolean {
  const [mounted, setMounted] = useState(active);
  if (active && !mounted) setMounted(true);
  return mounted || active;
}
