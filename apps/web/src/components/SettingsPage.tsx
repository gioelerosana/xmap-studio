import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileLock2, Info, Keyboard, Network, Palette } from 'lucide-react';
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
import { AppMark } from './AppMark.js';

interface SettingsPageProps {
  onClose: () => void;
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
}

const THEME_ITEMS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'Sistema' },
  { id: 'light', label: 'Chiaro' },
  { id: 'dark', label: 'Scuro' },
];

const STRUCTURE_ITEMS: { id: MapStructureSetting; label: string }[] = [
  { id: 'tree', label: 'Albero' },
  { id: 'logic', label: 'Logica' },
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

type SectionId = 'appearance' | 'map' | 'files' | 'shortcuts' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Aspetto', icon: <Palette className="size-4" /> },
  { id: 'map', label: 'Mappa', icon: <Network className="size-4" /> },
  { id: 'files', label: 'File e sicurezza', icon: <FileLock2 className="size-4" /> },
  { id: 'shortcuts', label: 'Scorciatoie', icon: <Keyboard className="size-4" /> },
  { id: 'about', label: 'Informazioni', icon: <Info className="size-4" /> },
];

/** Riga di impostazione: su schermi stretti il controllo va sotto l'etichetta. */
function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint ? <div className="mt-0.5 text-2xs text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  );
}

type UpdateState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string };

/** Windows: controlla GitHub e scarica la nuova versione; Linux: la gestisce il gestore di AppImage. */
function UpdateControl() {
  const [platform, setPlatform] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  useEffect(() => {
    void window.electronAPI?.platform().then(setPlatform);
  }, []);

  const check = async () => {
    if (!window.electronAPI) return;
    setState({ kind: 'busy' });
    const outcome = await window.electronAPI.checkAndDownloadUpdate();
    const message = {
      unsupported: () => 'Gli aggiornamenti non sono gestiti da qui su questo sistema.',
      upToDate: () => 'Hai già la versione più recente.',
      downloaded: () =>
        outcome.status === 'downloaded'
          ? `Versione ${outcome.version} scaricata in ${outcome.path}. Chiudi l'app e avvia il nuovo file.`
          : '',
      error: () => (outcome.status === 'error' ? `Controllo non riuscito: ${outcome.message}` : ''),
    }[outcome.status]();
    setState({ kind: 'done', message });
  };

  if (platform === null) return null;
  if (platform !== 'win32') {
    return (
      <SettingRow
        label="Aggiornamenti"
        hint="L'AppImage si aggiorna dal tuo gestore di AppImage (AppImageUpdate, Gear Lever, …) tramite zsync."
      >
        {null}
      </SettingRow>
    );
  }
  return (
    <SettingRow
      label="Aggiornamenti"
      hint={state.kind === 'done' ? state.message : 'Controlla GitHub e scarica l’ultima versione nei Download.'}
    >
      <Button size="sm" variant="secondary" disabled={state.kind === 'busy'} onClick={() => void check()}>
        {state.kind === 'busy' ? 'Controllo in corso…' : 'Controlla aggiornamenti'}
      </Button>
    </SettingRow>
  );
}

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
export function SettingsPage({ onClose, settings, onUpdate, onReset }: SettingsPageProps) {
  const isElectron = Boolean(window.electronAPI);
  const [active, setActive] = useState<SectionId>('appearance');
  const pageRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    pageRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
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
      className="absolute inset-0 z-30 flex flex-col bg-background text-foreground outline-none max-md:overflow-y-auto md:flex-row"
    >
      <aside className="flex shrink-0 flex-col gap-3 border-b bg-background p-3 md:w-60 md:border-b-0 md:border-r md:p-4">
        <div className="flex items-center gap-2">
          <IconButton label="Torna alla mappa" size="sm" onClick={onClose}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <h1 className="text-base font-semibold">Impostazioni</h1>
        </div>
        <nav aria-label="Sezioni" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={active === section.id ? 'page' : undefined}
              onClick={() => setActive(section.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                active === section.id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </nav>
        <Button variant="ghost" size="sm" className="mt-auto self-start max-md:hidden" onClick={onReset}>
          Ripristina predefinite
        </Button>
      </aside>

      <div className="min-h-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-8">
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

          {active === 'about' && (
            <SettingsSection title="Informazioni">
              <div className="flex items-start gap-3 py-2.5">
                <AppMark size={36} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{APP_NAME}</div>
                  <div className="font-mono text-2xs text-muted-foreground">{APP_VERSION_LABEL}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{APP_DESCRIPTION}</p>
                </div>
              </div>
              {isElectron ? <UpdateControl /> : null}
            </SettingsSection>
          )}

          <Button variant="ghost" size="sm" className="self-start md:hidden" onClick={onReset}>
            Ripristina predefinite
          </Button>
        </div>
      </div>
    </div>
  );
}
