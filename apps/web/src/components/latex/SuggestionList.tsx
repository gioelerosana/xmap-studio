import React from 'react';
import { cn } from '@xmap/ui-kit';

import type { LatexCommand } from './latexCatalog.js';

interface SuggestionListProps {
  id: string;
  items: LatexCommand[];
  activeIndex: number;
  optionId: (index: number) => string;
  onHover: (index: number) => void;
  onAccept: (index: number) => void;
}

// Elenco dei comandi proposti sotto il campo LaTeX (pattern listbox: il focus resta nel campo).
export const SuggestionList: React.FC<SuggestionListProps> = ({
  id,
  items,
  activeIndex,
  optionId,
  onHover,
  onAccept,
}) => (
  <ul
    id={id}
    role="listbox"
    aria-label="Comandi LaTeX suggeriti"
    className="absolute left-0 top-full z-20 mt-1 w-full max-w-md animate-pop-in rounded-lg border bg-popover p-1 shadow-dialog"
  >
    {items.map((command, index) => (
      <li
        key={command.key}
        id={optionId(index)}
        role="option"
        aria-selected={index === activeIndex}
        // Il mousedown non deve togliere il focus al campo: l'inserimento avviene qui.
        onMouseDown={(event) => {
          event.preventDefault();
          onAccept(index);
        }}
        onMouseMove={() => onHover(index)}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm',
          index === activeIndex && 'bg-accent text-accent-foreground',
        )}
      >
        <span className="w-8 shrink-0 text-center text-muted-foreground" aria-hidden>
          {command.glyph}
        </span>
        <span className="truncate font-mono text-xs">{command.display}</span>
        <span className="ml-auto truncate pl-2 text-2xs text-muted-foreground">{command.description}</span>
      </li>
    ))}
  </ul>
);
