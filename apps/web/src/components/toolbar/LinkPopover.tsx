import React from 'react';
import { Link as LinkIcon } from 'lucide-react';
import type { TopicView } from '@xmap/core';
import { Field, Input, cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import { chipClass } from './classes.js';
import { POPOVER_PANEL_CLASS, PopoverGroupLabel, useCommitDraft } from './popover-fields.js';
import { ToolbarButton, ToolbarPopover } from './primitives.js';

export interface LinkPopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

// Solo gli schemi web e posta si aprono dal browser: `file:` e `#id` restano da usare in XMind.
const OPENABLE_PREFIXES = ['http:', 'https:', 'mailto:'];
const isOpenableHref = (href: string) => {
  const lower = href.trim().toLowerCase();
  return OPENABLE_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

const LinkPanel: React.FC<{ topic: TopicView; actions: TopicActions; close: () => void }> = ({
  topic,
  actions,
  close,
}) => {
  const href = useCommitDraft(topic.href || '', (value) => {
    const next = value.trim();
    if (next === (topic.href || '')) return;
    actions.setHref(topic.id, next || null);
  });
  const openable = !!topic.href && isOpenableHref(topic.href);

  return (
    <div className="flex flex-col gap-2">
      <PopoverGroupLabel>Link</PopoverGroupLabel>
      <Field label="Link (URL, mailto:, file: o #id)">
        <Input
          autoFocus
          size="sm"
          value={href.draft}
          placeholder="https://…"
          onChange={(e) => href.setDraft(e.target.value)}
          onBlur={href.flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </Field>
      {topic.href && (
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!openable}
            onClick={() => window.open(topic.href ?? '', '_blank', 'noopener')}
            className={cn(chipClass(false), 'flex-1 py-1 disabled:pointer-events-none disabled:opacity-50')}
          >
            Apri
          </button>
          <button
            type="button"
            onClick={() => {
              actions.setHref(topic.id, null);
              close();
            }}
            className={cn(chipClass(false), 'flex-1 py-1')}
          >
            Rimuovi
          </button>
        </div>
      )}
    </div>
  );
};

// Pulsante Link con il collegamento ipertestuale del blocco.
export const LinkPopover: React.FC<LinkPopoverProps> = ({ topic, actions }) => {
  if (!topic) {
    return (
      <ToolbarButton label="Link" disabled>
        <LinkIcon className="size-4" />
      </ToolbarButton>
    );
  }
  return (
    <ToolbarPopover
      focusable
      align="end"
      panelClassName={POPOVER_PANEL_CLASS}
      trigger={({ open, toggle }) => (
        <ToolbarButton
          label="Link"
          active={open || !!topic.href}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <LinkIcon className="size-4" />
        </ToolbarButton>
      )}
    >
      {(close) => <LinkPanel key={topic.id} topic={topic} actions={actions} close={close} />}
    </ToolbarPopover>
  );
};
