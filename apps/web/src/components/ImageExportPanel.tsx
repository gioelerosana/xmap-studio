import React, { useEffect, useState } from 'react';
import { Button, SegmentedControl, Checkbox, Field, Banner } from '@xmap/ui-kit';
import { Download } from 'lucide-react';
import type { Layout } from '@xmap/core';
import { getPrintableMapClone, computeLayoutBounds } from '../print/mapClone.js';
import { renderMapImage, type MapImageFormat } from '../export/mapImage.js';
import { saveBytes } from '../adapters/fileSystem.js';

export interface ImageExportPanelProps {
  /** Formato scelto nel dialogo «Esporta». */
  format: MapImageFormat;
  /** Chiamata a salvataggio riuscito. */
  onDone: () => void;
  layout: Layout | null;
  suggestedBase?: string;
  onSaved?: (message: string) => void;
}

const SCALE_ITEMS = [
  { id: '1', label: '1×' },
  { id: '2', label: '2×' },
  { id: '3', label: '3×' },
];

const FORMAT_SPEC: Record<MapImageFormat, { mime: string; description: string }> = {
  png: { mime: 'image/png', description: 'Immagine PNG' },
  svg: { mime: 'image/svg+xml', description: 'Immagine SVG' },
};

export const ImageExportPanel: React.FC<ImageExportPanelProps> = ({
  format,
  onDone,
  layout,
  suggestedBase = 'mappa',
  onSaved,
}) => {
  const [scale, setScale] = useState('2');
  const [transparent, setTransparent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');

  // La mappa si ridisegna in chiaro all'apertura (App.tsx): il clone per l'anteprima si
  // cattura dopo un breve intervallo, come nella stampa.
  useEffect(() => {
    setError(null);
    const capture = () => setPreviewHtml(getPrintableMapClone()?.innerHtml ?? '');
    capture();
    const timer = window.setTimeout(capture, 250);
    return () => window.clearTimeout(timer);
  }, [layout]);

  const bounds = computeLayoutBounds(layout);
  const spec = FORMAT_SPEC[format];

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await renderMapImage({
        layout,
        format,
        transparent,
        scale: Number(scale),
        title: suggestedBase,
      });
      const saved = await saveBytes(result.bytes, `${suggestedBase}.${format}`, spec.mime, {
        description: spec.description,
        extensions: [format],
      });
      if (saved) {
        onSaved?.(
          result.clamped
            ? `Immagine salvata (${result.width}×${result.height} px, risoluzione ridotta per il limite del canvas)`
            : `Immagine salvata (${result.width}×${result.height} px)`,
        );
        onDone();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore durante l\'esportazione dell\'immagine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {format === 'png' && (
        <Field label="Risoluzione">
          <SegmentedControl items={SCALE_ITEMS} activeId={scale} onChange={setScale} />
        </Field>
      )}

        <Checkbox checked={transparent} onCheckedChange={setTransparent} label="Sfondo trasparente" />

        <div
          className="print-light rounded-lg border bg-muted/20 p-3 max-h-[280px] overflow-auto flex items-center justify-center"
          style={transparent ? undefined : { background: 'var(--map-canvas)' }}
        >
          {previewHtml ? (
            <svg
              viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
              className="w-full h-auto max-h-[250px] block"
              preserveAspectRatio="xMidYMid meet"
            >
              <g dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </svg>
          ) : (
            <p className="text-xs text-muted-foreground">Nessuna mappa da esportare.</p>
          )}
        </div>

        <p className="text-2xs text-muted-foreground">
          {format === 'png'
            ? `Circa ${Math.round(bounds.w * Number(scale))}×${Math.round(bounds.h * Number(scale))} px, senza filigrana, sempre in tema chiaro.`
            : 'SVG autonomo, senza filigrana, sempre in tema chiaro. I caratteri restano per nome: su un altro computer possono essere sostituiti.'}
        </p>

        {error && <Banner variant="error">{error}</Banner>}
      <div className="flex w-full items-center justify-end gap-2">
        <Button
          variant="default"
          icon={<Download className="size-4" />}
          loading={saving}
          disabled={!previewHtml}
          onClick={handleSave}
        >
          Salva .{format}
        </Button>
      </div>
    </div>
  );
};
