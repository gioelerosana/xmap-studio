/*
 * Adattatore web per Nextcloud: collegamento, ultima cartella e client.
 *
 * Perché un modulo a parte: impostazioni e finestra di scelta file leggono lo
 * stesso collegamento, e il client del core riceve solo il trasporto (il proxy
 * `/nc/` e `fetch`), mai la logica di archiviazione. Le credenziali sono una app
 * password revocabile e restano solo in questo browser (localStorage).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { NextcloudClient, type NextcloudAccount, type NextcloudTransport } from '@xmap/core';

export type NextcloudFileRef = { path: string; etag: string | null };

const ACCOUNT_KEY = 'xmap-studio.nextcloud';
const LAST_DIR_KEY = 'xmap-studio.nextcloud.lastDir';
const PROXY_BASE = '/nc/';
const ROOT_DIR = '/';

/**
 * Il proxy `/nc/` esiste solo sul sito della web app (http/https): non
 * nell'app desktop (Electron, `file://`) né nel wrapper iOS (`app://`).
 */
export function nextcloudAvailable(): boolean {
  const { protocol } = window.location;
  return !window.electronAPI && (protocol === 'https:' || protocol === 'http:');
}

export function nextcloudTransport(): NextcloudTransport {
  return { fetch: (input, init) => window.fetch(input, init), proxyBase: PROXY_BASE };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Valida il collegamento salvato. `displayName` è facoltativo: se manca o non
 * è valido si scarta, senza far perdere il collegamento all'utente.
 */
function parseAccount(value: unknown): NextcloudAccount | null {
  if (!isRecord(value)) return null;
  const { server, loginName, appPassword, userId, displayName } = value;
  if (!isNonEmptyString(server) || !isNonEmptyString(loginName) || !isNonEmptyString(appPassword) || !isNonEmptyString(userId)) {
    return null;
  }
  const account: NextcloudAccount = { server, loginName, appPassword, userId };
  if (isNonEmptyString(displayName)) account.displayName = displayName;
  return account;
}

/** Legge il collegamento dall'archiviazione; `null` se manca, è corrotto o lo storage non c'è. */
export function loadNextcloudAccount(): NextcloudAccount | null {
  let raw: string | null;
  try {
    raw = window.localStorage?.getItem(ACCOUNT_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return parseAccount(JSON.parse(raw));
  } catch {
    return null;
  }
}

/* Stato condiviso: la memoria è la fonte per la UI, lo storage la persiste. */

let snapshot: { account: NextcloudAccount | null } | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): NextcloudAccount | null {
  snapshot ??= { account: loadNextcloudAccount() };
  return snapshot.account;
}

function emit(account: NextcloudAccount | null): void {
  snapshot = { account };
  for (const listener of listeners) listener();
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== ACCOUNT_KEY) return;
  emit(loadNextcloudAccount());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorageEvent);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorageEvent);
  };
}

/**
 * Salva il collegamento. La memoria si aggiorna sempre: se lo storage manca il
 * collegamento vale solo fino alla chiusura della scheda.
 */
export function saveNextcloudAccount(account: NextcloudAccount): void {
  emit(account);
  try {
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch (err) {
    console.warn('Impossibile salvare il collegamento a Nextcloud: l’archiviazione del browser non è disponibile.', err);
  }
}

export function clearNextcloudAccount(): void {
  emit(null);
  try {
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch (err) {
    console.warn('Impossibile rimuovere il collegamento a Nextcloud dall’archiviazione del browser.', err);
  }
}

export function nextcloudClient(account: NextcloudAccount): NextcloudClient {
  return new NextcloudClient(account, nextcloudTransport());
}

/** Collegamento corrente e azioni per collegare o scollegare l'account. */
export function useNextcloudAccount(): {
  account: NextcloudAccount | null;
  connect: (account: NextcloudAccount) => void;
  disconnect: () => Promise<void>;
} {
  const account = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const connect = useCallback((next: NextcloudAccount) => saveNextcloudAccount(next), []);
  const disconnect = useCallback(async () => {
    const current = getSnapshot();
    if (current) {
      try {
        await nextcloudClient(current).revokeAppPassword();
      } catch (err) {
        // La revoca può fallire (rete, server): il collegamento locale si rimuove comunque.
        console.warn('Revoca dell’app password Nextcloud non riuscita: il collegamento viene rimosso comunque.', err);
      }
    }
    clearNextcloudAccount();
  }, []);
  return { account, connect, disconnect };
}

/** Ultima cartella sfogliata nella finestra Nextcloud; la radice se manca o non è valida. */
export function loadLastNextcloudDir(): string {
  try {
    const raw = window.localStorage?.getItem(LAST_DIR_KEY);
    if (typeof raw === 'string' && raw.startsWith(ROOT_DIR)) return raw;
  } catch {
    // Preferenza non critica: senza storage si parte dalla radice.
  }
  return ROOT_DIR;
}

export function saveLastNextcloudDir(dir: string): void {
  try {
    window.localStorage.setItem(LAST_DIR_KEY, dir);
  } catch (err) {
    console.warn('Impossibile ricordare la cartella Nextcloud: l’archiviazione del browser non è disponibile.', err);
  }
}
