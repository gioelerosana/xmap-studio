import React, { useEffect, useState } from 'react';
import { Modal, Button, SegmentedControl, Textarea, Field, cn } from '@xmap/ui-kit';
import {
  Check,
  Copy,
  Download,
  FileDown,
  FileText,
  FileType,
  Image as ImageIcon,
  List,
  Save,
  Sigma,
  type LucideIcon,
} from 'lucide-react';
import type { Layout } from '@xmap/core';
import { saveBytes } from '../adapters/fileSystem.js';
import { ImageExportPanel } from './ImageExportPanel.js';
import { PrintPanel } from './PrintPanel.js';

type TextFormat = 'markdown' | 'opml' | 'outline';
export type ExportFormatId = 'xmind' | TextFormat | 'png' | 'svg' | 'pdf' | 'equation';

export interface ExportScope {
  sheetIndex?: number;
  topicId?: string;
}

/** Blocco selezionato, quanto basta per offrire «Ramo selezionato» e l'export dell'equazione. */
export interface ExportSelection {
  id: string;
  title: string;
  isEquation: boolean;
}

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  getExportContent: (format: TextFormat, scope: ExportScope) => string;
  layout: Layout | null;
  /** Layout ad albero compatto per il PDF (uguale a `layout` se lo schermo è già ad albero). */
  compactLayout: Layout | null;
  screenIsCompact: boolean;
  resourceResolver: (src: string) => Uint8Array | null;
  sheetCount: number;
  activeSheetIndex: number;
  selection: ExportSelection | null;
  onSaveAs: () => void;
  onExportEquation: (format: 'svg' | 'png') => void;
  onImageSaved: (message: string) => void;
  suggestedBase?: string;
}

