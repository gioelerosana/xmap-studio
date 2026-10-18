import React from 'react';
import {
  Button,
  KbdGroup,
  Kbd,
  Modal,
  SegmentedControl,
  Switch,
  cn,
} from '@xmap/ui-kit';
import type { MapStructureSetting, Settings, ThemePreference } from '../settings.js';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION_LABEL } from '../appInfo.js';
import { AppMark } from './AppMark.js';

interface SettingsPageProps {
  isOpen: boolean;
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
  { keys: ['Ctrl', 'I'], action: 'Apri i dettagli del blocco' },
  { keys: ['Ctrl', 'Shift', 'L'], action: 'Modifica la formula del blocco' },
  { keys: ['Esc'], action: 'Chiudi i dettagli, poi deseleziona' },
  { keys: ['Ctrl', ','], action: 'Impostazioni' },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

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

function SettingsSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-1', className)}>
      <SectionTitle>{title}</SectionTitle>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  );
}

export function SettingsPage({ isOpen, onClose, settings, onUpdate, onReset }: SettingsPageProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Impostazioni"
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            Ripristina predefinite
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
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
        </SettingsSection>

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

        <SettingsSection title="Interfaccia">
          <SettingRow
            label="Apri i dettagli alla selezione"
            hint="Su desktop. Di base i dettagli si aprono solo su richiesta (pulsante, scorciatoia o doppio clic)."
          >
            <Switch
              aria-label="Apri i dettagli alla selezione"
              checked={settings.detailsOnSelect}
              onCheckedChange={(detailsOnSelect) => onUpdate({ detailsOnSelect })}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection title="File e sicurezza">
          <p className="py-2.5 text-sm text-muted-foreground">
            I backup sono salvati in <span className="font-mono text-foreground">.xmap-studio/backups/</span>, accanto
            al file; ne vengono conservati gli ultimi 5. Il salvataggio è bloccato mentre XMind è aperto.
          </p>
        </SettingsSection>

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

        <SettingsSection title="Informazioni">
          <div className="flex items-start gap-3 py-2.5">
            <AppMark size={36} />
            <div className="min-w-0">
              <div className="text-sm font-medium">{APP_NAME}</div>
              <div className="font-mono text-2xs text-muted-foreground">{APP_VERSION_LABEL}</div>
              <p className="mt-1 text-sm text-muted-foreground">{APP_DESCRIPTION}</p>
            </div>
          </div>
        </SettingsSection>
      </div>
    </Modal>
  );
}
