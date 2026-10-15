import React, { useMemo, useState } from 'react';
import { TopicView } from '@xmap/core';
import {
  ChevronRight,
  Plus,
  Sigma,
  Image as ImageIcon,
  FileText,
  Tag,
  Flag,
  Link2,
  SearchX,
} from 'lucide-react';
import { EmptyHint, IconButton, cn } from '@xmap/ui-kit';

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

// Passo di indentazione per livello; il chevron di ogni livello è centrato a +16px dal bordo della riga.
const INDENT_STEP = 14;
const ROW_INSET = 8;
const CHEVRON_CENTER = 16;

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
    return <div className="px-2 py-6 text-xs text-muted-foreground">Nessun blocco.</div>;
  }

  if (visible.length === 0) {
    return (
      <EmptyHint
        className="py-6"
        icon={<SearchX className="size-4" />}
        title="Nessun risultato"
        description="Nessun blocco corrisponde ai filtri."
      />
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
              'group relative flex h-7 items-center gap-1.5 rounded-md pr-2 text-sm text-foreground cursor-default transition-colors',
              isSelected ? 'bg-sidebar-row-active shadow-control' : 'hover:bg-accent',
              drop === 'into' && 'drop-into',
              drop === 'before' && 'drop-before',
              drop === 'after' && 'drop-after',
              dragId === topic.id && 'opacity-50'
            )}
            style={{ paddingLeft: `${topic.depth * INDENT_STEP + ROW_INSET}px` }}
          >
            {/* Guide verticali: una per antenato, sulla colonna del suo chevron. */}
            {Array.from({ length: topic.depth }, (_, level) => (
              <span
                key={level}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-border"
                style={{ left: `${level * INDENT_STEP + CHEVRON_CENTER}px` }}
              />
            ))}

            {/* Espandi/comprimi */}
            {hasChildren ? (
              <button
                type="button"
                aria-label={isCollapsed ? 'Espandi' : 'Comprimi'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(topic.id);
                }}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform duration-150', !isCollapsed && 'rotate-90')}
                />
              </button>
            ) : (
              <span className="flex size-4 shrink-0 items-center justify-center">
                <span className="size-1 rounded-full bg-muted-foreground opacity-40" />
              </span>
            )}

            {/* Tipo */}
            <span className="flex shrink-0 items-center">
              {topic.kind === 'equation' ? (
                <Sigma className="size-3.5 text-muted-foreground" />
              ) : topic.kind === 'image' ? (
                <ImageIcon className="size-3.5 text-muted-foreground" />
              ) : null}
            </span>

            {topic.fillColor && (
              <span
                className="size-2 shrink-0 rounded-full border border-foreground/10"
                style={{ backgroundColor: topic.fillColor }}
              />
            )}

            <span
              className={cn(
                'flex-1 truncate',
                isSelected ? 'font-medium' : 'font-normal',
                topic.kind === 'equation' && 'font-mono',
                !topic.title && topic.kind === 'text' && 'italic text-muted-foreground'
              )}
              title={topic.path.join(' › ')}
            >
              {topic.displayTitle || '(senza titolo)'}
            </span>

            {/* Badge meta */}
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {topic.notes && <FileText className="size-3.5" />}
              {topic.labels.length > 0 && (
                <span className="flex items-center gap-0.5 text-3xs tabular-nums">
                  <Tag className="size-3.5" />
                  {topic.labels.length}
                </span>
              )}
              {topic.markers.length > 0 && (
                <span className="flex items-center gap-0.5 text-3xs tabular-nums">
                  <Flag className="size-3.5" />
                  {topic.markers.length}
                </span>
              )}
              {topic.href && <Link2 className="size-3.5" />}
            </span>

            <IconButton
              variant="ghost"
              size="xs"
              label="Aggiungi sotto-blocco"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild(topic.id);
              }}
            >
              <Plus className="size-3.5" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
};