interface FormatEntry {
  id: ExportFormatId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const FORMATS: FormatEntry[] = [
  { id: 'xmind', label: 'XMind', hint: 'File .xmind, salvataggio sicuro con backup', icon: Save },
  { id: 'markdown', label: 'Markdown', hint: 'Logseq, Obsidian, Freeplane', icon: FileText },
  { id: 'opml', label: 'OPML', hint: 'Outliner e altre app di mappe', icon: List },
  { id: 'outline', label: 'Testo', hint: 'Elenco puntato semplice', icon: FileType },
  { id: 'png', label: 'Immagine PNG', hint: 'Raster, risoluzione a scelta', icon: ImageIcon },
  { id: 'svg', label: 'Immagine SVG', hint: 'Vettoriale', icon: ImageIcon },
  { id: 'pdf', label: 'PDF', hint: 'Per rami, su A4/A3 o su misura', icon: FileDown },
  { id: 'equation', label: 'Equazione', hint: 'Il blocco selezionato, SVG o PNG', icon: Sigma },
];

const TEXT_SPEC: Record<TextFormat, { label: string; ext: string; mime: string }> = {
  markdown: { label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  opml: { label: 'OPML', ext: 'opml', mime: 'text/xml' },
  outline: { label: 'Testo', ext: 'txt', mime: 'text/plain' },
};

type ScopeKind = 'all' | 'sheet' | 'branch';

const isTextFormat = (id: ExportFormatId): id is TextFormat => id === 'markdown' || id === 'opml' || id === 'outline';

const TextPanel: React.FC<{
  format: TextFormat;
  getExportContent: ExportModalProps['getExportContent'];
  sheetCount: number;
  activeSheetIndex: number;
  selection: ExportSelection | null;
  suggestedBase: string;
}> = ({ format, getExportContent, sheetCount, activeSheetIndex, selection, suggestedBase }) => {
  const [scopeKind, setScopeKind] = useState<ScopeKind>('all');
  const [copied, setCopied] = useState(false);
  const spec = TEXT_SPEC[format];

  // Una scelta non più valida (ramo deselezionato) torna a «tutta la mappa».
  const effectiveKind: ScopeKind = scopeKind === 'branch' && !selection ? 'all' : scopeKind;
  const scope: ExportScope =
    effectiveKind === 'branch' && selection
      ? { topicId: selection.id }
      : effectiveKind === 'sheet'
        ? { sheetIndex: activeSheetIndex }
        : {};

  const content = getExportContent(format, scope);

  const scopeItems: { id: ScopeKind; label: string; disabled?: boolean }[] = [
    { id: 'all', label: sheetCount > 1 ? 'Tutti i fogli' : 'Tutta la mappa' },
    ...(sheetCount > 1 ? [{ id: 'sheet' as const, label: 'Foglio attivo' }] : []),
    { id: 'branch', label: 'Ramo selezionato', disabled: !selection },
  ];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    await saveBytes(new TextEncoder().encode(content), `${suggestedBase}.${spec.ext}`, spec.mime, {
      description: spec.label,
      extensions: [spec.ext],
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Cosa esportare" hint={selection ? undefined : 'Seleziona un blocco per esportare solo il suo ramo'}>
        <SegmentedControl items={scopeItems} activeId={effectiveKind} onChange={setScopeKind} />
      </Field>
      <Textarea mono readOnly value={content} className="h-56 resize-none text-xs" />
      <div className="flex w-full items-center justify-end gap-2">
        <Button
          variant="outline"
          icon={copied ? <Check className="size-4 text-success-foreground" /> : <Copy className="size-4" />}
          onClick={handleCopy}
        >
          {copied ? 'Copiato' : 'Copia'}
        </Button>
        <Button variant="default" icon={<Download className="size-4" />} onClick={handleDownload}>
          Scarica .{spec.ext}
        </Button>
      </div>
    </div>
  );
};

const XmindPanel: React.FC<{ onSaveAs: () => void; onClose: () => void }> = ({ onSaveAs, onClose }) => (
  <div className="flex flex-col gap-4">
    <p className="text-sm text-muted-foreground">
      Salva la mappa in un nuovo file <code>.xmind</code>, con il nome e la cartella che scegli. Il file viene
      controllato prima di scrivere e lascia un backup; da quel momento lavori sul nuovo file.
    </p>
    <div className="flex w-full items-center justify-end gap-2">
      <Button
        variant="default"
        icon={<Save className="size-4" />}
        onClick={() => {
          onClose();
          onSaveAs();
        }}
      >
        Salva con nome…
      </Button>
    </div>
  </div>
);

const EquationPanel: React.FC<{
  selection: ExportSelection | null;
  onExportEquation: ExportModalProps['onExportEquation'];
  onClose: () => void;
}> = ({ selection, onExportEquation, onClose }) => {
  const ready = selection?.isEquation === true;
  const run = (format: 'svg' | 'png') => {
    onClose();
    onExportEquation(format);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {ready
          ? 'Esporta la formula del blocco selezionato, resa come immagine.'
          : 'Seleziona sulla mappa un blocco con una formula per esportarla come immagine.'}
      </p>
      <div className="flex w-full items-center justify-end gap-2">
        <Button variant="outline" icon={<Download className="size-4" />} disabled={!ready} onClick={() => run('svg')}>
          Salva SVG
        </Button>
        <Button variant="default" icon={<Download className="size-4" />} disabled={!ready} onClick={() => run('png')}>
          Salva PNG
        </Button>
      </div>
    </div>
  );
};

/** Unica finestra «Esporta»: formato a sinistra, opzioni e azioni del formato scelto a destra. */
export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  getExportContent,
  layout,
  compactLayout,
  screenIsCompact,
  resourceResolver,
  sheetCount,
  activeSheetIndex,
  selection,
  onSaveAs,
  onExportEquation,
  onImageSaved,
  suggestedBase = 'mappa',
}) => {
  const [format, setFormat] = useState<ExportFormatId>('markdown');

  // Alla riapertura si riparte da un formato sempre disponibile.
  useEffect(() => {
    if (isOpen && format === 'equation' && !selection?.isEquation) setFormat('markdown');
  }, [isOpen, format, selection]);

  if (!isOpen) return null;

  const current = FORMATS.find((f) => f.id === format) ?? FORMATS[0];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Esporta" size="xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
        <nav aria-label="Formato di esportazione" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {FORMATS.map((f) => {
            const Icon = f.icon;
            const active = f.id === format;
            return (
              <button
                key={f.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => setFormat(f.id)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{f.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="flex min-w-0 flex-col gap-4" aria-label={current.label}>
          <p className="text-xs text-muted-foreground">{current.hint}</p>
          {isTextFormat(format) && (
            <TextPanel
              key={format}
              format={format}
              getExportContent={getExportContent}
              sheetCount={sheetCount}
              activeSheetIndex={activeSheetIndex}
              selection={selection}
              suggestedBase={suggestedBase}
            />
          )}
          {format === 'xmind' && <XmindPanel onSaveAs={onSaveAs} onClose={onClose} />}
          {(format === 'png' || format === 'svg') && (
            <ImageExportPanel
              key={format}
              format={format}
              layout={layout}
              suggestedBase={suggestedBase}
              onSaved={onImageSaved}
              onDone={onClose}
            />
          )}
          {format === 'pdf' && (
            <PrintPanel
              mode="pdf"
              onDone={onClose}
              layout={layout}
              compactLayout={compactLayout}
              screenIsCompact={screenIsCompact}
              resourceResolver={resourceResolver}
              suggestedBase={suggestedBase}
            />
          )}
          {format === 'equation' && (
            <EquationPanel selection={selection} onExportEquation={onExportEquation} onClose={onClose} />
          )}
        </section>
      </div>
    </Modal>
  );
};
