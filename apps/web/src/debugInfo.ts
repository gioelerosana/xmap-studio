/*
 * Informazioni di ambiente per il menu Debug: versione, piattaforma, motore delle
 * formule, archiviazione, service worker e, nell'app desktop, il log del main process.
 * Tutto resta locale: il rapporto si copia o si scarica solo su richiesta dell'utente.
 */
import { getMathJaxVersion, isMathJaxReady } from '@xmap/core';
import { APP_NAME, APP_VERSION } from './appInfo.js';
import { formatLogAsText, formatValue, getLogEntries, type LogEntry, type LogLevel } from './debugLog.js';
import type { DesktopDebugInfo } from './app/electronBridge.js';

export interface DebugInfoRow {
  label: string;
  value: string;
}

export interface DebugInfoGroup {
  title: string;
  rows: DebugInfoRow[];
}

export interface DebugSnapshot {
  groups: DebugInfoGroup[];
  /** Log del main process Electron, già nel formato di `LogEntry`; vuoto nel browser. */
  mainLog: LogEntry[];
}

/** Iniettato da Vite (`define` in vite.config.ts); vuoto se la build non viene da git. */
declare const __APP_COMMIT__: string;

function row(label: string, value: unknown): DebugInfoRow {
  return { label, value: value === undefined || value === null || value === '' ? '—' : formatValue(value) };
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

async function readDesktopInfo(): Promise<DesktopDebugInfo | null> {
  const getter = window.electronAPI?.getDebugInfo;
  if (!getter) return null;
  try {
    return await getter();
  } catch (err) {
    return { error: formatValue(err), versions: {}, mainLog: [] };
  }
}

async function readServiceWorker(): Promise<string> {
  if (!('serviceWorker' in navigator)) return 'non supportato';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'non registrato';
    const state = registration.active?.state ?? registration.installing?.state ?? registration.waiting?.state;
    return `registrato (${state ?? 'senza worker attivo'}), scope ${registration.scope}`;
  } catch (err) {
    return `errore: ${formatValue(err)}`;
  }
}

async function readStorage(): Promise<string> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return 'non disponibile';
    return `${formatBytes(estimate.usage)} usati su ${formatBytes(estimate.quota)}`;
  } catch (err) {
    return `errore: ${formatValue(err)}`;
  }
}

function readLocalStorageKeys(): string {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) keys.push(key);
    }
    return keys.length ? keys.sort().join(', ') : 'vuoto';
  } catch {
    return 'non disponibile';
  }
}

function readSettings(): string {
  try {
    return window.localStorage.getItem('xmap-studio.settings') ?? 'predefinite';
  } catch {
    return 'non disponibile';
  }
}

function readMemory(): string | undefined {
  // `performance.memory` esiste solo in Chromium/Electron e non è nei tipi standard.
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return memory ? `${formatBytes(memory.usedJSHeapSize)} su ${formatBytes(memory.jsHeapSizeLimit)}` : undefined;
}

/** Raccoglie le informazioni di ambiente; non lancia: ciò che manca appare come "—" o "errore". */
export async function collectDebugSnapshot(): Promise<DebugSnapshot> {
  const [desktop, serviceWorker, storage] = await Promise.all([readDesktopInfo(), readServiceWorker(), readStorage()]);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;

  const groups: DebugInfoGroup[] = [
    {
      title: 'App',
      rows: [
        row('Nome', APP_NAME),
        row('Versione', APP_VERSION),
        row('Commit', __APP_COMMIT__),
        row('Modalità', import.meta.env.PROD ? 'produzione' : 'sviluppo'),
        row('Ambiente', window.electronAPI ? 'desktop (Electron)' : isStandalone ? 'web (PWA installata)' : 'web (browser)'),
        row('Avviata', new Date(performance.timeOrigin).toISOString()),
        row('Ora', new Date().toISOString()),
        row('URL', location.href),
      ],
    },
    {
      title: 'Sistema',
      rows: [
        row('User agent', navigator.userAgent),
        row('Piattaforma', desktop?.platform ?? navigator.platform),
        row('Lingua', `${navigator.language} (${navigator.languages?.join(', ') ?? ''})`),
        row('Fuso orario', Intl.DateTimeFormat().resolvedOptions().timeZone),
        row('Schermo', `${screen.width}×${screen.height} @${window.devicePixelRatio}x`),
        row('Finestra', `${window.innerWidth}×${window.innerHeight}`),
        row('Puntatore', window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse'),
        row('Tema di sistema', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'scuro' : 'chiaro'),
        row('CPU logiche', navigator.hardwareConcurrency),
        row('Memoria JS', readMemory()),
        row('Online', navigator.onLine ? 'sì' : 'no'),
      ],
    },
    {
      title: 'Motore e dati',
      rows: [
        row('MathJax', isMathJaxReady() ? `caricato (versione formule ${getMathJaxVersion()})` : 'non ancora caricato'),
        row('Service worker', serviceWorker),
        row('Archiviazione', storage),
        row('Chiavi localStorage', readLocalStorageKeys()),
        row('Impostazioni', readSettings()),
      ],
    },
  ];

  if (desktop) {
    groups.push({
      title: 'Desktop',
      rows: [
        ...(desktop.error ? [row('Errore', desktop.error)] : []),
        row('Sistema operativo', desktop.os),
        row('Architettura', desktop.arch),
        row('Pacchettizzata', desktop.isPackaged === undefined ? undefined : desktop.isPackaged ? 'sì' : 'no'),
        row('Eseguibile', desktop.execPath),
        row('Dati utente', desktop.userData),
        ...Object.entries(desktop.versions)
          .filter(([name]) => ['electron', 'chrome', 'node', 'v8'].includes(name))
          .map(([name, version]) => row(name, version)),
      ],
    });
  }

  const mainLog: LogEntry[] = (desktop?.mainLog ?? []).map((entry, index) => ({
    id: -(index + 1),
    time: entry.time,
    level: isLogLevel(entry.level) ? entry.level : 'info',
    source: 'main',
    message: entry.message,
    ...(entry.detail ? { detail: entry.detail } : {}),
  }));

  return { groups, mainLog };
}

/** Rapporto completo in testo: informazioni, log del renderer e del main process. */
export function formatDebugReport(snapshot: DebugSnapshot, rendererLog: readonly LogEntry[] = getLogEntries()): string {
  const sections = snapshot.groups.map(
    (group) => `## ${group.title}\n${group.rows.map((r) => `${r.label}: ${r.value}`).join('\n')}`
  );
  sections.push(`## Log dell'interfaccia (${rendererLog.length} voci)\n${formatLogAsText(rendererLog) || '(vuoto)'}`);
  if (window.electronAPI) {
    sections.push(`## Log del processo principale (${snapshot.mainLog.length} voci)\n${formatLogAsText(snapshot.mainLog) || '(vuoto)'}`);
  }
  return `# ${APP_NAME} — rapporto di debug\n\n${sections.join('\n\n')}\n`;
}
