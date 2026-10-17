import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@xmap/ui-kit';

/** Passo del ridimensionamento da tastiera, in px. */
const KEYBOARD_STEP = 16;
/** Classe che, sul documento, forza cursore e nessuna selezione durante il trascinamento (vedi index.css). */
const RESIZING_CLASS = 'is-resizing-panel';

export interface ResizeHandleProps {
  /** Lato del pannello su cui sta la maniglia: `right` per la sidebar, `left` per l'inspector. */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onChange: (width: number) => void;
  label?: string;
}

/**
 * Maniglia verticale per ridimensionare un pannello laterale. Visibile solo da `lg` in su:
 * sotto lg i pannelli sono sovrapposti e a larghezza fissa.
 */
export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  side,
  width,
  min,
  max,
  defaultWidth,
  onChange,
  label = 'Ridimensiona pannello',
}) => {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // +1 se trascinare verso destra allarga il pannello (maniglia a destra), -1 altrimenti.
  const sign = side === 'right' ? 1 : -1;

  useEffect(() => {
    return () => document.body.classList.remove(RESIZING_CLASS);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
    document.body.classList.add(RESIZING_CLASS);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onChange(drag.startWidth + sign * (e.clientX - drag.startX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove(RESIZING_CLASS);
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        // Le frecce spostano la maniglia: a destra allarga la sidebar, a sinistra allarga l'inspector.
        const step = e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP;
        onChange(width + sign * step);
        return;
      }
      case 'Home':
        e.preventDefault();
        onChange(min);
        return;
      case 'End':
        e.preventDefault();
        onChange(max);
        return;
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Trascina per ridimensionare · doppio clic per ripristinare"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(defaultWidth)}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute inset-y-0 z-10 hidden w-1.5 cursor-col-resize touch-none lg:block',
        'focus-visible:outline-none',
        side === 'right' ? 'right-0' : 'left-0',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 w-px transition-colors',
          side === 'right' ? 'right-0' : 'left-0',
          dragging ? 'bg-ring' : 'bg-transparent group-hover:bg-ring group-focus-visible:bg-ring',
        )}
      />
    </div>
  );
};
