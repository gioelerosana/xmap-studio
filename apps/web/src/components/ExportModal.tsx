import React, { useState } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { Copy, Download, Check } from 'lucide-react';
import { downloadBlob } from '../adapters/fileSystem.js';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  getExportContent: (format: 'markdown' | 'opml' | 'outline') => string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  getExportContent,
}) => {
  const [format, setFormat] = useState<'markdown' | 'opml' | 'outline'>('markdown');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const content = getExportContent(format);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = format === 'markdown' ? 'md' : format === 'opml' ? 'opml' : 'txt';
    const mime =
      format === 'markdown'
        ? 'text/markdown'
        : format === 'opml'
        ? 'text/xml'
        : 'text/plain';
    downloadBlob(new TextEncoder().encode(content), `export.${ext}`, mime);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Esporta Mappa Concettuale"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="flat"
            size="sm"
            icon={copied ? <Check className="w-3.5 h-3.5 text-adw-success" /> : <Copy className="w-3.5 h-3.5" />}
            onClick={handleCopy}
          >
            {copied ? 'Copiato negli Appunti!' : 'Copia'}
          </Button>
          <div className="flex items-center space-x-2">
            <Button variant="flat" size="sm" onClick={onClose}>
              Chiudi
            </Button>
            <Button
              variant="suggested"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={handleDownload}
            >
              Scarica File
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Scelta formato */}
        <div className="flex space-x-2">
          {(['markdown', 'opml', 'outline'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setFormat(fmt)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                format === fmt
                  ? 'border-adw-accent bg-adw-accent/10 text-adw-accent font-semibold'
                  : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'
              }`}
            >
              {fmt === 'markdown' ? 'Markdown (.md)' : fmt === 'opml' ? 'OPML 2.0 (.opml)' : 'Outline Testo (.txt)'}
            </button>
          ))}
        </div>

        {/* Anteprima contenuto generato */}
        <textarea
          readOnly
          value={content}
          rows={14}
          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-adw-cardBorder bg-adw-bg text-adw-fg focus:outline-none resize-none selection:bg-blue-500/20"
        />
      </div>
    </Modal>
  );
};
