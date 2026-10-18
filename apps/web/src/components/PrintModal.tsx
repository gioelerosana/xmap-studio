import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Button,
  SegmentedControl,
  Select,
  Input,
  Field,
  Banner,
} from '@xmap/ui-kit';
import { Printer, FileDown } from 'lucide-react';
import { paginate, type Layout, type PaperSize, type PrintFit, type PrintOptions, type PrintPlan } from '@xmap/core';
import { computeLayoutBounds, getPrintableMapClone } from '../print/mapClone.js';
import { saveBytes } from '../adapters/fileSystem.js';

export interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  layout: Layout | null;
  suggestedBase?: string;
}

type FitMode = 'fit-page' | 'fit-width' | 'scale';

const PAPER_ITEMS: { id: PaperSize; label: string }[] = [
  { id: 'A4', label: 'A4' },
  { id: 'A3', label: 'A3' },
];

const ORIENTATION_ITEMS: { id: 'auto' | 'portrait' | 'landscape'; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'portrait', label: 'Verticale' },
  { id: 'landscape', label: 'Orizzontale' },
];

const FIT_ITEMS: { id: FitMode; label: string }[] = [
  { id: 'fit-page', label: 'Una pagina' },
  { id: 'fit-width', label: 'In larghezza' },
  { id: 'scale', label: 'Scala' },
];

const PAGES_WIDE_OPTIONS = [
  { value: 1, label: '1 pagina' },
  { value: 2, label: '2 pagine' },
  { value: 3, label: '3 pagine' },
  { value: 4, label: '4 pagine' },
  { value: 5, label: '5 pagine' },
  { value: 6, label: '6 pagine' },
];

