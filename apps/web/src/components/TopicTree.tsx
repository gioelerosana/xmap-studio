import React, { useMemo, useState } from 'react';
import { TopicView } from '@xmap/core';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Sigma,
  Image as ImageIcon,
  FileText,
  Tag,
  Flag,
  Link2,
} from 'lucide-react';
import { cn } from '@xmap/ui-kit';

export type TopicFilter = 'all' | 'equation' | 'text' | 'image';
export type DropPlacement = 'before' | 'after' | 'into';

export interface TopicTreeProps {
  topics: TopicView[];
  searchQuery: string;
  filter: TopicFilter;
  selectedTopicId?: string;
  collapsedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onAddChild: (id: string) => void;
  onMove: (id: string, targetId: string, placement: DropPlacement) => void;
}

function matchesQuery(t: TopicView, query: string): boolean {
  if (!query) return true;
  return (
    t.title.toLowerCase().includes(query) ||
    t.notes.toLowerCase().includes(query) ||
    (t.latex ? t.latex.toLowerCase().includes(query) : false) ||
    t.labels.some((l) => l.toLowerCase().includes(query)) ||
    t.path.join(' ').toLowerCase().includes(query)
  );
}

export const TopicTree: React.FC<TopicTreeProps> = ({
  topics,
  searchQuery,
  filter,
  selectedTopicId,
  collapsedIds,
  onSelect,
  onToggleCollapse,
  onAddChild,
  onMove,
}) => {
  const query = searchQuery.trim().toLowerCase();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: DropPlacement } | null>(null);

  const rootId = topics[0]?.id;

  const visible = useMemo(() => {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const keep = new Set<string>();

    if (query) {
      for (const t of topics) {
        if (matchesQuery(t, query)) {
          keep.add(t.id);
          let pid = t.parentId;
          while (pid) {
            keep.add(pid);
            pid = byId.get(pid)?.parentId;
          }
        }
      }
    }

    const hiddenByCollapse = (t: TopicView): boolean => {
      let pid = t.parentId;
      while (pid) {
        if (collapsedIds.has(pid)) return true;
        pid = byId.get(pid)?.parentId;
      }
      return false;
    };

    return topics.filter((t) => {
      if (filter !== 'all' && t.kind !== filter) return false;
      if (query) return keep.has(t.id);
      return !hiddenByCollapse(t);
    });
  }, [topics, query, filter, collapsedIds]);

  const isDescendant = (ancestorId: string, maybeDescendantId: string): boolean => {
    const byId = new Map(topics.map((t) => [t.id, t]));
    let pid = byId.get(maybeDescendantId)?.parentId;
    while (pid) {
      if (pid === ancestorId) return true;
      pid = byId.get(pid)?.parentId;
    }
    return false;
  };

  const computePlacement = (e: React.DragEvent<HTMLDivElement>, isRoot: boolean): DropPlacement => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    if (isRoot) return 'into';
    if (ratio < 0.28) return 'before';
    if (ratio > 0.72) return 'after';
    return 'into';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: TopicView) => {
    e.preventDefault();
    const source = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!source || source === target.id) return;
    if (isDescendant(source, target.id)) return;
    const placement = computePlacement(e, target.id === rootId);
    onMove(source, target.id, placement);
  };

  if (topics.length === 0) {
    return <div className="px-3 py-6 text-xs text-[var(--adw-muted-color)]">Nessun blocco.</div>;
  }

  if (visible.length === 0) {
    return (
      <div className="px-3 py-6 text-xs text-[var(--adw-muted-color)]">
        Nessun blocco corrisponde ai filtri.
      </div>
    );
  }

  return (
    <div className="py-1">
      {visible.map((topic) => {
        const isSelected = topic.id === selectedTopicId;
        const isCollapsed = collapsedIds.has(topic.id);
        const hasChildren = topic.childCount > 0;
        const isRoot = topic.id === rootId;
        const drop = dropTarget?.id === topic.id ? dropTarget.placement : null;

        return (
          <div
            key={topic.id}
            draggable={!isRoot}
            onDragStart={(e) => {
              if (isRoot) {
                e.preventDefault();
                return;
              }
              setDragId(topic.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropTarget(null);
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === topic.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const placement = computePlacement(e, isRoot);
              setDropTarget({ id: topic.id, placement });
            }}
            onDragLeave={() => {
              if (dropTarget?.id === topic.id) setDropTarget(null);
            }}
            onDrop={(e) => handleDrop(e, topic)}
            onClick={() => onSelect(topic.id)}
            className={cn(
              'group relative flex items-center gap-1.5 pr-2 py-[3px] mx-1.5 rounded-md cursor-default transition-colors',
              isSelected
                ? 'bg-[var(--adw-accent-soft)] text-[var(--adw-fg-color)]'
                : 'hover:bg-[var(--adw-button-hover)]',
              drop === 'into' && 'drop-into',
              drop === 'before' && 'drop-before',
              drop === 'after' && 'drop-after',
              dragId === topic.id && 'opacity-50'
            )}
            style={{ paddingLeft: `${topic.depth * 14 + 4}px` }}
          >
            {/* Espandi/comprimi */}
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(topic.id);
                }}
                className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]"
              >
                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="shrink-0 h-4 w-4 flex items-center justify-center">
                <span className="w-1 h-1 rounded-full bg-[var(--adw-muted-color)] opacity-40" />
              </span>
            )}

            {/* Tipo */}
            <span className="shrink-0 flex items-center">
              {topic.kind === 'equation' ? (
                <Sigma className="w-3.5 h-3.5 text-[var(--adw-accent-color)]" />
              ) : topic.kind === 'image' ? (
                <ImageIcon className="w-3.5 h-3.5 text-[var(--adw-muted-color)]" />
              ) : null}
            </span>

            {topic.fillColor && (
              <span
                className="shrink-0 w-2 h-2 rounded-full border border-black/10 dark:border-white/20"
                style={{ backgroundColor: topic.fillColor }}
              />
            )}

            <span
              className={cn(
                'flex-1 truncate text-[13px]',
                isSelected ? 'font-medium' : 'font-normal',
                !topic.title && topic.kind === 'text' && 'italic text-[var(--adw-muted-color)]'
              )}
              title={topic.path.join(' › ')}
            >
              {topic.displayTitle || '(senza titolo)'}
            </span>

            {/* Badge meta */}
            <span className="shrink-0 flex items-center gap-1 text-[var(--adw-muted-color)] opacity-0 group-hover:opacity-100 transition-opacity">
              {topic.notes && <FileText className="w-3 h-3" />}
              {topic.labels.length > 0 && (
                <span className="flex items-center gap-0.5 text-[10px]">
                  <Tag className="w-3 h-3" />
                  {topic.labels.length}
                </span>
              )}
              {topic.markers.length > 0 && (
                <span className="flex items-center gap-0.5 text-[10px]">
                  <Flag className="w-3 h-3" />
                  {topic.markers.length}
                </span>
              )}
              {topic.href && <Link2 className="w-3 h-3" />}
            </span>

            <button
              type="button"
              title="Aggiungi sotto-blocco"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild(topic.id);
              }}
              className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-[var(--adw-muted-color)] opacity-0 group-hover:opacity-100 hover:bg-[var(--adw-button-active)] hover:text-[var(--adw-fg-color)]"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
