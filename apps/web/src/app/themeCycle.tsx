import type { ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../settings.js';

/** Ordine del pulsante tema: si parte da Sistema (il default) e si torna lì dopo Scuro. */
const NEXT_THEME: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };

const THEME_LABEL: Record<ThemePreference, string> = { system: 'Sistema', light: 'Chiaro', dark: 'Scuro' };

export function nextTheme(theme: ThemePreference): ThemePreference {
  return NEXT_THEME[theme];
}

/** Etichetta del pulsante: dice il tema attivo e quello che arriva al prossimo clic. */
export function themeCycleLabel(theme: ThemePreference): string {
  return `Tema: ${THEME_LABEL[theme]} (passa a ${THEME_LABEL[NEXT_THEME[theme]].toLowerCase()})`;
}

export function ThemeIcon({ theme }: { theme: ThemePreference }): ReactNode {
  if (theme === 'light') return <Sun className="size-4" />;
  if (theme === 'dark') return <Moon className="size-4" />;
  return <Monitor className="size-4" />;
}