export const PrintModal: React.FC<PrintModalProps> = ({
  isOpen,
  onClose,
  layout,
  suggestedBase = 'mappa',
}) => {
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [fitMode, setFitMode] = useState<FitMode>('fit-page');
  const [pagesWide, setPagesWide] = useState<number>(2);
  const [scalePercent, setScalePercent] = useState<number>(100);
  const [marginMm, setMarginMm] = useState<number>(10);
  const [overlapMm, setOverlapMm] = useState<number>(0);
  const [isPdfSaving, setIsPdfSaving] = useState(false);
  const [svgContent, setSvgContent] = useState<string>('');
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isElectronPdfAvailable = typeof window !== 'undefined' && Boolean(window.electronAPI?.printToPdf);

  // All'apertura la mappa si ridisegna in tema chiaro (anche le formule, in modo
  // asincrono): il clone per l'anteprima si cattura dopo un breve intervallo e si
  // ricattura comunque al momento di stampare.
  useEffect(() => {
    if (!isOpen) return;
    setPdfError(null);
    const capture = () => setSvgContent(getPrintableMapClone()?.innerHtml ?? '');
    capture();
    const timer = window.setTimeout(capture, 250);
    return () => window.clearTimeout(timer);
  }, [isOpen, layout]);

  // Calcola il bounding box della mappa nel mondo
  const bounds = useMemo(() => computeLayoutBounds(layout), [layout]);

  // Costruisce le opzioni di stampa
  const printOptions = useMemo<PrintOptions>(() => {
    let fit: PrintFit;
    if (fitMode === 'fit-page') {
      fit = { mode: 'fit-page' };
    } else if (fitMode === 'fit-width') {
      fit = { mode: 'fit-width', pagesWide };
    } else {
      fit = { mode: 'scale', scale: Math.max(0.01, scalePercent / 100) };
    }

    return {
      paper,
      orientation,
      fit,
      marginMm: Math.max(0, marginMm),
      overlapMm: Math.max(0, overlapMm),
    };
  }, [paper, orientation, fitMode, pagesWide, scalePercent, marginMm, overlapMm]);

  // Calcola il piano di stampa gestendo eventuali errori
  const { plan, error } = useMemo<{ plan: PrintPlan | null; error: string | null }>(() => {
    if (!isOpen) return { plan: null, error: null };
    try {
      const calculated = paginate(bounds, printOptions);
      return { plan: calculated, error: null };
    } catch (err: unknown) {
      return {
        plan: null,
        error: err instanceof Error ? err.message : 'Impossibile calcolare l\'impaginazione.',
      };
    }
  }, [bounds, printOptions, isOpen]);

  // Testo di riepilogo
  const summaryText = useMemo(() => {
    if (!plan) return null;
    const pageCount = plan.pages.length;
    const isPortrait = plan.orientation === 'portrait';
    const orientWord = pageCount === 1 ? (isPortrait ? 'verticale' : 'orizzontale') : (isPortrait ? 'verticali' : 'orizzontali');
    const scaleFormatted = Math.round(plan.scale * 100);

    if (pageCount === 1) {
      return `1 pagina ${plan.paper} ${orientWord}, scala ${scaleFormatted}%`;
    }
    return `${plan.cols} × ${plan.rows} = ${pageCount} pagine ${plan.paper} ${orientWord}, scala ${scaleFormatted}%`;
  }, [plan]);

  // Cleanup all'unmount
  useEffect(() => {
    return () => {
      document.getElementById('print-root')?.remove();
      document.getElementById('print-page-style')?.remove();
    };
  }, []);

  if (!isOpen) return null;

  // Prepara il DOM del portale di stampa #print-root e lo stile dinamico @page
  const preparePrintDom = (currentPlan: PrintPlan, contentHtml: string): (() => void) => {
    document.getElementById('print-root')?.remove();
    const root = document.createElement('div');
    root.id = 'print-root';

    currentPlan.pages.forEach((page, idx) => {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'print-page';
      pageDiv.style.width = `${currentPlan.pageWidthMm}mm`;
      pageDiv.style.height = `${currentPlan.pageHeightMm}mm`;
      pageDiv.style.padding = `${currentPlan.marginMm}mm`;
      pageDiv.style.boxSizing = 'border-box';
      pageDiv.style.breakAfter = idx === currentPlan.pages.length - 1 ? 'auto' : 'page';
      pageDiv.style.position = 'relative';
      pageDiv.style.overflow = 'hidden';
      pageDiv.style.background = '#ffffff';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', `${currentPlan.contentWidthPx}px`);
      svg.setAttribute('height', `${currentPlan.contentHeightPx}px`);
      svg.setAttribute('viewBox', `${page.world.x} ${page.world.y} ${page.world.w} ${page.world.h}`);
      svg.style.display = 'block';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.overflow = 'hidden';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = contentHtml;
      svg.appendChild(g);
      pageDiv.appendChild(svg);

      if (currentPlan.pages.length > 1) {
        const pageNum = document.createElement('div');
        pageNum.style.position = 'absolute';
        pageNum.style.bottom = '2mm';
        pageNum.style.right = '3mm';
        pageNum.style.fontSize = '8pt';
        pageNum.style.color = '#888888';
        pageNum.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        pageNum.textContent = `${page.row + 1}/${page.col + 1}`;
        pageDiv.appendChild(pageNum);
      }

      root.appendChild(pageDiv);
    });

    document.body.appendChild(root);

    let styleEl = document.getElementById('print-page-style');
    if (styleEl) styleEl.remove();
    styleEl = document.createElement('style');
    styleEl.id = 'print-page-style';
    styleEl.textContent = `@page { size: ${currentPlan.paper} ${currentPlan.orientation}; margin: 0; }`;
    document.head.appendChild(styleEl);

    // Il tema chiaro su carta lo garantiscono le variabili di #print-root (index.css).
    return () => {
      document.getElementById('print-root')?.remove();
      document.getElementById('print-page-style')?.remove();
    };
  };

  const handlePrint = () => {
    if (!plan) return;
    const cleanup = preparePrintDom(plan, getPrintableMapClone()?.innerHtml ?? svgContent);
    const onAfterPrint = () => {
      window.removeEventListener('afterprint', onAfterPrint);
      cleanup();
    };
    window.addEventListener('afterprint', onAfterPrint);
    setTimeout(() => {
      window.print();
    }, 50);
  };

  const handleSavePdf = async () => {
    if (!plan || !window.electronAPI?.printToPdf) return;
    setIsPdfSaving(true);
    setPdfError(null);
    const cleanup = preparePrintDom(plan, getPrintableMapClone()?.innerHtml ?? svgContent);
    try {
      const bytesArray = await window.electronAPI.printToPdf({
        pageSize: plan.paper,
        landscape: plan.orientation === 'landscape',
      });
      const bytes = new Uint8Array(bytesArray);
      await saveBytes(bytes, `${suggestedBase}.pdf`, 'application/pdf', {
        description: 'Documento PDF',
        extensions: ['pdf'],
      });
    } catch (err: unknown) {
      setPdfError(err instanceof Error ? err.message : 'Errore durante il salvataggio del PDF.');
    } finally {
      cleanup();
      setIsPdfSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stampa mappa"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2 flex-wrap">
          <Button variant="secondary" onClick={onClose} disabled={isPdfSaving}>
            Annulla
          </Button>
          {isElectronPdfAvailable && (
            <Button
              variant="outline"
              icon={<FileDown className="size-4" />}
              loading={isPdfSaving}
              disabled={!plan || Boolean(error)}
              onClick={handleSavePdf}
            >
              Salva PDF…
            </Button>
          )}
          <Button
            variant="default"
            icon={<Printer className="size-4" />}
            disabled={!plan || Boolean(error) || isPdfSaving}
            onClick={handlePrint}
          >
            Stampa
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 max-w-full">
        {pdfError && (
          <Banner variant="error" title="PDF non salvato">
            {pdfError}
          </Banner>
        )}
        {error && (
          <Banner variant="error" title="Impossibile impaginare">
            {error}
          </Banner>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">
          {/* Colonna opzioni */}
          <div className="flex flex-col gap-3.5">
            <Field label="Formato carta">
              <SegmentedControl size="sm" items={PAPER_ITEMS} activeId={paper} onChange={setPaper} />
            </Field>

            <Field label="Orientamento">
              <SegmentedControl
                size="sm"
                items={ORIENTATION_ITEMS}
                activeId={orientation}
                onChange={setOrientation}
              />
            </Field>

            <Field label="Adattamento">
              <SegmentedControl size="sm" items={FIT_ITEMS} activeId={fitMode} onChange={setFitMode} />
            </Field>

            {fitMode === 'fit-width' && (
              <Field label="Pagine in larghezza">
                <Select
                  size="sm"
                  options={PAGES_WIDE_OPTIONS}
                  value={pagesWide}
                  onChange={(e) => setPagesWide(Number(e.target.value))}
                />
              </Field>
            )}

            {fitMode === 'scale' && (
              <Field label="Scala (%)">
                <Input
                  size="sm"
                  type="number"
                  min={10}
                  max={400}
                  step={5}
                  value={scalePercent}
                  onChange={(e) => setScalePercent(Math.max(1, Number(e.target.value) || 100))}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Margine (mm)">
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={marginMm}
                  onChange={(e) => setMarginMm(Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>

              <Field
                label="Sovrapposizione (mm)"
                hint={plan && plan.pages.length > 1 ? undefined : 'Disponibile con più pagine'}
              >
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={overlapMm}
                  disabled={!plan || plan.pages.length <= 1}
                  onChange={(e) => setOverlapMm(Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>
            </div>
          </div>

          {/* Colonna anteprima */}
          <div className="flex flex-col gap-2 min-w-0">
            {summaryText && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground">
                {summaryText}
              </div>
            )}

            <div className="print-light rounded-lg border bg-muted/20 p-4 min-h-[240px] max-h-[380px] overflow-auto flex items-center justify-center">
              {plan && (
                <div
                  className="grid gap-2 max-w-full justify-center"
                  style={{
                    gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`,
                  }}
                >
                  {plan.pages.map((p) => (
                    <div
                      key={p.index}
                      className="bg-white border border-border/80 shadow-xs rounded-sm relative overflow-hidden flex items-center justify-center"
                      style={{
                        aspectRatio: `${plan.pageWidthMm} / ${plan.pageHeightMm}`,
                        minWidth: Math.min(140, Math.max(50, Math.floor(320 / plan.cols))),
                      }}
                    >
                      <svg
                        viewBox={`${p.world.x} ${p.world.y} ${p.world.w} ${p.world.h}`}
                        className="w-full h-full block"
                        preserveAspectRatio="xMidYMid meet"
                      >
                        <g dangerouslySetInnerHTML={{ __html: svgContent }} />
                      </svg>
                      {plan.pages.length > 1 && (
                        <span className="absolute bottom-1 right-1 text-3xs font-mono text-muted-foreground bg-white/90 px-1 py-0.5 rounded border border-border/60 select-none">
                          {p.row + 1},{p.col + 1}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
