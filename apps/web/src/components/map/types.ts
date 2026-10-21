import type { Layout, MapStructure, Point, TitleRun } from '@xmap/core';
import type { buildDragIndex, DropPlacement, DropTarget } from './dragTarget.js';
import type { EditExit } from './NodeEditor.js';
import type { ControlPointsPatch } from './RelationshipLayer.js';

/** Stato visivo del trascinamento di un blocco: fantasma (angolo in alto a sinistra, mondo) e bersaglio. */
export interface DragOverlay {
  sourceId: string;
  ghost: Point;
  drop: DropTarget | null;
}

/** Editing in place del titolo di un blocco, governato dal genitore. */
export interface MapEditing {
  id: string;
  /** `all` = seleziona il testo esistente; `text` = parte da `text` (digitazione su blocco selezionato). */
  mode: 'all' | 'text';
  text?: string;
  isNew?: boolean;
}

export interface MapViewProps {
  /** Identità del documento/foglio mostrato: quando cambia la vista si riadatta. */
  viewKey?: string;
  editing?: MapEditing | null;
  onStartEdit?: (topicId: string) => void;
  onCommitEdit?: (topicId: string, text: string, exit: EditExit, runs?: TitleRun[]) => void;
  onCancelEdit?: () => void;
  layout: Layout | null;
  /** Blocco con selezione primaria (determina i comandi della barra flottante). */
  selectedTopicId?: string;
  /**
   * Elenco degli ID dei blocchi selezionati nella mappa (selezione multipla).
   * Include la selezione primaria ed è evidenziato con lo stesso stile di selezione.
   */
  selectedTopicIds?: string[];
  /**
   * Clic su un blocco: con clic semplice deseleziona gli altri, con modificatore (Maiusc o Ctrl/Cmd)
   * aggiunge o toglie il blocco alla selezione multipla.
   */
  onSelectTopic: (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  /** Clic o tap sullo sfondo della mappa: svuota la selezione. */
  onClearSelection?: () => void;
  /** Apre l'editor LaTeX centrato sul blocco (formule; anche per trasformare un testo in formula). */
  onOpenLatex: (topicId: string) => void;
  onAddChild?: (topicId: string) => void;
  /** Crea un fratello dopo il blocco, come Invio. */
  /** Crea un fratello dopo o prima del blocco, come Invio / Maiusc+Invio. */
  onAddSibling?: (topicId: string, where?: 'after' | 'before') => void;
  onDeleteTopic?: (topicId: string) => void;
  /** Rimuove solo il blocco e ricollega i suoi figli al genitore. */
  onRemoveTopicKeepChildren?: (topicId: string) => void;
  onCopyTopic?: (topicId: string) => void;
  onCutTopic?: (topicId: string) => void;
  onPasteTopic?: (targetTopicId?: string) => void;
  onDuplicateTopic?: (topicId: string) => void;
  onStartConnectRelationship?: (topicId: string) => void;
  canPaste?: boolean;
  isConnectingRelationship?: boolean;
  onConnectRelationshipTarget?: (targetTopicId: string) => void;
  onToggleCollapse: (topicId: string) => void;
  resourceResolver: (src: string) => Uint8Array | null;
  darkMode?: boolean;
  structure: MapStructure;
  onStructureChange: (structure: MapStructure) => void;
  /** Rilascio di un blocco trascinato sulla mappa; stessa firma di `onMove` dell'albero. */
  onMoveTopic?: (topicId: string, targetId: string, placement: DropPlacement) => void;
  /** Rilascio di un topic libero (detached): `position` è il suo centro relativo al centro della radice. */
  onMoveFloatingTopic?: (topicId: string, position: Point) => void;
  /** Punti di controllo di una relazione trascinati (`null` = ripristina, `undefined` = invariato). */
  onRelationshipControlPointsChange?: (relationshipId: string, points: ControlPointsPatch) => void;
  /** Larghezza custom modificata tramite maniglia. */
  onResizeTopicWidth?: (topicId: string, width: number | null) => void;
  /** Dimensioni immagine modificate tramite maniglia d'angolo. */
  onResizeTopicImage?: (topicId: string, size: { width: number; height: number }) => void;
  /** Callback per creare un sommario sui blocchi selezionati (es. Ctrl+] o pulsante barra). */
  onAddSummary?: () => void;
  /** Indica se i blocchi correntemente selezionati sono fratelli validi per creare un sommario. */
  canAddSummary?: boolean;
}


/** Menu contestuale aperto sulla mappa: su un blocco o sullo sfondo. */
export interface ContextMenuState {
  x: number;
  y: number;
  target: { type: 'node'; topicId: string } | { type: 'background' };
}

/** Callback della mappa letti dai gesti e dai menu tramite ref, così il contenuto memoizzato resta stabile. */
export type MapHandlers = Pick<
  MapViewProps,
  | 'onSelectTopic'
  | 'onOpenLatex'
  | 'onAddChild'
  | 'onAddSibling'
  | 'onDeleteTopic'
  | 'onRemoveTopicKeepChildren'
  | 'onToggleCollapse'
  | 'onMoveTopic'
  | 'onMoveFloatingTopic'
  | 'onRelationshipControlPointsChange'
  | 'onStartEdit'
  | 'onAddSummary'
  | 'onResizeTopicWidth'
  | 'onResizeTopicImage'
  | 'onCopyTopic'
  | 'onCutTopic'
  | 'onPasteTopic'
  | 'onDuplicateTopic'
  | 'onStartConnectRelationship'
  | 'isConnectingRelationship'
  | 'onConnectRelationshipTarget'
>;

/** Indice di trascinamento costruito dal layout (vedi `buildDragIndex`). */
export type DragIndexRef = ReturnType<typeof buildDragIndex> | null;
