import React from 'react';
import { cn } from '@xmap/ui-kit';

import { TOOLBAR_EDGE_GAP } from './useToolbarPosition.js';
import type { DragOffset, ToolbarDock } from './useToolbarPosition.js';

export const DOCK_PLACEMENT: Record<ToolbarDock, { position: React.CSSProperties; translate: string }> = {
  top: { position: { left: '50%', top: TOOLBAR_EDGE_GAP }, translate: 'translate(-50%, 0)' },
  bottom: { position: { left: '50%', bottom: TOOLBAR_EDGE_GAP }, translate: 'translate(-50%, 0)' },
  left: { position: { left: TOOLBAR_EDGE_GAP, top: '50%' }, translate: 'translate(0, -50%)' },
  right: { position: { right: TOOLBAR_EDGE_GAP, top: '50%' }, translate: 'translate(0, -50%)' },
};

/** Posizione dell'aggancio con lo scostamento del trascinamento composto sopra il centraggio. */
export const dockStyle = (dock: ToolbarDock, dragOffset: DragOffset | null): React.CSSProperties => {
  const { position, translate } = DOCK_PLACEMENT[dock];
  const drag = dragOffset ? ` translate(${dragOffset.x}px, ${dragOffset.y}px)` : '';
  return { ...position, transform: `${translate}${drag}` };
};

type DockPreview = { target: ToolbarDock; barWidth: number; barHeight: number };

type DockSize = { width: number; height: number };

const GUIDE_DOCKS: readonly ToolbarDock[] = ['top', 'bottom', 'left', 'right'];

/**
 * Le misure di inizio trascinamento hanno l'orientamento dell'aggancio attuale; le due
 * orientazioni della barra sono lo stesso rettangolo con i lati scambiati.
 */
const slotSizes = ({ barWidth, barHeight }: DockPreview): Record<'horizontal' | 'vertical', DockSize> => {
  const measuredHorizontal = barWidth >= barHeight;
  const horizontal: DockSize = measuredHorizontal
    ? { width: barWidth, height: barHeight }
    : { width: barHeight, height: barWidth };
  const vertical: DockSize = { width: horizontal.height, height: horizontal.width };
  return { horizontal, vertical };
};

/**
 * Sagome tratteggiate delle quattro posizioni di aggancio, mostrate durante il trascinamento
 * della barra: quella che verrebbe scelta rilasciando ora è evidenziata.
 */
export const DockGuides: React.FC<{ preview: DockPreview }> = ({ preview }) => {
  const sizes = slotSizes(preview);
  return (
    <>
      {GUIDE_DOCKS.map((dock) => {
        const isTarget = dock === preview.target;
        const orientation = dock === 'top' || dock === 'bottom' ? sizes.horizontal : sizes.vertical;
        return (
          <div
            key={dock}
            aria-hidden
            className={cn(
              'pointer-events-none absolute z-10 rounded-xl border-2 border-dashed transition-colors duration-150',
              isTarget ? 'border-primary bg-primary/10' : 'border-primary/40',
            )}
            style={{ ...dockStyle(dock, null), ...orientation }}
          />
        );
      })}
    </>
  );
};
