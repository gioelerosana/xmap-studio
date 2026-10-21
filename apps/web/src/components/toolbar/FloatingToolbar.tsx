import React from 'react';
import { Braces, GripVertical, PaintBucket, Sigma } from 'lucide-react';
import { cn } from '@xmap/ui-kit';

import { COMPACT_QUERY, TEXT_FIELD } from '../../app/constants.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { ColorPopover } from './ColorPopover.js';
import { BRANCH_COLORS } from './constants.js';
import { LinkPopover } from './LinkPopover.js';
import { MarkersPopover } from './MarkersPopover.js';
import { NotesPopover } from './NotesPopover.js';
import { ToolbarButton, ToolbarSeparator } from './primitives.js';
import { StructurePopover } from './StructurePopover.js';
import { TextStyleControls } from './TextStyleControls.js';
import type { FloatingToolbarProps } from './types.js';
import { useTextStyleShortcuts } from './useTextStyleShortcuts.js';
import { useToolbarPosition, TOOLBAR_TOP_GAP } from './useToolbarPosition.js';

// Nasconde la barra di scorrimento orizzontale (Firefox e WebKit) senza disattivare lo scorrimento.
const HIDE_SCROLLBAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * Barra degli strumenti flottante, ispirata a quella di GoodNotes: una pillola di vetro con
 * stile del testo, colori, formula, note, struttura e altro. Su schermi larghi si trascina
 * dall'impugnatura (la posizione è ricordata); sotto `sm` resta fissa in basso.
 */
export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  topic,
  selectedTopicIds,
  allTopics,
  relationships,
  isEditingText,
  actions,
  canAddSummary,
  onAddSummaryForSelection,
  onOpenLatex,
  onStartConnectRelationship,
}) => {
  const compact = useMediaQuery(COMPACT_QUERY);
  const { barRef, offset, dock, dragging, gripProps } = useToolbarPosition(!compact);
  useTextStyleShortcuts({ topic, isEditingText, actions });

  const hasTopic = topic !== null;
  const multiple = selectedTopicIds.length > 1;

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Strumenti del blocco"
      data-dock={dock}
      // I comandi non devono rubare il focus all'editor in place; i campi di testo dei pannelli sì.
      onMouseDown={(e) => {
        if (!(e.target instanceof Element && e.target.closest(TEXT_FIELD))) e.preventDefault();
      }}
      style={compact ? undefined : { transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`, top: TOOLBAR_TOP_GAP }}
      className={cn(
        'group surface-glass pointer-events-auto absolute left-1/2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-0.5 overflow-x-auto rounded-xl border p-0.5 shadow-composer',
        HIDE_SCROLLBAR,
        compact && '-translate-x-1/2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))]',
        dragging && 'select-none',
      )}
    >
      {!compact && (
        <div
          role="img"
          aria-label="Sposta la barra"
          title="Sposta la barra (doppio clic per ripristinare)"
          className={cn(
            'flex h-8 w-4 shrink-0 touch-none items-center justify-center rounded-control text-muted-foreground hover:text-foreground',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          {...gripProps}
        >
          <GripVertical className="size-3.5" />
        </div>
      )}

      <TextStyleControls topic={topic} isEditingText={isEditingText} actions={actions} />

      <ToolbarSeparator />

      <ColorPopover
        label="Colore del blocco"
        value={topic?.fillColor ?? null}
        colors={BRANCH_COLORS}
        noneLabel="Predefinito"
        disabled={!hasTopic}
        icon={<PaintBucket className="size-4" />}
        onSelect={(color) => topic && actions.setBranchColor(topic.id, color)}
      />

      <ToolbarSeparator />

      <ToolbarButton
        label="Formula LaTeX (Ctrl+Maiusc+L)"
        active={topic?.kind === 'equation'}
        disabled={!hasTopic}
        onClick={() => topic && onOpenLatex(topic.id)}
      >
        <Sigma className="size-4" />
      </ToolbarButton>
      <NotesPopover topic={topic} actions={actions} />
      <StructurePopover
        topic={topic}
        allTopics={allTopics}
        relationships={relationships}
        actions={actions}
        selectedTopicIds={selectedTopicIds}
        canAddSummary={canAddSummary}
        onAddSummaryForSelection={onAddSummaryForSelection}
        onStartConnectRelationship={onStartConnectRelationship}
      />

      <ToolbarSeparator />

      <LinkPopover topic={topic} actions={actions} />
      <MarkersPopover topic={topic} actions={actions} />

      {multiple && (
        <>
          <ToolbarSeparator />
          <span className="shrink-0 whitespace-nowrap px-1.5 text-xs text-muted-foreground">
            {selectedTopicIds.length} blocchi
          </span>
          <ToolbarButton
            label="Crea sommario (Ctrl+])"
            disabled={!canAddSummary}
            onClick={onAddSummaryForSelection}
            className="w-auto gap-1.5 px-2 text-xs"
          >
            <Braces className="size-4" />
            Sommario
          </ToolbarButton>
        </>
      )}
    </div>
  );
};
