import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bug, Cloud, FileLock2, Info, Keyboard, Network, Palette, RefreshCw } from 'lucide-react';
import {
  Button,
  IconButton,
  Input,
  KbdGroup,
  Kbd,
  SegmentedControl,
  Switch,
  cn,
} from '@xmap/ui-kit';
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_PRESETS,
  clampUiScale,
  type MapStructureSetting,
  type Settings,
  type ThemePreference,
} from '../settings.js';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION_LABEL } from '../appInfo.js';
import type { UpdateStatus } from '../app/electronBridge.js';
import { hasPendingUpdate } from '../app/useUpdateStatus.js';
import { isDialogOpen } from '../app/dialogOpen.js';
import { AppMark } from './AppMark.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import { UpdatesSection } from './UpdatesSection.js';
import { NextcloudSection } from './NextcloudSection.js';
import { DebugSection } from './DebugSection.js';

interface SettingsPageProps {
  onClose: () => void;
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
  /** Sezione mostrata all'apertura; `appearance` se assente. */
  initialSection?: SettingsSectionId;
  /** Stato degli aggiornamenti dell'app desktop; `null` nel browser. */
  updateStatus: UpdateStatus | null;
}

const THEME_ITEMS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'Sistema' },
  { id: 'light', label: 'Chiaro' },
  { id: 'dark', label: 'Scuro' },
];

const STRUCTURE_ITEMS: { id: MapStructureSetting; label: string }[] = [
  { id: 'tree', label: 'Albero' },
  { id: 'logic', label: 'Logica' },
  { id: 'map', label: 'Mappa mentale' },
];

const UI_SCALE_ITEMS = UI_SCALE_PRESETS.map((value) => ({ id: String(value), label: `${value}%` }));

/** Ogni riga: keys sono i singoli tasti mostrati con `Kbd`. */
const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['Ctrl', 'S'], action: 'Salva' },
  { keys: ['Ctrl', 'Shift', 'S'], action: 'Salva con nome' },
  { keys: ['Ctrl', 'O'], action: 'Apri file' },
  { keys: ['Ctrl', 'Z'], action: 'Annulla' },
  { keys: ['Ctrl', 'Y'], action: 'Ripeti' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Ripeti' },
  { keys: ['Tab'], action: 'Nuovo figlio del blocco selezionato' },
  { keys: ['Invio'], action: 'Nuovo fratello' },
  { keys: ['F2'], action: 'Modifica testo' },
  { keys: ['Canc'], action: 'Elimina blocco' },
  { keys: ['←', '↑', '→', '↓'], action: 'Naviga tra i blocchi' },
  { keys: ['Ctrl', 'B'], action: 'Grassetto' },
  { keys: ['Ctrl', 'I'], action: 'Corsivo' },
  { keys: ['Ctrl', 'U'], action: 'Sottolineato' },
  { keys: ['Ctrl', 'Shift', 'L'], action: 'Editor della formula LaTeX' },
  { keys: ['Esc'], action: 'Deseleziona' },
  { keys: ['Ctrl', ','], action: 'Impostazioni' },
];

type SectionId = 'appearance' | 'map' | 'files' | 'cloud' | 'shortcuts' | 'updates' | 'about' | 'debug';

export type SettingsSectionId = SectionId;

/** Tocchi sulla versione per attivare il menu Debug, e pausa massima tra due tocchi. */
const DEBUG_TAPS_TO_ENABLE = 7;
const DEBUG_TAP_WINDOW_MS = 1500;
/** Dal terzo tocco in poi, il conto alla rovescia compare sotto la versione. */
const DEBUG_TAP_HINT_FROM = 3;
const NOTICE_MS = 3000;

/**
 * La sezione Aggiornamenti esiste solo nell'app desktop: nel browser non ha nulla da mostrare.
 * Nextcloud solo nel browser: il desktop ha già il file system.
 * Debug solo con il menu sbloccato (`developerMode`).
 */
const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  desktopOnly?: boolean;
  webOnly?: boolean;
  devOnly?: boolean;
}[] = [
  { id: 'appearance', label: 'Aspetto', icon: <Palette className="size-4" /> },
  { id: 'map', label: 'Mappa', icon: <Network className="size-4" /> },
  { id: 'files', label: 'File e sicurezza', icon: <FileLock2 className="size-4" /> },
  { id: 'cloud', label: 'Nextcloud', icon: <Cloud className="size-4" />, webOnly: true },
  { id: 'shortcuts', label: 'Scorciatoie', icon: <Keyboard className="size-4" /> },
  { id: 'updates', label: 'Aggiornamenti', icon: <RefreshCw className="size-4" />, desktopOnly: true },
  { id: 'about', label: 'Informazioni', icon: <Info className="size-4" /> },
  { id: 'debug', label: 'Debug', icon: <Bug className="size-4" />, devOnly: true },
];

