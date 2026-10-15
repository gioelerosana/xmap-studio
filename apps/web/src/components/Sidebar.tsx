import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Badge, IconButton, Input, SegmentedControl } from '@xmap/ui-kit';
import { TopicView } from '@xmap/core';
import { TopicFilter, TopicTree, DropPlacement } from './TopicTree.js';

export interface SidebarProps {
  topics: TopicView[];
  searchQuery: string;
  onSearch: (value: string) => void;
  filter: TopicFilter;
  onFilter: (value: TopicFilter) => void;
  selectedTopicId?: string;
  collapsedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddRootChild: () => void;
  onMove: (id: string, targetId: string, placement: DropPlacement) => void;
}

const FILTERS: { id: TopicFilter; label: string }[] = [
  { id: 'all', label: 'Tutti' },
  { id: 'text', label: 'Testo' },
  { id: 'equation', label: 'Formule' },
  { id: 'image', label: 'Immagini' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  topics,
  searchQuery,
  onSearch,
  filter,
  onFilter,
  selectedTopicId,
  collapsedIds,
  onSelect,
  onToggleCollapse,
  onAddChild,
  onAddRootChild,
  onMove,
}) => {
  const filteredCount = topics.filter((t) => filter === 'all' || t.kind === filter).length;
  const isFiltered = Boolean(searchQuery) || filter !== 'all';

  return (
    <aside className="flex w-sidebar shrink-0 flex-col gap-2 overflow-hidden border-r bg-sidebar p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Blocchi</h2>
          <Badge variant="outline" size="sm" className="tabular-nums">
            {isFiltered ? `${filteredCount} / ${topics.length}` : topics.length}
          </Badge>
        </div>
        <IconButton variant="ghost" size="xs" label="Aggiungi blocco" onClick={onAddRootChild}>
          <Plus className="size-3.5" />
        </IconButton>
      </div>

      <Input
        type="text"
        size="sm"
        value={searchQuery}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Cerca un blocco…"
        aria-label="Cerca un blocco"
        leading={<Search className="size-4" />}
        className="bg-sidebar-control-surface"
      />

      <SegmentedControl
        size="sm"
        items={FILTERS}
        activeId={filter}
        onChange={onFilter}
        className="w-full"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TopicTree
          topics={topics}
          searchQuery={searchQuery}
          filter={filter}
          selectedTopicId={selectedTopicId}
          collapsedIds={collapsedIds}
          onSelect={onSelect}
          onToggleCollapse={onToggleCollapse}
          onAddChild={onAddChild}
          onMove={onMove}
        />
      </div>
    </aside>
  );
};
