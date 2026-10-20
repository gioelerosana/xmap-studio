import { Braces, GitFork, ListTree, Maximize2, Minus, Plus } from 'lucide-react';
import { Button, IconButton, Separator, cn } from '@xmap/ui-kit';
import type { MapStructure } from '@xmap/core';

/** Barra contestuale della selezione multipla, con l'azione di sommario sui blocchi selezionati. */
export function MultiSelectBar({
  count,
  onAddSummary,
  canAddSummary,
}: {
  count: number;
  onAddSummary?: () => void;
  canAddSummary: boolean;
}) {
  return (
    <div
      data-map-ui
      onMouseDown={(e) => e.preventDefault()}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-1.5 p-1.5 surface-glass border rounded-xl shadow-composer max-w-[calc(100%-32px)]"
    >
      <span className="px-2 text-xs font-medium text-foreground whitespace-nowrap">
        {count} blocchi selezionati
      </span>
      {onAddSummary && (
        <>
          <Separator orientation="vertical" className="h-4 mx-0.5" />
          <Button
            variant={canAddSummary ? 'default' : 'ghost'}
            size="sm"
            className="px-2.5 text-xs"
            icon={<Braces className="size-4" />}
            onClick={onAddSummary}
            title="Crea sommario sui blocchi selezionati (Ctrl+])"
          >
            Sommario
          </Button>
        </>
      )}
    </div>
  );
}

/** Pulsanti flottanti in basso a destra: vista ad albero/logica, zoom e adattamento. */
export function ZoomControls({
  structure,
  onStructureChange,
  zoom,
  onZoom,
  onFit,
}: {
  structure: MapStructure;
  onStructureChange: (structure: MapStructure) => void;
  zoom: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  return (
    <div
      data-map-ui
      className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-20 flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer">
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
      <Separator orientation="vertical" className="h-4 mx-0.5" />
      <IconButton
        size="sm"
        variant="ghost"
        label="Riduci zoom"
        onClick={() => onZoom(1 / 1.2)}
      >
        <Minus className="size-4" />
      </IconButton>
      <span className="text-2xs font-mono tabular-nums text-muted-foreground min-w-[3rem] text-center">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton
        size="sm"
        variant="ghost"
        label="Aumenta zoom"
        onClick={() => onZoom(1.2)}
      >
        <Plus className="size-4" />
      </IconButton>
      <Separator orientation="vertical" className="h-4 mx-0.5" />
      <IconButton size="sm" variant="ghost" label="Adatta alla finestra" onClick={onFit}>
        <Maximize2 className="size-4" />
      </IconButton>
    </div>
  );
}
