import React, { useEffect, useState } from 'react';
import { Banner, cn } from '@xmap/ui-kit';

interface LatexPreviewProps {
  preview: { svg: string; error: string | null } | null;
}

// Ingrandimento dell'anteprima rispetto alla dimensione dell'equazione sulla mappa.
const PREVIEW_ZOOM = 1.5;

// Anteprima grande al centro; con un errore di sintassi mostra il messaggio e tiene l'ultimo rendering valido.
export const LatexPreview: React.FC<LatexPreviewProps> = ({ preview }) => {
  const [lastGoodSvg, setLastGoodSvg] = useState('');

  useEffect(() => {
    if (!preview) setLastGoodSvg('');
    else if (preview.svg) setLastGoodSvg(preview.svg);
  }, [preview]);

  const error = preview?.error ?? null;
  const svg = preview?.svg || (error ? lastGoodSvg : '');

  return (
    <div className="flex flex-col gap-2">
      <div
        aria-label="Anteprima della formula"
        className="flex min-h-28 overflow-x-auto rounded-lg border bg-card"
      >
        {svg ? (
          <div
            // `m-auto` centra le formule corte senza tagliare l'inizio di quelle lunghe.
            className={cn('m-auto shrink-0 px-6 py-5 transition-opacity', error && 'opacity-40')}
            style={{ zoom: PREVIEW_ZOOM }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <span className="m-auto px-6 py-5 text-sm italic text-muted-foreground">
            Scrivi una formula per vedere l'anteprima
          </span>
        )}
      </div>
      {error ? <Banner variant="error">{error}</Banner> : null}
    </div>
  );
};
