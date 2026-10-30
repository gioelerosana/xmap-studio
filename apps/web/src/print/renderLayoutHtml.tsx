import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Layout } from '@xmap/core';
import { MapEdges } from '../components/map/MapEdges.js';
import { NodeCard } from '../components/map/NodeCard.js';
import { RelationshipLayer } from '../components/map/RelationshipLayer.js';
import { buildFormulaSvgCache, buildResourceUrls } from '../components/map/assets.js';
import { nodeLook } from '../components/map/nodeLook.js';

/** La stampa non ha interazioni: ogni callback dei blocchi e delle relazioni non fa nulla. */
const noop = (): void => undefined;

/** Il layer delle relazioni usa `toWorld` solo per trascinare le maniglie, che fuori schermo non esistono. */
const originWorld = (): { x: number; y: number } => ({ x: 0, y: 0 });

interface LayoutContentProps {
  layout: Layout;
  resourceUrls: ReadonlyMap<string, string>;
  formulaSvgCache: ReadonlyMap<string, string>;
}

/** Stesso albero di `MapView` dentro `[data-map-content]`, in tema chiaro e senza il rettangolo di sfondo con la griglia. */
const LayoutContent = ({ layout, resourceUrls, formulaSvgCache }: LayoutContentProps): ReactElement => (
  <svg>
    <g data-map-content>
      <MapEdges layout={layout} />
      {layout.nodes.map((node) => (
        <NodeCard
          key={node.id}
          node={node}
          look={nodeLook(node, false)}
          isSelected={false}
          isPrimary={false}
          isEditing={false}
          formulaSvg={formulaSvgCache.get(node.id)}
          imageUrl={node.imageSrc ? resourceUrls.get(node.imageSrc) : undefined}
          isCoarse={false}
          onSelect={noop}
          onActivate={noop}
          onToggleCollapse={noop}
          onResetWidth={noop}
          onStartResize={noop}
        />
      ))}
      <g data-map-ui>
        <RelationshipLayer relationships={layout.relationships} nodes={layout.nodes} toWorld={originWorld} darkMode={false} />
      </g>
    </g>
  </svg>
);

/**
 * Stessa pulizia di `getPrintableMapClone` (apps/web/src/print/mapClone.ts): da tenere
 * allineata a quella. Non si ripristina lo stroke di default dei `[data-node-rect]`: senza
 * selezione è già quello giusto, e per le forme `underline` (stroke `none` a schermo)
 * ripristinarlo disegnerebbe un riquadro che a schermo non c'è.
 */
function stripInteractiveParts(content: SVGGElement): void {
  content.querySelectorAll('[data-print-hide]').forEach((el) => el.remove());
  content.querySelectorAll('path[stroke="transparent"]').forEach((el) => el.remove());
  content.querySelectorAll<SVGElement | HTMLElement>('[style*="cursor"]').forEach((el) => {
    el.style.setProperty('cursor', 'default');
  });
}

/**
 * Renderizza un `Layout` (anche diverso da quello a schermo) in HTML SVG fuori schermo e
 * restituisce l'`innerHTML` dei figli di `[data-map-content]`, in coordinate del mondo.
 * I file di stampa usano il risultato come `PrintableClone.innerHtml`.
 * Il tema chiaro dipende dalle variabili `var(--...)` del foglio: il chiamante deve
 * montarlo sotto `.print-light` (vedi `apps/web/src/index.css`).
 */
export function renderLayoutToSvgHtml(
  layout: Layout,
  resourceResolver: (src: string) => Uint8Array | null,
): string {
  const resourceUrls = buildResourceUrls(layout, resourceResolver);
  const formulaSvgCache = buildFormulaSvgCache(layout, false);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => {
      root.render(<LayoutContent layout={layout} resourceUrls={resourceUrls} formulaSvgCache={formulaSvgCache} />);
    });
    const content = container.querySelector('[data-map-content]');
    if (!(content instanceof SVGGElement)) {
      throw new Error('Impossibile preparare la mappa per la stampa.');
    }
    stripInteractiveParts(content);
    return content.innerHTML;
  } finally {
    root.unmount();
  }
}
