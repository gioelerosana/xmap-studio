import React, { useState } from 'react';
import { Modal, Button, SegmentedControl, Textarea } from '@xmap/ui-kit';
import { Check, Copy, Download } from 'lucide-react';
import { saveBytes } from '../adapters/fileSystem.js';

type ExportFormat = 'markdown' | 'opml' | 'outline';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  getExportContent: (format: ExportFormat) => string;
  suggestedBase?: string;
}

const FORMATS: { id: ExportFormat; label: string; ext: string; mime: string }[] = [
  { id: 'markdown', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'opml', label: 'OPML', ext: 'opml', mime: 'text/xml' },
  { id: 'outline', label: 'Testo', ext: 'txt', mime: 'text/plain' },
];

const FORMAT_ITEMS = FORMATS.map(({ id, label }) => ({ id, label }));

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  getExportContent,
  suggestedBase = 'mappa',
}) => {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const content = getExportContent(format);
  const spec = FORMATS.find((f) => f.id === format)!;

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Esporta mappa"
      size="md"
      footer={
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
      }
    >
      <div className="flex flex-col items-start gap-3">
        <SegmentedControl items={FORMAT_ITEMS} activeId={format} onChange={setFormat} />

        <Textarea mono readOnly value={content} className="h-64 resize-none text-xs" />

        <p className="text-2xs text-muted-foreground">
          Salvataggio nei formati aperti interoperabili con Logseq, Obsidian e Freeplane.
        </p>
      </div>
    </Modal>
  );
};
