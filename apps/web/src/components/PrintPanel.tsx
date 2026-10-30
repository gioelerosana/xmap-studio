import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  SegmentedControl,
  Select,
  Input,
  Field,
  Banner,
} from '@xmap/ui-kit';
import { Printer, FileDown } from 'lucide-react';
import {
  MIN_LEGIBLE_SCALE,
  paginate,
  paginateByBranches,
  paginateToMapSize,
  type Layout,
  type PaperSize,
  type PrintFit,
  type PrintOptions,
  type PrintPage,
  type PrintPlan,
} from '@xmap/core';
import { computeLayoutBounds, getPrintableMapClone } from '../print/mapClone.js';
import { renderLayoutToSvgHtml } from '../print/renderLayoutHtml.js';
import { saveBytes } from '../adapters/fileSystem.js';

export interface PrintPanelProps {
  /** `print`: stampa e, nel desktop, PDF; `pdf`: solo salvataggio PDF (dialogo «Esporta»). */
  mode: 'print' | 'pdf';
  /** Chiamata dopo un salvataggio o una stampa avviati con successo. */
  onDone: () => void;
  /** Layout mostrato a schermo. */
  layout: Layout | null;
  /** Layout con struttura ad albero compatto, per la stampa (uguale a `layout` se lo schermo è già ad albero). */
  compactLayout: Layout | null;
  /** Lo schermo usa già l'albero compatto: la scelta della struttura non cambia nulla. */
  screenIsCompact: boolean;
  resourceResolver: (src: string) => Uint8Array | null;
  suggestedBase?: string;
}

type FitMode = 'branches' | 'fit-page' | 'fit-width' | 'scale' | 'map-size';

const PAPER_ITEMS: { id: PaperSize; label: string }[] = [
  { id: 'A4', label: 'A4' },
  { id: 'A3', label: 'A3' },
];

const ORIENTATION_ITEMS: { id: 'auto' | 'portrait' | 'landscape'; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'portrait', label: 'Verticale' },
  { id: 'landscape', label: 'Orizzontale' },
];

const FIT_OPTIONS: { value: FitMode; label: string }[] = [
  { value: 'branches', label: 'Per rami (leggibile, a capo tra i rami)' },
  { value: 'fit-page', label: 'Una pagina' },
  { value: 'fit-width', label: 'In larghezza (fogli da affiancare)' },
  { value: 'scale', label: 'Scala fissa (fogli da affiancare)' },
  { value: 'map-size', label: 'Come la mappa (una pagina su misura)' },
];

const STRUCTURE_ITEMS: { id: 'screen' | 'compact'; label: string }[] = [
  { id: 'screen', label: 'Come a schermo' },
  { id: 'compact', label: 'Albero compatto' },
];

/** Millimetri con al massimo un decimale: le dimensioni su misura non diventano cifre lunghe. */
const formatMm = (mm: number): string => String(Math.round(mm * 10) / 10);

const pageHeaderText = (page: PrintPage, total: number): { left: string; right: string } => {
  const header = page.header;
  if (!header) return { left: '', right: '' };
  const trail = [header.title, ...header.trail].filter(Boolean).join(' › ');
  return { left: header.continued ? `${trail} (continua)` : trail, right: `${page.index + 1}/${total}` };
};

const PAGES_WIDE_OPTIONS = [
  { value: 1, label: '1 pagina' },
  { value: 2, label: '2 pagine' },
  { value: 3, label: '3 pagine' },
  { value: 4, label: '4 pagine' },
  { value: 5, label: '5 pagine' },
  { value: 6, label: '6 pagine' },
];

