import React, { useState } from 'react';
import { Search, Tag, X } from 'lucide-react';
import { GROUPS, markerDisplayName } from '@xmap/core';
import type { MarkerGroup, MarkerInfo, TopicView } from '@xmap/core';
import { Field, Input, cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import { FOCUS_RING, chipClass } from './classes.js';
import { POPOVER_PANEL_CLASS, useCommitDraft } from './popover-fields.js';
import { ToolbarButton, ToolbarPopover } from './primitives.js';

export interface MarkersPopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

// Accetta "priority-7" (cattura "7"), rifiuta "priority-x" e "task-done".
// https://regex101.com/?flavor=javascript&regex=%5Epriority-(%5Cd%2B)%24&testString=priority-7%0Apriority-x%0Atask-done
const PRIORITY_ID = /^priority-(\d+)$/;
// Accetta "3/8 Done" (cattura "3/8"), rifiuta "Task Done" e "1/2 Starting".
// https://regex101.com/?flavor=javascript&regex=%5E(%5Cd%2B%5C%2F%5Cd%2B)%20Done%24&testString=3%2F8%20Done%0ATask%20Done%0A1%2F2%20Starting
const TASK_FRACTION_NAME = /^(\d+\/\d+) Done$/;
const GLYPH_FALLBACK_LENGTH = 3;

// Glifo compatto da mostrare nella tessera: il nome completo resta nel tooltip e sotto la tessera.
const markerGlyph = (id: string, name: string): string => {
  const priority = PRIORITY_ID.exec(id)?.[1];
  if (priority) return `P${priority}`;
  if (id.startsWith('task-')) {
    const fraction = TASK_FRACTION_NAME.exec(name)?.[1];
    if (fraction) return fraction;
    return name.includes('Starting') ? '0' : '✓';
  }
  if (id.startsWith('star-')) return '★';
  if (id.startsWith('flag-')) return '⚑';
  if (id.startsWith('smiley-')) return '☺';
  if (id.startsWith('arrow-')) return '→';
  return name.slice(0, GLYPH_FALLBACK_LENGTH);
};

const normalize = (value: string) => value.trim().toLowerCase();

const parseLabels = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const MarkerPills: React.FC<{ topic: TopicView; actions: TopicActions }> = ({ topic, actions }) => {
  if (topic.markers.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium">Sul blocco</div>
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
    </div>
  );
};

const MarkerTile: React.FC<{ marker: MarkerInfo; active: boolean; onToggle: () => void }> = ({
  marker,
  active,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={active}
    title={marker.name}
    className={cn(
      'flex h-10 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-control border px-0.5 transition-colors',
      FOCUS_RING,
      active
        ? 'border-primary bg-primary/8 text-primary dark:bg-primary/16'
        : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    )}
  >
    <span className="text-xs font-medium leading-none">{markerGlyph(marker.id, marker.name)}</span>
    <span className="w-full truncate text-center text-3xs leading-none">{marker.name}</span>
  </button>
);

const MarkerGrid: React.FC<{
  markers: readonly MarkerInfo[];
  topic: TopicView;
  actions: TopicActions;
  emptyText: string;
}> = ({ markers, topic, actions, emptyText }) => {
  if (markers.length === 0) return <div className="text-2xs text-muted-foreground">{emptyText}</div>;
  return (
    <div className="grid grid-cols-5 gap-1">
      {markers.map((m) => (
        <MarkerTile
          key={m.id}
          marker={m}
          active={topic.markers.includes(m.id)}
          onToggle={() => actions.toggleMarker(topic.id, m.id)}
        />
      ))}
    </div>
  );
};

const CategoryTabs: React.FC<{
  topic: TopicView;
  selectedId: string;
  onSelect: (id: string) => void;
}> = ({ topic, selectedId, onSelect }) => (
  <div
    role="tablist"
    aria-label="Categorie di marker"
    className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    {GROUPS.map((group) => {
      const selected = group.id === selectedId;
      const hasMarker = group.markers.some((m) => topic.markers.includes(m.id));
      return (
        <button
          key={group.id}
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onSelect(group.id)}
          className={cn(chipClass(selected), 'relative shrink-0 py-1')}
        >
          {group.label}
          {hasMarker && <span aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />}
        </button>
      );
    })}
  </div>
);

const MarkersSection: React.FC<{ topic: TopicView; actions: TopicActions }> = ({ topic, actions }) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(GROUPS[0]?.id ?? '');

  const needle = normalize(query);
  const searching = needle.length > 0;
  const selectedGroup: MarkerGroup | undefined = GROUPS.find((g) => g.id === selectedId);
  const shownMarkers = searching
    ? GROUPS.flatMap((g) => g.markers).filter((m) => normalize(m.name).includes(needle))
    : (selectedGroup?.markers ?? []);

  return (
    <div className="flex flex-col gap-2">
      <MarkerPills topic={topic} actions={actions} />
      <Input
        size="sm"
        value={query}
        placeholder="Cerca un marker…"
        aria-label="Cerca un marker"
        leading={<Search className="size-3.5 text-muted-foreground" />}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!searching && <CategoryTabs topic={topic} selectedId={selectedId} onSelect={setSelectedId} />}
      <MarkerGrid
        markers={shownMarkers}
        topic={topic}
        actions={actions}
        emptyText={searching ? 'Nessun marker trovato.' : 'Nessun marker in questa categoria.'}
      />
    </div>
  );
};

const LabelsField: React.FC<{ topic: TopicView; actions: TopicActions }> = ({ topic, actions }) => {
  const labelsDraft = useCommitDraft(topic.labels.join(', '), (value) => {
    const labels = parseLabels(value);
    if (labels.join(',') === topic.labels.join(',')) return;
    actions.setLabels(topic.id, labels);
  });
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
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
  );
};

const MarkersPanel: React.FC<{ topic: TopicView; actions: TopicActions }> = ({ topic, actions }) => (
  <div className="flex flex-col gap-3">
    <MarkersSection topic={topic} actions={actions} />
    <div className="flex flex-col gap-2 border-t pt-2">
      <LabelsField topic={topic} actions={actions} />
    </div>
  </div>
);

// Marker per categoria e etichette del blocco, in un unico pannello.
export const MarkersPopover: React.FC<MarkersPopoverProps> = ({ topic, actions }) => {
  if (!topic) {
    return (
      <ToolbarButton label="Marker ed etichette" disabled>
        <Tag className="size-4" />
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
          label="Marker ed etichette"
          active={open || topic.markers.length > 0 || topic.labels.length > 0}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <Tag className="size-4" />
        </ToolbarButton>
      )}
    >
      {() => <MarkersPanel key={topic.id} topic={topic} actions={actions} />}
    </ToolbarPopover>
  );
};
