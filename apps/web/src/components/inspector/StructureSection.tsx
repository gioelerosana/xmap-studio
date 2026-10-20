import React, { useMemo } from 'react';
import { Boxes, GitBranch, X } from 'lucide-react';
import type { RelationshipShape, RelationshipView, TopicView } from '@xmap/core';
import { Button, Select, cn } from '@xmap/ui-kit';

import { FOCUS_RING } from './classes.js';
import { RELATIONSHIP_SHAPES } from './constants.js';
import { InspectorSection } from './InspectorSection.js';

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium">{children}</div>
);

interface StructureSectionProps {
  topic: TopicView;
  allTopics: TopicView[];
  relationships: RelationshipView[];
  relTarget: string;
  onRelTargetChange: (value: string) => void;
  onAddRelationship: () => void;
  onRemoveRelationship: (relationshipId: string) => void;
  onRelationshipShapeChange: (relationshipId: string, shape: RelationshipShape) => void;
  onAddBoundary: () => void;
  onRemoveBoundary: () => void;
  onAddSummary: () => void;
  onRemoveSummary: () => void;
  selectedTopicIds?: string[];
  onAddSummaryForSiblings?: () => void;
  canAddSummary?: boolean;
}

// Relazioni, cornici e sommari del blocco, più l'azione sulla selezione multipla.
export const StructureSection: React.FC<StructureSectionProps> = ({
  topic: t,
  allTopics,
  relationships,
  relTarget,
  onRelTargetChange,
  onAddRelationship,
  onRemoveRelationship,
  onRelationshipShapeChange,
  onAddBoundary,
  onRemoveBoundary,
  onAddSummary,
  onRemoveSummary,
  selectedTopicIds,
  onAddSummaryForSiblings,
  canAddSummary,
}) => {
  const rels = useMemo(
    () => relationships.filter((r) => r.end1Id === t.id || r.end2Id === t.id),
    [relationships, t.id]
  );
  const otherTopics = useMemo(() => allTopics.filter((x) => x.id !== t.id), [allTopics, t.id]);
  const hasChildren = t.childCount > 0;

  return (
    <InspectorSection
      id="structure"
      title="Struttura"
      icon={<GitBranch className="size-3.5" />}
      summary={
        rels.length + t.boundaries.length + t.summaries.length > 0
          ? rels.length + t.boundaries.length + t.summaries.length
          : undefined
      }
    >
      <div className="flex flex-col gap-1.5">
        <GroupLabel>Relazioni</GroupLabel>
        {rels.length === 0 && <div className="text-2xs text-muted-foreground">Nessuna relazione.</div>}
        {rels.map((r) => {
          const otherId = r.end1Id === t.id ? r.end2Id : r.end1Id;
          const other = allTopics.find((x) => x.id === otherId);
          return (
            <div key={r.id} className="flex items-center gap-1.5 text-2xs">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">
                {r.end1Id === t.id ? '→' : '←'} {other?.displayTitle || otherId}
                {r.title ? ` · ${r.title}` : ''}
              </span>
              <Select
                size="sm"
                aria-label="Forma della relazione"
                className="w-28 shrink-0"
                value={r.style.shape}
                onChange={(e) => onRelationshipShapeChange(r.id, e.target.value as RelationshipShape)}
              >
                {RELATIONSHIP_SHAPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                aria-label="Rimuovi relazione"
                onClick={() => onRemoveRelationship(r.id)}
                className={cn('rounded-sm text-muted-foreground hover:text-error-foreground', FOCUS_RING)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5">
          <Select value={relTarget} onChange={(e) => onRelTargetChange(e.target.value)}>
            <option value="">Collega a…</option>
            {otherTopics.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayTitle || o.id}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" disabled={!relTarget} onClick={onAddRelationship}>
            Aggiungi
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-1">
        <GroupLabel>Sotto-blocchi</GroupLabel>
        {!hasChildren && (
          <div className="text-2xs text-muted-foreground">
            Aggiungi almeno un sotto-blocco per cornice o sommario.
          </div>
        )}
        {hasChildren && (
          <div className="flex items-center gap-1.5">
            {t.boundaries.length === 0 ? (
              <Button size="sm" variant="ghost" icon={<Boxes className="size-4" />} onClick={onAddBoundary}>
                Cornice
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onRemoveBoundary}>
                Rimuovi cornice
              </Button>
            )}
            {t.summaries.length === 0 ? (
              <Button size="sm" variant="ghost" icon={<Boxes className="size-4" />} onClick={onAddSummary}>
                Sommario
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onRemoveSummary}>
                Rimuovi sommario
              </Button>
            )}
          </div>
        )}
        {selectedTopicIds && selectedTopicIds.length > 1 && onAddSummaryForSiblings && (
          <div className="flex flex-col gap-1.5 pt-2 border-t mt-1">
            <GroupLabel>Selezione multipla ({selectedTopicIds.length} blocchi)</GroupLabel>
            <Button
              size="sm"
              variant={canAddSummary ? 'secondary' : 'ghost'}
              icon={<Boxes className="size-4" />}
              onClick={onAddSummaryForSiblings}
              title="Crea sommario sui blocchi fratelli selezionati (Ctrl+])"
            >
              Crea sommario (Ctrl+])
            </Button>
          </div>
        )}
      </div>
    </InspectorSection>
  );
};
