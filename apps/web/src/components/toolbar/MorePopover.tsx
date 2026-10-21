import React from 'react';
import type { TopicView } from '@xmap/core';
import type { TopicActions } from '../../app/useTopicActions.js';

export interface MorePopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

// Segnaposto del contratto: menu ⋯ con marker, etichette e link del blocco.
export const MorePopover: React.FC<MorePopoverProps> = () => null;
