import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { loadSectionState, saveSectionState } from './section-state.js';

// Sezione richiudibile: il disclosure è comportamento locale, quindi non usa `Section` di ui-kit.
export const InspectorSection: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  /** Riassunto breve mostrato a destra dell'intestazione quando la sezione è chiusa. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, icon, defaultOpen = false, summary, children }) => {
  const [open, setOpen] = useState(() => loadSectionState()[id] ?? defaultOpen);
  const toggle = () => {
    saveSectionState(id, !open);
    setOpen(!open);
  };
  return (
    <section className="border-b">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex items-center text-muted-foreground">{icon}</span>
        <span className="flex-1">{title}</span>
        {!open && summary != null && (
          <span className="flex items-center text-2xs font-normal text-muted-foreground">{summary}</span>
        )}
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className="flex flex-col gap-2 px-3 pb-3 pt-1">{children}</div>}
    </section>
  );
};
