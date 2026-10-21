import React from 'react';
import type { TopicView } from '@xmap/core';
import type { TopicActions } from '../../app/useTopicActions.js';

export interface LinkPopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

// Segnaposto del contratto: pulsante Link con il collegamento ipertestuale del blocco.
export const LinkPopover: React.FC<LinkPopoverProps> = () => null;