/**
 * Scala dell'interfaccia: valori proposti più un campo libero.
 *
 * Il campo applica il valore solo a conferma (Invio o uscita dal campo): mentre
 * si digita "1" → "15" → "150" l'interfaccia non deve ridimensionarsi a ogni tasto.
 */
function UiScaleControl({ value, onChange }: { value: number; onChange: (uiScale: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = clampUiScale(Number.parseFloat(draft.replace(',', '.')));
    if (next === null) setDraft(String(value));
    else if (next !== value) onChange(next);
    else setDraft(String(value));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label="Scala predefinita"
        size="sm"
        items={UI_SCALE_ITEMS}
        activeId={String(value)}
        onChange={(id) => onChange(Number(id))}
      />
      <Input
        aria-label="Scala personalizzata in percento"
        size="sm"
        type="number"
        inputMode="numeric"
        min={UI_SCALE_MIN}
        max={UI_SCALE_MAX}
        step={5}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        trailing={<span className="text-muted-foreground">%</span>}
        className="w-24"
        inputClassName="tabular-nums"
      />
    </div>
  );
}

/**
 * Pagina impostazioni a tutto schermo, senza trasparenze.
 *
 * Perché non un `Modal`: le impostazioni sono una destinazione, non un
 * dialog. Occupa l'area sotto l'header (che resta visibile, con i controlli
 * finestra di Electron) e copre mappa e dettagli con una superficie opaca.
 * Il componente si monta solo da aperto, così lo stato locale riparte pulito.
 */
export function SettingsPage({ onClose, settings, onUpdate, onReset, initialSection, updateStatus }: SettingsPageProps) {
  const isElectron = Boolean(window.electronAPI);
  const [active, setActive] = useState<SectionId>(() =>
    initialSection === 'debug' && !settings.developerMode ? 'appearance' : (initialSection ?? 'appearance')
  );
  const visibleSections = SECTIONS.filter(
    (section) =>
      (!section.desktopOnly || isElectron) &&
      (!section.webOnly || !isElectron) &&
      (!section.devOnly || settings.developerMode)
  );
  const updateDot = hasPendingUpdate(updateStatus);
  const pageRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [tapCount, setTapCount] = useState(0);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(tapTimerRef.current);
      window.clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const showNotice = (message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const resetTaps = () => {
    tapCountRef.current = 0;
    setTapCount(0);
  };

  const onVersionTap = () => {
    window.clearTimeout(tapTimerRef.current);
    if (settings.developerMode) {
      resetTaps();
      showNotice('Il menu Debug è già attivo');
      setActive('debug');
      return;
    }
    const count = tapCountRef.current + 1;
    if (count < DEBUG_TAPS_TO_ENABLE) {
      tapCountRef.current = count;
      setTapCount(count);
      tapTimerRef.current = window.setTimeout(resetTaps, DEBUG_TAP_WINDOW_MS);
      return;
    }
    resetTaps();
    onUpdate({ developerMode: true });
    setActive('debug');
    showNotice('Menu Debug attivato');
  };

  const remainingTaps = DEBUG_TAPS_TO_ENABLE - tapCount;
  const tapHint =
    tapCount >= DEBUG_TAP_HINT_FROM
      ? `Ancora ${remainingTaps} ${remainingTaps === 1 ? 'tocco' : 'tocchi'} per attivare il menu Debug`
      : '';

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    pageRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Un dialog aperto sopra la pagina (Nextcloud, conferme) chiude da sé con Esc: la pagina resta.
      if (isDialogOpen()) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      ref={pageRef}
      role="region"
      aria-label="Impostazioni"
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col bg-background text-foreground outline-hidden max-md:overflow-y-auto md:flex-row"
    >
      <aside className="flex shrink-0 flex-col gap-3 border-b bg-background p-3 md:w-60 md:border-b-0 md:border-r md:p-4">
        <div className="flex items-center gap-2">
          <IconButton label="Torna alla mappa" size="sm" onClick={onClose}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <h1 className="text-base font-semibold">Impostazioni</h1>
        </div>
        <nav aria-label="Sezioni" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={active === section.id ? 'page' : undefined}
              onClick={() => setActive(section.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                active === section.id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {section.icon}
              {section.label}
              {section.id === 'updates' && updateDot ? (
                <span aria-hidden className="size-2 rounded-full bg-primary" />
              ) : null}
              {section.id === 'updates' && updateDot ? <span className="sr-only">, aggiornamento disponibile</span> : null}
            </button>
          ))}
        </nav>
        <Button variant="ghost" size="sm" className="mt-auto self-start max-md:hidden" onClick={onReset}>
          Ripristina predefinite
        </Button>
      </aside>

      <div className="min-h-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-8">
          {notice ? (
            <p aria-live="polite" className="text-sm text-foreground">
              {notice}
            </p>
          ) : null}

          {active === 'appearance' && (
            <SettingsSection title="Aspetto">
              <SettingRow label="Tema">
                <SegmentedControl
                  aria-label="Tema"
                  size="sm"
                  items={THEME_ITEMS}
                  activeId={settings.theme}
                  onChange={(theme) => onUpdate({ theme })}
                />
              </SettingRow>
              <SettingRow label="Riduci animazioni" hint="Disattiva transizioni e movimenti dell'interfaccia.">
                <Switch
                  aria-label="Riduci animazioni"
                  checked={settings.reduceMotion}
                  onCheckedChange={(reduceMotion) => onUpdate({ reduceMotion })}
                />
              </SettingRow>
              {isElectron ? (
                <SettingRow
                  label="Scala interfaccia"
                  hint={`Ingrandisce o rimpicciolisce tutta l'app, da ${UI_SCALE_MIN}% a ${UI_SCALE_MAX}%.`}
                >
                  <UiScaleControl value={settings.uiScale} onChange={(uiScale) => onUpdate({ uiScale })} />
                </SettingRow>
              ) : (
                <SettingRow
                  label="Scala interfaccia"
                  hint="Nel browser si usa lo zoom della pagina: Ctrl + e Ctrl − (⌘ su Mac), Ctrl 0 per tornare al 100%."
                >
                  {null}
                </SettingRow>
              )}
            </SettingsSection>
          )}

          {active === 'map' && (
            <SettingsSection title="Mappa">
              <SettingRow label="Struttura predefinita" hint="Dove si dispongono i rami all'apertura della mappa.">
                <SegmentedControl
                  aria-label="Struttura predefinita"
                  size="sm"
                  items={STRUCTURE_ITEMS}
                  activeId={settings.mapStructure}
                  onChange={(mapStructure) => onUpdate({ mapStructure })}
                />
              </SettingRow>
            </SettingsSection>
          )}

          {active === 'files' && (
            <SettingsSection title="File e sicurezza">
              <p className="py-2.5 text-sm text-muted-foreground">
                I backup sono salvati in <span className="font-mono text-foreground">.xmap-studio/backups/</span>,
                accanto al file; ne vengono conservati gli ultimi 5. Il salvataggio è bloccato mentre XMind è aperto.
              </p>
            </SettingsSection>
          )}

          {active === 'cloud' && !isElectron && <NextcloudSection />}

          {active === 'shortcuts' && (
            <SettingsSection title="Scorciatoie">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-2.5">
                {SHORTCUTS.map((shortcut) => (
                  <React.Fragment key={shortcut.keys.join('+') + shortcut.action}>
                    <span className="text-sm text-muted-foreground">{shortcut.action}</span>
                    <KbdGroup>
                      {shortcut.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </React.Fragment>
                ))}
              </div>
            </SettingsSection>
          )}

          {active === 'updates' && isElectron && <UpdatesSection status={updateStatus} />}

          {active === 'about' && (
            <SettingsSection title="Informazioni">
              <div className="flex items-start gap-3 py-2.5">
                <AppMark size={36} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{APP_NAME}</div>
                  <button
                    type="button"
                    onClick={onVersionTap}
                    className="cursor-default rounded-sm font-mono text-2xs text-muted-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {APP_VERSION_LABEL}
                  </button>
                  <p aria-live="polite" className="text-2xs text-muted-foreground">
                    {tapHint}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{APP_DESCRIPTION}</p>
                </div>
              </div>
            </SettingsSection>
          )}

          {active === 'debug' && settings.developerMode && (
            <DebugSection
              onDisable={() => {
                onUpdate({ developerMode: false });
                setActive('about');
              }}
            />
          )}

          <Button variant="ghost" size="sm" className="self-start md:hidden" onClick={onReset}>
            Ripristina predefinite
          </Button>
        </div>
      </div>
    </div>
  );
}
