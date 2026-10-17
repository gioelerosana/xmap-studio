/*
 * Preferenze dell'interfaccia, salvate in localStorage sotto una sola chiave.
 *
 * Perché un solo oggetto JSON: il formato resta leggibile e si estende senza
 * migrazioni. Ogni campo è validato da solo: un valore sbagliato o un JSON
 * corrotto ricadono sul default del singolo campo, senza perdere gli altri.
 * Le chiavi precedenti (tema non persistito, struttura della mappa, sidebar)
 * vengono lette solo se la chiave unica non esiste ancora.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type MapStructureSetting = 'tree' | 'logic';

export interface Settings {
  /** Sistema segue `prefers-color-scheme`; chiaro/scuro sono espliciti. */
  theme: ThemePreference;
  /** Struttura predefinita della mappa; il selettore nella mappa scrive qui. */
  mapStructure: MapStructureSetting;
  /** Barra laterale aperta all'avvio su desktop (la scelta fatta dal pulsante viene ricordata). */
  sidebarOnStartup: boolean;
  /** Su desktop, selezionare un blocco apre il pannello dettagli. */
  detailsOnSelect: boolean;
  /** Azzera transizioni e animazioni (classe `reduce-motion` su `<html>`). */
  reduceMotion: boolean;
}

const SETTINGS_KEY = 'xmap-studio.settings';
const LEGACY_STRUCTURE_KEY = 'xmap-studio.map-structure';
const LEGACY_SIDEBAR_KEY = 'xmap-studio.sidebar';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const STRUCTURES: readonly MapStructureSetting[] = ['tree', 'logic'];

function systemPrefers(query: string): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
}

/** Default al primo avvio: la riduzione delle animazioni parte dalla preferenza di sistema. */
export function defaultSettings(): Settings {
  return {
    theme: 'system',
    mapStructure: 'tree',
    sidebarOnStartup: false,
    detailsOnSelect: false,
    reduceMotion: systemPrefers(REDUCE_MOTION_QUERY),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** Valida campo per campo: ciò che non è valido torna al valore di `base`. */
export function sanitizeSettings(value: unknown, base: Settings): Settings {
  const record = isRecord(value) ? value : {};
  return {
    theme: pickOneOf(record.theme, THEMES, base.theme),
    mapStructure: pickOneOf(record.mapStructure, STRUCTURES, base.mapStructure),
    sidebarOnStartup: typeof record.sidebarOnStartup === 'boolean' ? record.sidebarOnStartup : base.sidebarOnStartup,
    detailsOnSelect:
      typeof record.detailsOnSelect === 'boolean' ? record.detailsOnSelect : base.detailsOnSelect,
    reduceMotion: typeof record.reduceMotion === 'boolean' ? record.reduceMotion : base.reduceMotion,
  };
}

function readRawSettings(): string | null {
  try {
    return window.localStorage?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    return null;
  }
}

function readLegacy(defaults: Settings): Settings {
  let structure: string | null = null;
  let sidebar: string | null = null;
  try {
    structure = window.localStorage?.getItem(LEGACY_STRUCTURE_KEY) ?? null;
    sidebar = window.localStorage?.getItem(LEGACY_SIDEBAR_KEY) ?? null;
  } catch {
    return defaults;
  }
  return {
    ...defaults,
    mapStructure: structure === 'logic' ? 'logic' : defaults.mapStructure,
    sidebarOnStartup: sidebar === 'open' ? true : defaults.sidebarOnStartup,
  };
}

function readStoredSettings(): Settings {
  const defaults = defaultSettings();
  const raw = readRawSettings();
  if (raw === null) return readLegacy(defaults);
  try {
    return sanitizeSettings(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

function getSettings(): Settings {
  current ??= readStoredSettings();
  return current;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== SETTINGS_KEY) return;
  current = readStoredSettings();
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorageEvent);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorageEvent);
  };
}

/** Scrive le preferenze: la memoria si aggiorna sempre; se l'archiviazione manca valgono solo per la sessione. */
export function writeSettings(next: Settings): void {
  current = next;
  emit();
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (err) {
    // Non si interrompe la UI per una preferenza: resta attiva fino alla chiusura.
    console.warn('Impossibile salvare le impostazioni: l’archiviazione del browser non è disponibile.', err);
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  writeSettings({ ...getSettings(), ...patch });
}

export function resetSettings(): void {
  writeSettings(defaultSettings());
}

function subscribeDarkScheme(listener: () => void): () => void {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', listener);
  return () => mql.removeEventListener('change', listener);
}

function getSystemDark(): boolean {
  return systemPrefers(DARK_QUERY);
}

export interface SettingsHandle {
  settings: Settings;
  /** Tema effettivo: il booleano che il resto dell'app usa per colori e icone. */
  darkMode: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

/** Legge e scrive le preferenze; le modifiche si propagano a tutti i componenti e alle altre schede. */
export function useSettings(): SettingsHandle {
  const settings = useSyncExternalStore(subscribe, getSettings, getSettings);
  const systemDark = useSyncExternalStore(subscribeDarkScheme, getSystemDark, () => false);
  const darkMode = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
  }, [settings.reduceMotion]);

  const update = useCallback((patch: Partial<Settings>) => updateSettings(patch), []);
  const reset = useCallback(() => resetSettings(), []);
  return { settings, darkMode, update, reset };
}
