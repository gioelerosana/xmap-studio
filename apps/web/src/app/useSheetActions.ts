import { useMemo } from 'react';
import type { AppController } from '@xmap/core';
import type { AddToast } from './useToasts.js';

export interface SheetActions {
  addSheet: () => void;
  renameSheet: (index: number, title: string) => void;
  duplicateSheet: (index: number) => void;
  deleteSheet: (index: number) => void;
  moveSheet: (from: number, to: number) => void;
}

interface SheetActionsOptions {
  controller: AppController;
  refreshState: () => void;
  addToast: AddToast;
  activeSheetIndex: number;
  /** Porta la linguetta attiva su `index` e azzera la selezione. */
  selectSheet: (index: number) => void;
}

/** Nuova posizione della linguetta attiva dopo aver spostato il foglio `from` in `to`: se è attiva segue il foglio, altrimenti resta sul suo foglio. */
function activeIndexAfterMove(active: number, from: number, to: number): number {
  if (active === from) return to;
  if (from < active && to >= active) return active - 1;
  if (from > active && to <= active) return active + 1;
  return active;
}

/** Linguetta attiva dopo aver eliminato il foglio `deleted`: il foglio che gli sta dietro prende il suo posto, oppure l'ultimo. */
function activeIndexAfterDelete(active: number, deleted: number, remaining: number): number {
  const shifted = deleted < active ? active - 1 : active;
  return Math.min(shifted, remaining - 1);
}

/**
 * Azioni sui fogli (linguette). Ogni modifica è un passo di undo, aggiorna lo stato
 * e trasforma gli errori del core in un toast: i chiamanti non gestiscono eccezioni.
 */
export function useSheetActions({
  controller,
  refreshState,
  addToast,
  activeSheetIndex,
  selectSheet,
}: SheetActionsOptions): SheetActions {
  return useMemo(() => {
    const run = (action: () => void) => {
      try {
        action();
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : String(err));
      }
    };
    return {
      addSheet: () =>
        run(() => {
          const { sheets } = controller.addSheet();
          refreshState();
          selectSheet(sheets.length - 1);
        }),
      renameSheet: (index, title) =>
        run(() => {
          controller.renameSheet(index, title);
          refreshState();
        }),
      duplicateSheet: (index) =>
        run(() => {
          controller.duplicateSheet(index);
          refreshState();
          selectSheet(index + 1);
        }),
      deleteSheet: (index) =>
        run(() => {
          const { sheets } = controller.deleteSheet(index);
          refreshState();
          const next = activeIndexAfterDelete(activeSheetIndex, index, sheets.length);
          // Anche eliminando un foglio non attivo la selezione torna vuota, come a ogni cambio di foglio.
          if (index === activeSheetIndex || next !== activeSheetIndex) selectSheet(next);
          addToast('info', 'Foglio eliminato — Ctrl+Z per annullare');
        }),
      moveSheet: (from, to) =>
        run(() => {
          controller.moveSheet(from, to);
          refreshState();
          const next = activeIndexAfterMove(activeSheetIndex, from, to);
          if (next !== activeSheetIndex) selectSheet(next);
        }),
    };
  }, [controller, refreshState, addToast, activeSheetIndex, selectSheet]);
}
