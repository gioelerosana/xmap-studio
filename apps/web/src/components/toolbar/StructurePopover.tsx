import React from 'react';
import type { RelationshipView, TopicView } from '@xmap/core';
import type { TopicActions } from '../../app/useTopicActions.js';

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

// Segnaposto del contratto: frecce (relazioni), cornice e sommario del blocco.
export const StructurePopover: React.FC<StructurePopoverProps> = () => null;
