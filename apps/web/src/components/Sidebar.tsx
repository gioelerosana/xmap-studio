import React from 'react';
import { Search } from 'lucide-react';
import { IconButton, cn } from '@xmap/ui-kit';
import { TopicView } from '@xmap/core';
import { Plus } from 'lucide-react';
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

  return (
    <aside className="w-[280px] shrink-0 flex flex-col border-r border-[var(--adw-card-border)] bg-[var(--adw-sidebar-bg)] overflow-hidden">
      <div className="p-2.5 space-y-2 border-b border-[var(--adw-hairline)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--adw-muted-color)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Cerca un blocco…"
            className="w-full h-8 pl-8 pr-2.5 rounded-md border border-[var(--adw-card-border)] bg-[var(--adw-bg-color)] text-[13px] placeholder:text-[var(--adw-muted-color)] focus:outline-none focus:border-[var(--adw-accent-color)]"
          />
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-[var(--adw-surface)] border border-[var(--adw-card-border)]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilter(f.id)}
              className={cn(
                'flex-1 h-6 rounded text-[11px] font-medium transition-colors',
                filter === f.id
                  ? 'bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] shadow-[var(--adw-shadow-sm)]'
                  : 'text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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

      <div className="flex items-center justify-between px-3 h-9 border-t border-[var(--adw-hairline)] text-[11px] text-[var(--adw-muted-color)]">
        <span className="tabular-nums">
          {searchQuery || filter !== 'all' ? `${filteredCount} / ${topics.length}` : topics.length} blocchi
        </span>
        <IconButton size="sm" title="Aggiungi blocco alla radice" onClick={onAddRootChild}>
          <Plus className="w-3.5 h-3.5" />
        </IconButton>
      </div>
    </aside>
  );
};
