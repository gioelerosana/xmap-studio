import React from 'react';
import { StickyNote } from 'lucide-react';
import type { TopicView } from '@xmap/core';
import { Textarea, cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import { chipClass } from './classes.js';
import { POPOVER_PANEL_CLASS, PopoverGroupLabel, useCommitDraft } from './popover-fields.js';
import { ToolbarButton, ToolbarPopover } from './primitives.js';
import { ignoreWord, misspelledWords, useSpellChecker } from '../../spell/spellcheck.js';

/** Parole da rivedere mostrate sotto le note; le altre si contano soltanto. */
const MAX_NOTE_SPELL_WORDS = 8;

/**
 * Parole delle note non trovate nei dizionari. Il campo di testo non può
 * sottolinearle, così si elencano qui: un clic le aggiunge a quelle ignorate.
 */
const NotesSpelling: React.FC<{ text: string }> = ({ text }) => {
  const spell = useSpellChecker();
  const words = misspelledWords(spell, text);
  if (words.length === 0) return null;
  const extra = words.length - MAX_NOTE_SPELL_WORDS;
  return (
    <div className="flex flex-col gap-1">
      <PopoverGroupLabel>Da rivedere</PopoverGroupLabel>
      <div role="group" aria-label="Parole da rivedere nelle note" className="flex flex-wrap gap-1">
        {words.slice(0, MAX_NOTE_SPELL_WORDS).map((word) => (
          <button
            key={word}
            type="button"
            title={`Ignora «${word}»: non verrà più segnalata`}
            aria-label={`Ignora «${word}»`}
            onClick={() => ignoreWord(word)}
            className={cn(chipClass(false), 'spell-error px-1.5 py-0.5')}
          >
            {word}
          </button>
        ))}
        {extra > 0 && <span className="self-center text-2xs text-muted-foreground">e altre {extra}</span>}
      </div>
      <div className="text-2xs text-muted-foreground">Tocca una parola per ignorarla.</div>
    </div>
  );
};

export interface NotesPopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

const DISPLAY_OPTIONS: { value: 'icon' | 'block' | null; label: string }[] = [
  { value: null, label: 'Predefinito' },
  { value: 'icon', label: 'Icona' },
  { value: 'block', label: 'Blocco' },
];

const NotesPanel: React.FC<{ topic: TopicView; actions: TopicActions; close: () => void }> = ({
  topic,
  actions,
  close,
}) => {
  const { draft, setDraft, flush } = useCommitDraft(topic.notes, (value) => actions.setNotes(topic.id, value));
  const display = topic.notesDisplay === 'icon' || topic.notesDisplay === 'block' ? topic.notesDisplay : null;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        rows={5}
        value={draft}
        placeholder="Appunti estesi del blocco…"
        aria-label="Note del blocco"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            flush();
            close();
          }
        }}
      />
      <NotesSpelling text={draft} />
      <div className="flex flex-col gap-1">
        <PopoverGroupLabel>Visualizzazione in XMind</PopoverGroupLabel>
        <div role="group" aria-label="Visualizzazione delle note" className="flex gap-1">
          {DISPLAY_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={display === o.value}
              onClick={() => actions.setNotesDisplay(topic.id, o.value)}
              className={cn(chipClass(display === o.value), 'flex-1 py-1')}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="text-2xs text-muted-foreground">Ctrl+Invio per salvare e chiudere.</div>
      </div>
    </div>
  );
};

// Note del blocco: bozza locale salvata a blur, chiusura o Ctrl/Cmd+Invio.
export const NotesPopover: React.FC<NotesPopoverProps> = ({ topic, actions }) => {
  if (!topic) {
    return (
      <ToolbarButton label="Note" disabled>
        <StickyNote className="size-4" />
      </ToolbarButton>
    );
  }
  return (
    <ToolbarPopover
      focusable
      panelClassName={POPOVER_PANEL_CLASS}
      trigger={({ open, toggle }) => (
        <ToolbarButton
          label="Note"
          active={open || !!topic.notes}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <StickyNote className="size-4" />
        </ToolbarButton>
      )}
    >
      {(close) => <NotesPanel key={topic.id} topic={topic} actions={actions} close={close} />}
    </ToolbarPopover>
  );
};
