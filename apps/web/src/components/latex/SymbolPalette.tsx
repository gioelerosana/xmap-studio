import React, { useState } from 'react';
import { cn } from '@xmap/ui-kit';

import { TEMPLATES } from './constants.js';
import { PALETTE_TABS, commandsOfGroup, type PaletteGroup } from './latexCatalog.js';

interface SymbolPaletteProps {
  /** Inserisce uno snippet del catalogo (con cursore dentro la prima `{}`). */
  onInsertSnippet: (snippet: string) => void;
  /** Inserisce LaTeX già completo (modelli). */
  onInsertText: (latex: string) => void;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

const TAB_STEPS: Record<string, number | undefined> = { ArrowRight: 1, ArrowLeft: -1 };

// Tavolozza compatta a schede: i bottoni mostrano il simbolo e inseriscono il comando al cursore.
export const SymbolPalette: React.FC<SymbolPaletteProps> = ({ onInsertSnippet, onInsertText }) => {
  const [tab, setTab] = useState<PaletteGroup>('structures');

  // Frecce sinistra/destra spostano la scheda, come in un tablist nativo.
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = TAB_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const index = PALETTE_TABS.findIndex((item) => item.id === tab);
    const next = PALETTE_TABS[(index + step + PALETTE_TABS.length) % PALETTE_TABS.length];
    if (!next) return;
    setTab(next.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="tablist"
        aria-label="Categorie di simboli"
        onKeyDown={handleTabKeyDown}
        className="-mx-1 flex gap-0.5 overflow-x-auto px-1"
      >
        {PALETTE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`latex-tab-${item.id}`}
            data-tab={item.id}
            aria-selected={tab === item.id}
            aria-controls="latex-palette-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            className={cn(
              'h-6 shrink-0 rounded-md px-2 text-xs font-medium transition-colors',
              FOCUS_RING,
              tab === item.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="latex-palette-panel"
        aria-labelledby={`latex-tab-${tab}`}
        // Il pannello si ferma a due righe e scorre; su schermi stretti scorre in orizzontale.
        className="-mx-1 flex max-h-[4.5rem] gap-0.5 overflow-y-auto px-1 max-sm:overflow-x-auto sm:flex-wrap"
      >
        {commandsOfGroup(tab).map((command) => (
          <button
            key={command.key}
            type="button"
            title={`${command.display}: ${command.description}`}
            aria-label={`${command.description}, ${command.display}`}
            // Il mousedown non deve togliere il focus (e la selezione) al campo LaTeX.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onInsertSnippet(command.snippet)}
            className={cn(
              'h-8 min-w-8 shrink-0 rounded-md px-1.5 text-sm text-foreground transition-colors hover:bg-accent',
              FOCUS_RING,
            )}
          >
            {command.glyph}
          </button>
        ))}
        {tab === 'structures' &&
          TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              title={template.latex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsertText(template.latex)}
              className={cn(
                'h-8 shrink-0 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                FOCUS_RING,
              )}
            >
              {template.label}
            </button>
          ))}
      </div>
    </div>
  );
};
