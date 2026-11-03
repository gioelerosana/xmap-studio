import { useCallback, useEffect, useState } from 'react';

/**
 * Invito a installare l'app come PWA.
 *
 * Due strade secondo la piattaforma:
 * - Chromium (Android, Chrome/Edge): intercetta `beforeinstallprompt` e apre
 *   il prompt nativo dal bottone «Installa»;
 * - iOS/iPadOS Safari: nessun prompt programmatico, l'invito mostra le
 *   istruzioni manuali (Condividi → Aggiungi alla schermata Home).
 */
export interface InstallPrompt {
  /** Vero quando l'invito è visibile. */
  open: boolean;
  /** Piattaforma dell'utente: decide tra prompt nativo e istruzioni manuali. */
  platform: InstallPlatform;
  /** Vero se Chromium ha messo a disposizione il prompt nativo. */
  canPrompt: boolean;
  /** Apre il prompt nativo di installazione (solo Chromium). */
  install: () => void;
  /** Chiude l'invito e lo sospende per una settimana. */
  dismiss: () => void;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop';

/** Chiave della data (ms) dell'ultima chiusura esplicita dell'invito. */
const DISMISS_KEY = 'xmap-studio.install-dismissed-at';

/** Dopo una chiusura esplicita l'invito tace così a lungo, poi torna. */
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Evento `beforeinstallprompt` di Chromium, senza tipi nel DOM standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Evento differito di Chromium, conservato fuori da React: può arrivare prima del montaggio. */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Si blocca la mini-infobar del browser: l'invito è gestito dall'app.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  });
}

/** iPadOS 13+ si presenta come «Macintosh»: lo si riconosce dal touch multipunto. */
function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isAndroid = /\bAndroid\b/.test(ua);
  if (!isIOS && !isAndroid) return 'desktop';
  // Difesa in profondità: il desktop, anche con un monitor touch, ha quasi sempre
  // mouse o touchpad come puntatore primario; un telefono o tablet no.
  const coarse = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches;
  if (!coarse) return 'desktop';
  return isIOS ? 'ios' : 'android';
}

/** L'app gira già installata (aperta dalla schermata Home): l'invito non serve mai. */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS < 16.4 non espone la media query: resta la proprietà proprietaria di Safari.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Data (ms) dell'ultima chiusura esplicita salvata, se valida. */
function readDismissedAt(): number | null {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function useInstallPrompt(): InstallPrompt {
  const [platform] = useState(detectPlatform);
  const [standalone] = useState(isStandalone);
  const [dismissedAt, setDismissedAt] = useState<number | null>(readDismissedAt);
  const [canPrompt, setCanPrompt] = useState(() => deferredPrompt !== null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (): void => setCanPrompt(true);
    const onInstalled = (): void => {
      // Installata: si azzera anche l'eventuale silenzio salvato in localStorage.
      setInstalled(true);
      setDismissedAt(null);
      try {
        window.localStorage.removeItem(DISMISS_KEY);
      } catch {
        // localStorage può mancare (navigazione privata): non è un problema.
      }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    const now = Date.now();
    setDismissedAt(now);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(now));
    } catch {
      // localStorage può mancare: l'invito tornerà al prossimo avvio.
    }
  }, []);

  const install = useCallback(() => {
    const event = deferredPrompt;
    if (!event) return;
    deferredPrompt = null;
    setCanPrompt(false);
    void event.prompt();
    // Se l'utente rifiuta il prompt nativo vale come una chiusura esplicita:
    // si riparte con il periodo di silenzio.
    void event.userChoice.then((choice) => {
      if (choice.outcome === 'dismissed') dismiss();
    });
  }, [dismiss]);

  const open = platform !== 'desktop' && !standalone && !installed && !isCoolingDown(dismissedAt);

  return { open, platform, canPrompt, install, dismiss };
}

/** Vero durante il periodo di silenzio che segue una chiusura esplicita. */
function isCoolingDown(dismissedAt: number | null): boolean {
  return dismissedAt !== null && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}