export const PrintPanel: React.FC<PrintPanelProps> = ({
  mode,
  onDone,
  layout,
  compactLayout,
  screenIsCompact,
  resourceResolver,
  suggestedBase = 'mappa',
}) => {
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [fitMode, setFitMode] = useState<FitMode>('branches');
  const [compact, setCompact] = useState(true);
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
  // Struttura ad albero compatto diversa da quella a schermo: la mappa si ridisegna da `compactLayout`
  // invece di clonare il DOM dello schermo.
  const redrawFromLayout = compact && !screenIsCompact && compactLayout !== null ? compactLayout : null;
  const activeLayout = redrawFromLayout ?? layout;

  const captureContent = useCallback(
    (): string =>
      redrawFromLayout
        ? renderLayoutToSvgHtml(redrawFromLayout, resourceResolver)
        : (getPrintableMapClone()?.innerHtml ?? ''),
    [redrawFromLayout, resourceResolver],
  );

  useEffect(() => {
    setPdfError(null);
    // Fuori dal ciclo di vita di React: `renderLayoutToSvgHtml` usa `flushSync`, che dentro un effetto non svuota.
    const capture = () => setSvgContent(captureContent());
    const timers = [window.setTimeout(capture, 0), window.setTimeout(capture, 250)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [captureContent]);

  // Calcola il bounding box della mappa nel mondo
  const bounds = useMemo(() => computeLayoutBounds(activeLayout), [activeLayout]);

  // Costruisce le opzioni di stampa
  const printOptions = useMemo<PrintOptions>(() => {
    let fit: PrintFit;
    if (fitMode === 'fit-width') {
      fit = { mode: 'fit-width', pagesWide };
    } else if (fitMode === 'scale') {
      fit = { mode: 'scale', scale: Math.max(0.01, scalePercent / 100) };
    } else {
      fit = { mode: 'fit-page' };
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
    try {
      if (fitMode === 'map-size') return { plan: paginateToMapSize(bounds), error: null };
      if (fitMode === 'branches') {
        if (!activeLayout) throw new Error('Nessuna mappa da stampare.');
        const { paper, orientation, marginMm } = printOptions;
        return { plan: paginateByBranches(activeLayout, bounds, { paper, orientation, marginMm }), error: null };
      }
      return { plan: paginate(bounds, printOptions), error: null };
    } catch (err: unknown) {
      return {
        plan: null,
        error: err instanceof Error ? err.message : 'Impossibile calcolare l\'impaginazione.',
      };
    }
  }, [bounds, printOptions, fitMode, activeLayout]);

  // Testo di riepilogo
  const summaryText = useMemo(() => {
    if (!plan) return null;
    const pageCount = plan.pages.length;
    const isPortrait = plan.orientation === 'portrait';
    const orientWord = pageCount === 1 ? (isPortrait ? 'verticale' : 'orizzontale') : (isPortrait ? 'verticali' : 'orizzontali');
    const scaleFormatted = Math.round(plan.scale * 100);

    if (plan.paper === 'custom') {
      return `1 pagina su misura ${formatMm(plan.pageWidthMm)} × ${formatMm(plan.pageHeightMm)} mm, scala ${scaleFormatted}%`;
    }
    if (fitMode === 'branches' && pageCount > 1) {
      return `${pageCount} pagine ${plan.paper} ${orientWord}, a capo tra i rami, scala ${scaleFormatted}%`;
    }
    if (pageCount === 1) {
      return `1 pagina ${plan.paper} ${orientWord}, scala ${scaleFormatted}%`;
    }
    return `${plan.cols} × ${plan.rows} = ${pageCount} pagine ${plan.paper} ${orientWord}, scala ${scaleFormatted}%`;
  }, [plan, fitMode]);

  // Cleanup all'unmount
  useEffect(() => {
    return () => {
      document.getElementById('print-root')?.remove();
      document.getElementById('print-page-style')?.remove();
    };
  }, []);

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

      if (currentPlan.headerMm > 0) {
        const { left, right } = pageHeaderText(page, currentPlan.pages.length);
        const headerDiv = document.createElement('div');
        headerDiv.style.height = `${currentPlan.headerMm}mm`;
        headerDiv.style.boxSizing = 'border-box';
        headerDiv.style.display = 'flex';
        headerDiv.style.alignItems = 'flex-start';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.gap = '4mm';
        headerDiv.style.fontSize = '8pt';
        headerDiv.style.color = '#666666';
        headerDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        const leftEl = document.createElement('span');
        leftEl.style.overflow = 'hidden';
        leftEl.style.textOverflow = 'ellipsis';
        leftEl.style.whiteSpace = 'nowrap';
        leftEl.textContent = left;
        const rightEl = document.createElement('span');
        rightEl.textContent = right;
        headerDiv.append(leftEl, rightEl);
        pageDiv.appendChild(headerDiv);
      }

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', `${page.world.w * currentPlan.scale}px`);
      svg.setAttribute('height', `${page.world.h * currentPlan.scale}px`);
      svg.setAttribute('viewBox', `${page.world.x} ${page.world.y} ${page.world.w} ${page.world.h}`);
      svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      svg.style.display = 'block';
      svg.style.overflow = 'hidden';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = contentHtml;
      svg.appendChild(g);
      pageDiv.appendChild(svg);

      if (currentPlan.pages.length > 1 && currentPlan.headerMm === 0) {
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
    styleEl.textContent =
      currentPlan.paper === 'custom'
        ? `@page { size: ${currentPlan.pageWidthMm}mm ${currentPlan.pageHeightMm}mm; margin: 0; }`
        : `@page { size: ${currentPlan.paper} ${currentPlan.orientation}; margin: 0; }`;
    document.head.appendChild(styleEl);

    // Il tema chiaro su carta lo garantiscono le variabili di #print-root (index.css).
    return () => {
      document.getElementById('print-root')?.remove();
      document.getElementById('print-page-style')?.remove();
    };
  };

  const handlePrint = () => {
    if (!plan) return;
    const cleanup = preparePrintDom(plan, captureContent() || svgContent);
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
    const cleanup = preparePrintDom(plan, captureContent() || svgContent);
    try {
      const bytesArray = await window.electronAPI.printToPdf({
        pageSize:
          plan.paper === 'custom' ? { widthMm: plan.pageWidthMm, heightMm: plan.pageHeightMm } : plan.paper,
        landscape: plan.orientation === 'landscape',
      });
      const bytes = new Uint8Array(bytesArray);
      const saved = await saveBytes(bytes, `${suggestedBase}.pdf`, 'application/pdf', {
        description: 'Documento PDF',
        extensions: ['pdf'],
      });
      if (saved) onDone();
    } catch (err: unknown) {
      setPdfError(err instanceof Error ? err.message : 'Errore durante il salvataggio del PDF.');
    } finally {
      cleanup();
      setIsPdfSaving(false);
    }
  };

  const savePdfLabel = 'Salva PDF…';

  const actionRow = (
    <div className="flex w-full items-center justify-end gap-2 flex-wrap">
      {isElectronPdfAvailable && (
        <Button
          variant={mode === 'pdf' ? 'default' : 'outline'}
          icon={<FileDown className="size-4" />}
          loading={isPdfSaving}
          disabled={!plan || Boolean(error)}
          onClick={handleSavePdf}
        >
          {savePdfLabel}
        </Button>
      )}
      {(mode === 'print' || !isElectronPdfAvailable) && (
        <Button
          variant="default"
          icon={mode === 'print' ? <Printer className="size-4" /> : <FileDown className="size-4" />}
          disabled={!plan || Boolean(error) || isPdfSaving}
          onClick={handlePrint}
        >
          {mode === 'print' ? (isElectronPdfAvailable ? 'Stampa' : 'Stampa o salva PDF…') : savePdfLabel}
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 max-w-full">
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
        {plan && fitMode === 'branches' && plan.scale < MIN_LEGIBLE_SCALE && (
          <Banner variant="warning" title="Testo piccolo">
            La mappa è molto larga per questo foglio: il testo risulta ridotto. Prova l'orientamento orizzontale o A3.
          </Banner>
        )}
        {plan && fitMode === 'map-size' && plan.scale < 1 && (
          <Banner variant="warning" title="Mappa ridotta">
            La mappa supera la dimensione massima di una pagina PDF ed è stata rimpicciolita.
          </Banner>
        )}
        {!isElectronPdfAvailable && (
          <p className="text-xs text-muted-foreground">
            Per ottenere un PDF scegli «Salva come PDF» come stampante nel dialogo di stampa del browser.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">
          {/* Colonna opzioni */}
          <div className="flex flex-col gap-3.5">
            <Field label="Adattamento">
              <Select
                size="sm"
                options={FIT_OPTIONS}
                value={fitMode}
                onValueChange={(next) => {
                  setFitMode(next);
                  if (next === 'branches') setCompact(true);
                }}
              />
            </Field>

            {fitMode !== 'map-size' && (
              <>
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
              </>
            )}

            {!screenIsCompact && (
              <Field label="Struttura">
                <SegmentedControl
                  size="sm"
                  items={STRUCTURE_ITEMS}
                  activeId={compact ? 'compact' : 'screen'}
                  onChange={(id) => setCompact(id === 'compact')}
                />
              </Field>
            )}

            {fitMode === 'fit-width' && (
              <Field label="Pagine in larghezza">
                <Select
                  size="sm"
                  options={PAGES_WIDE_OPTIONS}
                  value={pagesWide}
                  onValueChange={setPagesWide}
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

            {fitMode !== 'map-size' && (
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

                {fitMode !== 'branches' && (
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
                )}
              </div>
            )}
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
                    gridTemplateColumns:
                      plan.cols === 1 && plan.pages.length > 1
                        ? `repeat(${Math.min(plan.pages.length, plan.orientation === 'landscape' ? 2 : 3)}, minmax(0, 1fr))`
                        : `repeat(${plan.cols}, minmax(0, 1fr))`,
                  }}
                >
                  {plan.pages.map((p) => {
                    const { left, right } = pageHeaderText(p, plan.pages.length);
                    return (
                      <div
                        key={p.index}
                        className="bg-white border border-border/80 shadow-xs rounded-sm relative overflow-hidden"
                        style={{
                          aspectRatio: `${plan.pageWidthMm} / ${plan.pageHeightMm}`,
                          minWidth: Math.min(140, Math.max(50, Math.floor(320 / plan.cols))),
                          padding: `${(plan.marginMm / plan.pageWidthMm) * 100}%`,
                        }}
                      >
                        {plan.headerMm > 0 && (
                          <div
                            className="flex items-start justify-between gap-1 text-[5px] leading-none text-muted-foreground select-none"
                            style={{ aspectRatio: `${plan.pageWidthMm - 2 * plan.marginMm} / ${plan.headerMm}` }}
                          >
                            <span className="truncate">{left}</span>
                            <span className="shrink-0">{right}</span>
                          </div>
                        )}
                        <svg
                          viewBox={`${p.world.x} ${p.world.y} ${p.world.w} ${p.world.h}`}
                          className="w-full block"
                          style={{ aspectRatio: `${p.world.w} / ${p.world.h}` }}
                          preserveAspectRatio="xMinYMin meet"
                        >
                          <g dangerouslySetInnerHTML={{ __html: svgContent }} />
                        </svg>
                        {plan.pages.length > 1 && plan.headerMm === 0 && (
                          <span className="absolute bottom-1 right-1 text-3xs font-mono text-muted-foreground bg-white/90 px-1 py-0.5 rounded border border-border/60 select-none">
                            {p.row + 1},{p.col + 1}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {actionRow}
    </div>
  );
};
