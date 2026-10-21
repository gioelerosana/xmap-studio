import type { AppController, TopicView } from '@xmap/core';
import type { ToastFn } from '../../app/useTopicActions.js';

export interface LatexEditorModalProps {
  /** Blocco da trasformare in formula o di cui modificare la formula; `null` = chiuso. */
  topic: TopicView | null;
  onClose: () => void;
  controller: AppController;
  darkMode: boolean;
  /** Da chiamare dopo ogni modifica al modello (applica/rimuovi). */
  onChanged: () => void;
  onToast: ToastFn;
}
