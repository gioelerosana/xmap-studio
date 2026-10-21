import { useEffect, useRef } from 'react';
import type { Layout } from '@xmap/core';
import type { Viewport } from './useViewport.js';

/**
 * Adatta la vista al cambio di documento e, alle modifiche, la trasla in modo che il blocco
 * di riferimento resti fermo sullo schermo. Lo zoom non cambia.
 */
export function useAutoFit({
  layout,
  viewKey,
  selectedTopicId,
  viewport,
}: {
  layout: Layout | null;
  viewKey?: string;
  selectedTopicId?: string;
  viewport: Viewport;
}) {
  const { viewRef, containerRef, commitView, setView, fitToView } = viewport;
  const hasAutoFitted = useRef(false);
  const lastLayoutRef = useRef<Layout | null>(null);
  const lastViewKeyRef = useRef<string | undefined>(undefined);
  const anchorIdRef = useRef<string | undefined>(selectedTopicId); // selezione prima dell'ultima modifica

  // ResizeObserver e auto-fit solo quando cambia il documento (file o foglio).
  // Le modifiche (aggiunte, rinomine, spostamenti) non toccano lo zoom: la vista
  // trasla soltanto perché il blocco di riferimento resti fermo sullo schermo.
  useEffect(() => {
    if (!layout) return;

    const prev = lastLayoutRef.current;
    if (prev !== layout) {
      lastLayoutRef.current = layout;
      const rootOf = (l: Layout) => l.nodes.find((n) => n.depth === 0)?.id;
      const keyChanged = lastViewKeyRef.current !== viewKey;
      lastViewKeyRef.current = viewKey;
      if (!prev || keyChanged || rootOf(prev) !== rootOf(layout)) {
        hasAutoFitted.current = false;
      } else if (hasAutoFitted.current) {
        // Riferimento: il blocco selezionato prima della modifica, se esiste ancora, altrimenti la radice.
        const pick = (id?: string) => {
          const b = id ? prev.nodes.find((n) => n.id === id) : undefined;
          const a = b && layout.nodes.find((n) => n.id === b.id);
          return b && a ? { b, a } : null;
        };
        const pair = pick(anchorIdRef.current) ?? pick(rootOf(prev));
        const v = viewRef.current;
        let { x, y } = v;
        if (pair) {
          x -= (pair.a.x - pair.b.x) * v.k;
          y -= (pair.a.y - pair.b.y) * v.k;
        }
        // Il blocco selezionato (es. appena creato) deve restare visibile: pan minimo, zoom invariato.
        const sel = selectedTopicId ? layout.nodes.find((n) => n.id === selectedTopicId) : undefined;
        const rect = containerRef.current?.getBoundingClientRect();
        if (sel && rect) {
          const pad = 32;
          const left = x + sel.x * v.k;
          const right = x + (sel.x + sel.w) * v.k;
          const top = y + sel.y * v.k;
          const bottom = y + (sel.y + sel.h) * v.k;
          if (right > rect.width - pad) x -= right - (rect.width - pad);
          if (left < pad) x += pad - left;
          if (bottom > rect.height - pad) y -= bottom - (rect.height - pad);
          if (top < pad) y += pad - top;
        }
        if (x !== v.x || y !== v.y) {
          viewRef.current = { ...v, x, y };
          commitView();
          setView({ ...viewRef.current });
        }
      }
    }

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 50 && entry.contentRect.height > 50) {
          if (!hasAutoFitted.current) {
            hasAutoFitted.current = true;
            fitToView();
          }
        }
      }
    });

    ro.observe(container);

    // Timeout fallback per primo frame
    const timer = setTimeout(() => {
      if (!hasAutoFitted.current) {
        hasAutoFitted.current = true;
        fitToView();
      }
    }, 50);

    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [layout, fitToView]);

  // Dichiarato dopo l'effetto di auto-fit: lì serve ancora la selezione precedente.
  useEffect(() => {
    anchorIdRef.current = selectedTopicId;
  }, [selectedTopicId]);

}
