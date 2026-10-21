import React, { useMemo, useRef, useState } from 'react';
import type { Layout, LayoutNode } from '@xmap/core';
import { Braces, CornerDownLeft, Edit3, Network, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Separator, cn } from '@xmap/ui-kit';
import { ContextMenu } from './map/ContextMenu.js';
import { NodeEditor } from './map/NodeEditor.js';
import { RelationshipLayer } from './map/RelationshipLayer.js';
import { buildDragIndex } from './map/dragTarget.js';
import { backgroundMenuItems, nodeMenuItems } from './map/menus.js';
import { MapEdges } from './map/MapEdges.js';
import { ZoomControls } from './map/MapControls.js';
import { NodeCard } from './map/NodeCard.js';
import { TopicDragOverlay } from './map/TopicDragOverlay.js';
import { buildFormulaSvgCache, buildResourceUrls } from './map/assets.js';
import { nodeLook } from './map/nodeLook.js';
import { useAutoFit } from './map/useAutoFit.js';
import { useMapGestures } from './map/useMapGestures.js';
import { useMapShortcuts } from './map/useMapShortcuts.js';
import { useMediaQuery } from './map/useMediaQuery.js';
import { useRevealNode } from './map/useRevealNode.js';
import { useTopicResize } from './map/useTopicResize.js';
import { useViewport } from './map/useViewport.js';
import type { ContextMenuState, DragOverlay, MapHandlers, MapViewProps } from './map/types.js';

export type { MapEditing, MapViewProps } from './map/types.js';

