import React from 'react';
import type { TopicView } from '@xmap/core';
import type { TopicActions } from '../../app/useTopicActions.js';

export interface MarkersPopoverProps {
  /** `null` = nessun blocco selezionato: il trigger si mostra disattivato. */
  topic: TopicView | null;
  actions: TopicActions;
}

// Segnaposto del contratto: pulsante Marker con marker (per categoria) ed etichette del blocco.
export const MarkersPopover: React.FC<MarkersPopoverProps> = () => null;
