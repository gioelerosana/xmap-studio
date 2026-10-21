import React from 'react';
import type { TopicView } from '@xmap/core';
import type { TopicActions } from '../../app/useTopicActions.js';

export interface NotesPopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

// Segnaposto del contratto: trigger (ToolbarButton) + ToolbarPopover con le note del blocco.
export const NotesPopover: React.FC<NotesPopoverProps> = () => null;