export const MapView: React.FC<MapViewProps> = ({
  layout,
  viewKey,
  selectedTopicId,
  selectedTopicIds,
  onSelectTopic,
  onClearSelection,
  onOpenLatex,
  onAddChild,
  onAddSibling,
  onDeleteTopic,
  onRemoveTopicKeepChildren,
  onToggleCollapse,
  resourceResolver,
  darkMode = true,
  structure,
  onStructureChange,
  onMoveTopic,
  onMoveFloatingTopic,
  onRelationshipControlPointsChange,
  onResizeTopicWidth,
  onResizeTopicImage,
  editing = null,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onAddSummary,
  canAddSummary = false,
  onCopyTopic,
  onCutTopic,
  onPasteTopic,
  onDuplicateTopic,
  onStartConnectRelationship,
  canPaste = false,
  isConnectingRelationship = false,
  onConnectRelationshipTarget,
}) => {
  const isCoarse = useMediaQuery('(pointer: coarse)');
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const viewport = useViewport(layout);
  const { view, containerRef, svgRef, viewportGroupRef, toolbarRef, editorLayerRef, selectedNodeRef, toWorld, zoomByButton, fitToView, fitAnimated } = viewport;
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragOverlay, setDragOverlay] = useState<DragOverlay | null>(null);
  const layoutRef = useRef<Layout | null>(layout);
  layoutRef.current = layout;
  const dragIndex = useMemo(() => (layout ? buildDragIndex(layout) : null), [layout]);
  const dragIndexRef = useRef(dragIndex);
  dragIndexRef.current = dragIndex;
  const selectedTopicIdRef = useRef(selectedTopicId);
  selectedTopicIdRef.current = selectedTopicId;
  const selectedTopicIdsRef = useRef(selectedTopicIds);
  selectedTopicIdsRef.current = selectedTopicIds;
  const hasContent = Boolean(layout && layout.nodes.length > 0);

  // Callback in un ref: il contenuto memoizzato non si ricostruisce se il genitore le ricrea.
  const handlersValue: MapHandlers = {
    onSelectTopic,
    onOpenLatex,
    onAddChild,
    onAddSibling,
    onDeleteTopic,
    onRemoveTopicKeepChildren,
    onToggleCollapse,
    onMoveTopic,
    onMoveFloatingTopic,
    onRelationshipControlPointsChange,
    onStartEdit,
    onAddSummary,
    onResizeTopicWidth,
    onResizeTopicImage,
    onCopyTopic,
    onCutTopic,
    onPasteTopic,
    onDuplicateTopic,
    onStartConnectRelationship,
    isConnectingRelationship,
    onConnectRelationshipTarget,
  };
  const handlers = useRef(handlersValue);
  handlers.current = handlersValue;

  const { effectiveLayout, startResize } = useTopicResize({ layout, toWorld, handlers });
  useAutoFit({ layout, viewKey, selectedTopicId, viewport });
  useMapGestures(viewport, {
    hasContent,
    layoutRef,
    dragIndexRef,
    handlers,
    editingRef,
    selectedTopicIdRef,
    selectedTopicIdsRef,
    setContextMenu,
    setSelectedRelationshipId,
    setDragOverlay,
  });

  const selectedNode = useMemo(() => {
    if (!effectiveLayout || !selectedTopicId) return null;
    return effectiveLayout.nodes.find((n) => n.id === selectedTopicId) || null;
  }, [effectiveLayout, selectedTopicId]);

  selectedNodeRef.current = selectedNode;

  const editingNode = useMemo(() => {
    if (!effectiveLayout || !editing) return null;
    return effectiveLayout.nodes.find((n) => n.id === editing.id) || null;
  }, [effectiveLayout, editing]);

  useRevealNode({ viewport, editing, editingNode });
  useMapShortcuts({ selectedTopicId, editing, handlers });

  const menuContext = { handlers, canPaste, canAddSummary };
  const buildNodeMenuItems = (nodeId: string) => {
    const node = layout?.nodes.find((n) => n.id === nodeId);
    return node ? nodeMenuItems(node, menuContext) : [];
  };
  const buildBackgroundMenuItems = () => backgroundMenuItems(menuContext, fitToView);

  const resourceUrls = useMemo(() => buildResourceUrls(layout, resourceResolver), [layout, resourceResolver]);
  const formulaSvgCache = useMemo(() => buildFormulaSvgCache(layout, darkMode), [layout, darkMode]);

  // Contenuto pesante dell'SVG: dipende solo da layout/selezione/tema, non da zoom
  // e pan, così durante i gesti React non lo ricostruisce.
  const content = useMemo(() => {
    const l = effectiveLayout;
    if (!l) return null;
    const selectedSet = new Set(selectedTopicIds && selectedTopicIds.length > 0 ? selectedTopicIds : []);
    if (selectedTopicId) selectedSet.add(selectedTopicId);

    const selectNode = (node: LayoutNode, e: React.MouseEvent<SVGGElement>) => {
      e.stopPropagation();
      if (handlers.current.isConnectingRelationship) {
        handlers.current.onConnectRelationshipTarget?.(node.id);
        return;
      }
      setSelectedRelationshipId(undefined);
      const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
      handlers.current.onSelectTopic(
        node.id,
        isMulti ? { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey } : undefined
      );
    };
    const activateNode = (node: LayoutNode, e: React.MouseEvent<SVGGElement>) => {
      e.stopPropagation();
      // I blocchi di testo si modificano in place (anche su touch), le formule nell'editor LaTeX.
      if (editingRef.current?.id === node.id) return;
      if (node.kind === 'text' && handlers.current.onStartEdit) {
        handlers.current.onStartEdit(node.id);
      } else if (node.kind === 'equation') {
        handlers.current.onOpenLatex(node.id);
      }
    };

    return (
      <>
        <defs>
          <pattern
            id="map-dot-grid"
            x="0"
            y="0"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1" fill="var(--map-grid-dot)" />
          </pattern>

        </defs>

        <rect
          id="map-bg"
          data-print-hide
          x={-15000}
          y={-15000}
          width={45000}
          height={45000}
          fill="url(#map-dot-grid)"
        />

        <MapEdges layout={l} />

        {l.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            look={nodeLook(node, darkMode)}
            isSelected={selectedSet.has(node.id)}
            isPrimary={node.id === selectedTopicId}
            isEditing={editingRef.current?.id === node.id}
            formulaSvg={formulaSvgCache.get(node.id)}
            imageUrl={node.imageSrc ? resourceUrls.get(node.imageSrc) : undefined}
            isCoarse={isCoarse}
            onSelect={selectNode}
            onActivate={activateNode}
            onToggleCollapse={(topicId) => handlers.current.onToggleCollapse(topicId)}
            onResetWidth={(topicId) => handlers.current.onResizeTopicWidth?.(topicId, null)}
            onStartResize={startResize}
          />
        ))}

        {/* Relazioni dopo i blocchi: le maniglie di piegatura devono restare cliccabili anche
            sopra i blocchi. `data-map-ui` esclude il layer da pan e drag del contenitore. */}
        <g data-map-ui>
          <RelationshipLayer
            relationships={l.relationships}
            nodes={l.nodes}
            selectedRelationshipId={selectedRelationshipId}
            onSelectRelationship={setSelectedRelationshipId}
            onControlPointsChange={(relId, points) =>
              handlers.current.onRelationshipControlPointsChange?.(relId, points)
            }
            toWorld={toWorld}
            darkMode={darkMode}
          />
        </g>
      </>
    );
  }, [effectiveLayout, selectedTopicId, selectedTopicIds, selectedRelationshipId, darkMode, resourceUrls, formulaSvgCache, toWorld, isCoarse, startResize]);

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 p-8 text-center select-none bg-background">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <Network className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Nessuna mappa da visualizzare.</p>
          <p className="text-xs text-muted-foreground">Apri un file .xmind o creane uno nuovo per iniziare.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex-1 h-full w-full overflow-clip bg-[var(--map-canvas)] select-none touch-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] cursor-grab active:cursor-grabbing transition-colors duration-150',
        dragOverlay && '!cursor-grabbing',
        isConnectingRelationship && '!cursor-crosshair'
      )}
      onClick={(e) => {
        // Click o tap sullo sfondo: deseleziona relazione e blocchi (con Maiusc/Ctrl la selezione resta).
        const t = e.target as Element;
        if (t !== e.currentTarget && t.tagName !== 'svg' && t.id !== 'map-bg') return;
        setSelectedRelationshipId(undefined);
        if (isConnectingRelationship || e.shiftKey || e.ctrlKey || e.metaKey) return;
        onClearSelection?.();
      }}
    >
      {/* Controlli zoom flottanti in basso a destra */}
      <ZoomControls
        structure={structure}
        onStructureChange={onStructureChange}
        zoom={view.k}
        onZoom={zoomByButton}
        onFit={fitAnimated}
      />

      {/* Barra contestuale flottante sul nodo selezionato: visibile solo su dispositivi touch (pointer: coarse) */}
      {isCoarse && selectedNode && (
        <div
          ref={toolbarRef}
          data-map-ui
          // Niente focus sui pulsanti: le scorciatoie da tastiera sulla mappa restano attive.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 pointer-events-auto flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer max-w-[calc(100%-16px)]"
          style={{ transform: 'translateY(-100%)' }}
        >
          {onAddChild && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<Plus className="size-4" />}
              onClick={() => onAddChild(selectedNode.id)}
              title="Aggiungi sotto-blocco"
            >
              <span className="hidden min-[380px]:inline">Sotto-blocco</span>
              <span className="min-[380px]:hidden">Sotto</span>
            </Button>
          )}
          {onAddSibling && selectedNode.depth > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<CornerDownLeft className="size-4" />}
              onClick={() => onAddSibling(selectedNode.id)}
              title="Aggiungi blocco fratello"
            >
              Fratello
            </Button>
          )}
          {onAddSummary && canAddSummary && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<Braces className="size-4" />}
              onClick={onAddSummary}
              title="Crea sommario (Ctrl+])"
            >
              Sommario
            </Button>
          )}
          {selectedNode.kind !== 'image' && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-[9px] text-xs sm:text-sm"
              icon={<Edit3 className="size-4" />}
              onClick={() =>
                selectedNode.kind === 'text' && onStartEdit
                  ? onStartEdit(selectedNode.id)
                  : onOpenLatex(selectedNode.id)
              }
              title={selectedNode.kind === 'text' ? 'Modifica il testo' : 'Modifica la formula'}
            >
              Modifica
            </Button>
          )}
          {selectedNode.depth > 0 && onDeleteTopic && (
            <>
              <Separator orientation="vertical" className="h-4 mx-0.5" />
              <IconButton
                size="sm"
                variant="ghost-destructive"
                label="Elimina blocco"
                onClick={() => onDeleteTopic(selectedNode.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      )}

      {/* Editor in place del titolo: stesso sistema di coordinate dell'SVG, quindi segue pan e zoom. */}
      {editingNode && editing && onCommitEdit && (
        <div
          ref={editorLayerRef}
          data-map-ui
          className="absolute left-0 top-0 z-10 size-0"
          style={{ transformOrigin: '0 0' }}
        >
          <NodeEditor
            key={editing.id}
            x={editingNode.x}
            y={editingNode.y}
            w={editingNode.w}
            h={editingNode.h}
            isRoot={editingNode.depth === 0}
            initialText={editing.mode === 'text' ? editing.text ?? '' : editingNode.title}
            initialRuns={editing.mode === 'text' ? undefined : editingNode.titleRuns}
            selectAll={editing.mode === 'all'}
            onCommit={(text, exit, runs) => onCommitEdit(editing.id, text, exit, runs)}
            onCancel={() => onCancelEdit?.()}
          />
        </div>
      )}
      {/* Canvas SVG principale */}
      {/* overflow-visible: l'SVG ritaglia prima della trasformazione, quindi senza
          questa classe a zoom < 1 la mappa verrebbe tagliata a una frazione del canvas.
          Pan e zoom sono applicati imperativamente (useViewport), non da React: attributo
          `transform` del gruppo a riposo, trasformazione CSS dell'SVG solo durante i gesti. */}
      <svg
        ref={svgRef}
        data-map-canvas
        className="w-full h-full overflow-visible"
        style={{ transformOrigin: '0 0', textRendering: 'geometricPrecision' }}
      >
        <g ref={viewportGroupRef} data-map-viewport>
          <g data-map-content>
            {content}
          </g>
          <TopicDragOverlay dragOverlay={dragOverlay} layout={layout} darkMode={darkMode} />
        </g>
      </svg>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            contextMenu.target.type === 'node'
              ? buildNodeMenuItems(contextMenu.target.topicId)
              : buildBackgroundMenuItems()
          }
          onClose={() => setContextMenu(null)}
          ariaLabel={
            contextMenu.target.type === 'node'
              ? 'Menu contestuale blocco'
              : 'Menu contestuale mappa'
          }
        />
      )}
    </div>
  );
};
