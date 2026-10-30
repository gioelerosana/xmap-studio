import React, { useMemo, useState } from 'react';
import { Boxes, Search, Spline, X } from 'lucide-react';
import type { RelationshipView, TopicView } from '@xmap/core';
import { Button, Input, Select, Switch, cn } from '@xmap/ui-kit';

import type { TopicActions } from '../../app/useTopicActions.js';
import { FOCUS_RING } from './classes.js';
import { RELATIONSHIP_SHAPES } from './constants.js';
import { POPOVER_PANEL_CLASS, PopoverGroupLabel } from './popover-fields.js';
import { ToolbarButton, ToolbarPopover } from './primitives.js';

export interface StructurePopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  allTopics: TopicView[];
  relationships: RelationshipView[];
  actions: TopicActions;
  selectedTopicIds: string[];
  canAddSummary: boolean;
  onAddSummaryForSelection: () => void;
  onStartConnectRelationship: (topicId: string) => void;
}

/** Massimo di risultati mostrati nel selettore "Collega a…": la ricerca restringe il resto. */
const MAX_PICKER_RESULTS = 50;

type PanelProps = StructurePopoverProps & { topic: TopicView; close: () => void };

const RelationshipRow: React.FC<{
  rel: RelationshipView;
  topic: TopicView;
  allTopics: TopicView[];
  actions: TopicActions;
}> = ({ rel, topic, allTopics, actions }) => {
  const outgoing = rel.end1Id === topic.id;
  const otherId = outgoing ? rel.end2Id : rel.end1Id;
  const other = allTopics.find((x) => x.id === otherId);
  return (
    <div className="flex items-center gap-1.5 text-2xs">
      <span className="flex-1 truncate" title={other?.displayTitle || otherId}>
        {outgoing ? '→' : '←'} {other?.displayTitle || otherId}
        {rel.title ? ` · ${rel.title}` : ''}
      </span>
      <Select
        size="sm"
        aria-label="Forma della freccia"
        className="w-24 shrink-0"
        value={rel.style.shape}
        options={RELATIONSHIP_SHAPES.map((s) => ({ value: s.id, label: s.label }))}
        onValueChange={(shape) => actions.setRelationshipShape(rel.id, shape)}
      />
      <button
        type="button"
        aria-label="Rimuovi freccia"
        title="Rimuovi freccia"
        onClick={() => actions.removeRelationship(rel.id)}
        className={cn('rounded-sm text-muted-foreground hover:text-error-foreground', FOCUS_RING)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};

const TopicPicker: React.FC<{ topic: TopicView; allTopics: TopicView[]; actions: TopicActions }> = ({
  topic,
  allTopics,
  actions,
}) => {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allTopics
      .filter((x) => x.id !== topic.id && (x.displayTitle || x.id).toLowerCase().includes(q))
      .slice(0, MAX_PICKER_RESULTS);
  }, [allTopics, topic.id, query]);

  return (
    <div className="flex flex-col gap-1">
      <Input
        size="sm"
        value={query}
        placeholder="Collega a… (cerca un blocco)"
        aria-label="Collega a un altro blocco"
        leading={<Search className="size-3.5 text-muted-foreground" />}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() !== '' && (
        <div className="flex max-h-32 flex-col overflow-y-auto rounded-control border">
          {matches.length === 0 && <div className="px-2 py-1.5 text-2xs text-muted-foreground">Nessun blocco trovato.</div>}
          {matches.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => {
                actions.addRelationship(topic.id, x.id);
                setQuery('');
              }}
              className={cn(
                'truncate px-2 py-1 text-left text-2xs hover:bg-accent hover:text-accent-foreground',
                FOCUS_RING,
              )}
            >
              {x.displayTitle || x.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const StructurePanel: React.FC<PanelProps> = ({
  topic,
  allTopics,
  relationships,
  actions,
  selectedTopicIds,
  canAddSummary,
  onAddSummaryForSelection,
  onStartConnectRelationship,
  close,
}) => {
  const rels = useMemo(
    () => relationships.filter((r) => r.end1Id === topic.id || r.end2Id === topic.id),
    [relationships, topic.id],
  );
  const hasChildren = topic.childCount > 0;
  const firstBoundary = topic.boundaries[0];
  const firstSummary = topic.summaries[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <PopoverGroupLabel>Frecce</PopoverGroupLabel>
        <Button
          size="sm"
          variant="secondary"
          icon={<Spline className="size-4" />}
          onClick={() => {
            onStartConnectRelationship(topic.id);
            close();
          }}
        >
          Collega con freccia…
        </Button>
        {rels.length === 0 && <div className="text-2xs text-muted-foreground">Nessuna freccia.</div>}
        {rels.map((r) => (
          <RelationshipRow key={r.id} rel={r} topic={topic} allTopics={allTopics} actions={actions} />
        ))}
        <TopicPicker topic={topic} allTopics={allTopics} actions={actions} />
      </div>

      <div className="flex flex-col gap-1.5 border-t pt-2">
        <PopoverGroupLabel>Raggruppa</PopoverGroupLabel>
        {hasChildren ? (
          <>
            <Switch
              label="Cornice"
              checked={!!firstBoundary}
              onCheckedChange={(on) => {
                if (on) actions.addBoundary(topic.id);
                else if (firstBoundary) actions.removeBoundary(topic.id, firstBoundary.id);
              }}
            />
            <Switch
              label="Sommario"
              checked={!!firstSummary}
              onCheckedChange={(on) => {
                if (on) actions.addSummary(topic.id);
                else if (firstSummary) actions.removeSummary(topic.id, firstSummary.id);
              }}
            />
          </>
        ) : (
          <div className="text-2xs text-muted-foreground">Aggiungi almeno un sotto-blocco per cornice o sommario.</div>
        )}
        {selectedTopicIds.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Boxes className="size-4" />}
            disabled={!canAddSummary}
            title="Crea un sommario sui blocchi fratelli selezionati"
            onClick={() => {
              onAddSummaryForSelection();
              close();
            }}
          >
            Sommario sulla selezione (Ctrl+])
          </Button>
        )}
      </div>
    </div>
  );
};

// Frecce (relazioni), cornice e sommario del blocco.
export const StructurePopover: React.FC<StructurePopoverProps> = (props) => {
  const { topic, relationships } = props;
  if (!topic) {
    return (
      <ToolbarButton label="Frecce e struttura" disabled>
        <Spline className="size-4" />
      </ToolbarButton>
    );
  }
  const used =
    topic.boundaries.length +
      topic.summaries.length +
      relationships.filter((r) => r.end1Id === topic.id || r.end2Id === topic.id).length >
    0;
  return (
    <ToolbarPopover
      focusable
      panelClassName={POPOVER_PANEL_CLASS}
      trigger={({ open, toggle }) => (
        <ToolbarButton
          label="Frecce e struttura"
          active={open || used}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <Spline className="size-4" />
        </ToolbarButton>
      )}
    >
      {(close) => <StructurePanel key={topic.id} {...props} topic={topic} close={close} />}
    </ToolbarPopover>
  );
};
