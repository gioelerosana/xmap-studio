import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, renderLatexToSvg } from '@xmap/core';
import {
  Plus,
  Minus,
  Maximize2,
  FileText,
  Sigma,
  Network,
  Edit3,
  Trash2,
} from 'lucide-react';
import { Button, IconButton, Separator, cn } from '@xmap/ui-kit';

// MathJax produce SVG con colore letterale, non una variabile CSS: i valori
// replicano il token foreground nei due temi. La radice ha sfondo "inchiostro"
// (--map-root), quindi la sua formula usa il colore invertito rispetto al tema.
const FORMULA_COLOR = { dark: '#f5f5f5', light: '#2b2b30' };
const FORMULA_COLOR_ON_ROOT = { dark: '#0a0a0a', light: '#fcfcfc' };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface MapViewProps {
  layout: Layout | null;
  selectedTopicId?: string;
  onSelectTopic: (topicId: string) => void;
  onOpenDetails: (topicId: string) => void;
  onOpenLatex?: (topicId: string) => void;
  onAddChild?: (topicId: string) => void;
  onDeleteTopic?: (topicId: string) => void;
  onToggleCollapse: (topicId: string) => void;
  resourceResolver: (src: string) => Uint8Array | null;
  darkMode?: boolean;
}

export const MapView: React.FC<MapViewProps> = ({
  layout,
  selectedTopicId,
  onSelectTopic,
  onOpenDetails,
  onOpenLatex,
  onAddChild,
  onDeleteTopic,
  onToggleCollapse,
  resourceResolver,
  darkMode = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
@@STATE@@
  // Cache delle risorse immagine / PNG come data URL
  const resourceUrls = useMemo(() => {
    const map = new Map<string, string>();
    if (!layout) return map;
    for (const node of layout.nodes) {
      if (!node.imageSrc || map.has(node.imageSrc)) continue;
      const bytes = resourceResolver(node.imageSrc);
      if (!bytes) continue;
      map.set(node.imageSrc, `data:image/png;base64,${bytesToBase64(bytes)}`);
    }
    return map;
  }, [layout, resourceResolver]);

  // Cache per il rendering SVG vettoriale delle formule LaTeX nei nodi
  const formulaSvgCache = useMemo(() => {
    const cache = new Map<string, string>();
    if (!layout) return cache;

    const theme = darkMode ? 'dark' : 'light';
    for (const node of layout.nodes) {
      const latex = node.latex;
      if (latex) {
        try {
          const res = renderLatexToSvg(latex, 16);
          if (!res.error && res.svg) {
            const onRootInk = node.depth === 0 && !node.fill;
            const color = (onRootInk ? FORMULA_COLOR_ON_ROOT : FORMULA_COLOR)[theme];
            const coloredSvg = res.svg.replaceAll('currentColor', color);
            cache.set(node.id, coloredSvg);
          }
        } catch {}
      }
    }
    return cache;
  }, [layout, darkMode]);

@@LOGIC@@
  const selectedNode = useMemo(() => {
    if (!layout || !selectedTopicId) return null;
    return layout.nodes.find((n) => n.id === selectedTopicId) || null;
  }, [layout, selectedTopicId]);

@@CONTENT@@
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
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopPan}
      onMouseLeave={stopPan}
      className="relative flex-1 h-full w-full overflow-hidden bg-background select-none cursor-grab active:cursor-grabbing transition-colors duration-150"
    >
      {/* Controlli zoom flottanti in basso a destra */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer">
        <IconButton
          size="sm"
          variant="ghost"
          label="Riduci zoom"
          onClick={() => setZoom((z) => Math.max(z * 0.85, 0.12))}
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
          onClick={() => setZoom((z) => Math.min(z * 1.15, 3.5))}
        >
          <Plus className="size-4" />
        </IconButton>
        <Separator orientation="vertical" className="h-4 mx-0.5" />
        <IconButton size="sm" variant="ghost" label="Adatta alla finestra" onClick={fitToView}>
          <Maximize2 className="size-4" />
        </IconButton>
      </div>

      {/* Barra contestuale flottante sul nodo selezionato */}
      {selectedNode && (
        <div
          className="absolute z-20 pointer-events-auto flex items-center gap-0.5 p-1 surface-glass border rounded-xl shadow-composer"
          style={{
            left: `${pan.x + selectedNode.x * zoom}px`,
            top: `${pan.y + (selectedNode.y - 42) * zoom}px`,
            transform: 'translateY(-100%)',
          }}
        >
          {onAddChild && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => onAddChild(selectedNode.id)}
              title="Aggiungi sotto-blocco"
            >
              Sotto-blocco
            </Button>
          )}
          {onOpenLatex && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Sigma className="size-4" />}
              onClick={() => onOpenLatex(selectedNode.id)}
              title="Modifica formula LaTeX"
            >
              Formula
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<Edit3 className="size-4" />}
            onClick={() => onOpenDetails(selectedNode.id)}
            title="Apri pannello dettagli"
          >
            Dettagli
          </Button>
          {selectedNode.depth > 0 && onDeleteTopic && (
            <>
              <Separator orientation="vertical" className="h-4 mx-0.5" />
              <IconButton
                size="sm"
                variant="ghost-destructive"
                label="Elimina blocco"
                onClick={() => {
                  if (confirm('Eliminare questo blocco?')) {
                    onDeleteTopic(selectedNode.id);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      )}

@@SVG@@
    </div>
  );
};
