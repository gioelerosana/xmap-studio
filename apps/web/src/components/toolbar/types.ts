import type { RelationshipView, TopicView } from '@xmap/core';
import type { TopicActions } from '../../app/useTopicActions.js';

export interface FloatingToolbarProps {
  /** Blocco con selezione primaria; `null` senza selezione (i comandi di blocco si disattivano). */
  topic: TopicView | null;
  /** Selezione multipla (2+ ID) oppure vuota/1 elemento. */
  selectedTopicIds: string[];
  allTopics: TopicView[];
  relationships: RelationshipView[];
  /**
   * Un titolo è in modifica in place: i comandi di stile del testo vanno a
   * `activeInlineEditor()` (map/editorBridge.ts) invece che a `actions.setTextStyle`.
   */
  isEditingText: boolean;
  actions: TopicActions;
  /** La selezione corrente forma un intervallo di fratelli su cui creare un sommario. */
  canAddSummary: boolean;
  /** Sommario sui blocchi selezionati (Ctrl+]). */
  onAddSummaryForSelection: () => void;
  /** Apre l'editor LaTeX centrato sul blocco (anche per trasformare un blocco di testo in formula). */
  onOpenLatex: (topicId: string) => void;
  /** Avvia il collegamento con freccia: il prossimo clic sulla mappa sceglie il blocco di arrivo. */
  onStartConnectRelationship: (topicId: string) => void;
  /** Immagine scelta dal selettore file: stesso instradamento dell'incolla (vedi `useImageInsert`). */
  onInsertImage: (file: Blob) => void;
}
