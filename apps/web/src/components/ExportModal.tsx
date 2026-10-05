import React, { useState } from 'react';
import { Modal, Button, cn } from '@xmap/ui-kit';
import { Copy, Download, Check } from 'lucide-react';
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
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="flat"
            size="sm"
            icon={copied ? <Check className="w-3.5 h-3.5 text-[var(--adw-success-color)]" /> : <Copy className="w-3.5 h-3.5" />}
            onClick={handleCopy}
          >
            {copied ? 'Copiato' : 'Copia'}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="flat" size="sm" onClick={onClose}>
              Chiudi
            </Button>
            <Button variant="suggested" size="sm" icon={<Download className="w-3.5 h-3.5" />} onClick={handleDownload}>
              Salva file
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-1">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              className={cn(
                'px-3 h-7 rounded-md text-xs border transition-colors',
                format === f.id
                  ? 'border-[var(--adw-accent-color)] bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)] font-medium'
                  : 'border-[var(--adw-card-border)] text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <textarea
          readOnly
          value={content}
          rows={14}
          className="w-full px-3 py-2 text-xs font-mono rounded-md border border-[var(--adw-card-border)] bg-[var(--adw-surface)] text-[var(--adw-fg-color)] focus:outline-none resize-none"
        />
      </div>
    </Modal>
  );
};
