import React, { useMemo, useState } from 'react';
import { Ellipsis, Search, X } from 'lucide-react';
import { GROUPS, markerDisplayName } from '@xmap/core';
import type { TopicView } from '@xmap/core';
import { Field, Input, cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import { FOCUS_RING, chipClass } from './classes.js';
import { POPOVER_PANEL_CLASS, PopoverGroupLabel, useCommitDraft } from './popover-fields.js';
import { ToolbarButton, ToolbarPopover } from './primitives.js';

export interface MorePopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

const MarkersGroup: React.FC<{ topic: TopicView; actions: TopicActions }> = ({ topic, actions }) => {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({ ...g, markers: g.markers.filter((m) => m.name.toLowerCase().includes(q)) })).filter(
      (g) => g.markers.length > 0,
    );
  }, [filter]);

  return (
    <div className="flex flex-col gap-1.5">
      <PopoverGroupLabel>Marker</PopoverGroupLabel>
      {topic.markers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {topic.markers.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => actions.toggleMarker(topic.id, m)}
              title="Rimuovi marker"
              className={cn(
                'flex items-center gap-1 rounded-sm bg-primary/8 px-1.5 py-0.5 text-2xs text-primary dark:bg-primary/16',
                FOCUS_RING,
              )}
            >
              {markerDisplayName(m)}
              <X className="size-3.5" />
            </button>
          ))}
        </div>
      )}
      <Input
        size="sm"
        value={filter}
        placeholder="Filtra i marker…"
        aria-label="Filtra i marker"
        leading={<Search className="size-3.5 text-muted-foreground" />}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
        {groups.length === 0 && <div className="text-2xs text-muted-foreground">Nessun marker trovato.</div>}
        {groups.map((group) => (
          <div key={group.id}>
            <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.markers.map((m) => {
                const active = topic.markers.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => actions.toggleMarker(topic.id, m.id)}
                    aria-pressed={active}
                    title={m.name}
                    className={chipClass(active)}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const parseLabels = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const LinksGroup: React.FC<{ topic: TopicView; actions: TopicActions }> = ({ topic, actions }) => {
  const labelsDraft = useCommitDraft(topic.labels.join(', '), (value) => {
    const labels = parseLabels(value);
    if (labels.join(',') === topic.labels.join(',')) return;
    actions.setLabels(topic.id, labels);
  });
  const hrefDraft = useCommitDraft(topic.href || '', (value) => {
    const href = value.trim();
    if (href === (topic.href || '')) return;
    actions.setHref(topic.id, href || null);
  });
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <div className="flex flex-col gap-2">
      <PopoverGroupLabel>Etichette e link</PopoverGroupLabel>
      <Field label="Etichette (separate da virgola)">
        <Input
          size="sm"
          value={labelsDraft.draft}
          placeholder="Importante, Revisione"
          onChange={(e) => labelsDraft.setDraft(e.target.value)}
          onBlur={labelsDraft.flush}
          onKeyDown={blurOnEnter}
        />
      </Field>
      <Field label="Link (URL, mailto:, file: o #id)">
        <Input
          size="sm"
          value={hrefDraft.draft}
          placeholder="https://…"
          onChange={(e) => hrefDraft.setDraft(e.target.value)}
          onBlur={hrefDraft.flush}
          onKeyDown={blurOnEnter}
        />
      </Field>
    </div>
  );
};

// Menu ⋯ con marker, etichette e link del blocco.
export const MorePopover: React.FC<MorePopoverProps> = ({ topic, actions }) => {
  if (!topic) {
    return (
      <ToolbarButton label="Altro" disabled>
        <Ellipsis className="size-[18px]" />
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
          label="Altro"
          active={open || topic.markers.length > 0 || topic.labels.length > 0 || !!topic.href}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <Ellipsis className="size-[18px]" />
        </ToolbarButton>
      )}
    >
      {() => (
        <div key={topic.id} className="flex flex-col gap-3">
          <MarkersGroup topic={topic} actions={actions} />
          <LinksGroup topic={topic} actions={actions} />
        </div>
      )}
    </ToolbarPopover>
  );
};
