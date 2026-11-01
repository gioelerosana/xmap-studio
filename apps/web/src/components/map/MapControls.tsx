import { GitFork, ListTree, Maximize2, Minus, Plus } from 'lucide-react';
import { IconButton, Separator, cn } from '@xmap/ui-kit';
import type { MapStructure } from '@xmap/core';

/**
 * Vista ad albero/logica, zoom e adattamento. Di norma flottanti in basso a destra; `docked`
 * (schermi stretti) li rende come riga piena dentro la barra degli strumenti in basso.
 */
export function ZoomControls({
  structure,
  onStructureChange,
  zoom,
  onZoom,
  onFit,
  docked = false,
}: {
  structure: MapStructure;
  onStructureChange: (structure: MapStructure) => void;
  zoom: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  docked?: boolean;
}) {
  return (
    <div
      data-map-ui
      role="group"
      aria-label="Vista e zoom"
      className={cn(
        'flex items-center gap-0.5',
        docked
          ? 'justify-between px-0.5 py-0.5'
          : 'absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-20 p-1 surface-glass border rounded-xl shadow-composer',
      )}
    >
      <div className="flex items-center gap-0.5">
        <IconButton
          size="sm"
          variant="ghost"
          label="Vista ad albero"
          aria-pressed={structure === 'tree'}
          className={cn(structure === 'tree' && 'bg-accent text-foreground')}
          onClick={() => onStructureChange('tree')}
        >
          <ListTree className="size-4" />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="Vista a logica"
          aria-pressed={structure === 'logic'}
          className={cn(structure === 'logic' && 'bg-accent text-foreground')}
          onClick={() => onStructureChange('logic')}
        >
          <GitFork className="size-4 -rotate-90" />
        </IconButton>
      </div>
      {!docked && <Separator orientation="vertical" className="h-4 mx-0.5" />}
      <div className="flex items-center gap-0.5">
        <IconButton size="sm" variant="ghost" label="Riduci zoom" onClick={() => onZoom(1 / 1.2)}>
          <Minus className="size-4" />
        </IconButton>
        <span className="text-2xs font-mono tabular-nums text-muted-foreground min-w-[3rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton size="sm" variant="ghost" label="Aumenta zoom" onClick={() => onZoom(1.2)}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      {!docked && <Separator orientation="vertical" className="h-4 mx-0.5" />}
      <IconButton size="sm" variant="ghost" label="Adatta alla finestra" onClick={onFit}>
        <Maximize2 className="size-4" />
      </IconButton>
    </div>
  );
}
