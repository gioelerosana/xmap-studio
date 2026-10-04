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
    <Modal isOpen={isOpen} onClose={onClose} title="Esporta Mappa" maxWidth="max-w-xl">
      <div className="space-y-3">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--adw-surface)] border border-[var(--adw-card-border)]">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              className={cn(
                'flex-1 h-7 rounded-md text-xs font-medium transition-colors',
                format === f.id
                  ? 'bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] shadow-[var(--adw-shadow-sm)]'
                  : 'text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <textarea
            readOnly
            value={content}
            className="w-full h-64 p-3 rounded-lg border border-[var(--adw-card-border)] bg-[var(--adw-bg-color)] font-mono text-xs text-[var(--adw-fg-color)] resize-none focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-[var(--adw-muted-color)]">
            Salvataggio nei formati aperti interoperabili con Logseq, Obsidian e Freeplane.
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="flat"
              size="sm"
              icon={copied ? <Check className="w-3.5 h-3.5 text-[var(--adw-success-color)]" /> : <Copy className="w-3.5 h-3.5" />}
              onClick={handleCopy}
            >
              {copied ? 'Copiato' : 'Copia'}
            </Button>
            <Button variant="suggested" size="sm" icon={<Download className="w-3.5 h-3.5" />} onClick={handleDownload}>
              Scarica .{spec.ext}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
