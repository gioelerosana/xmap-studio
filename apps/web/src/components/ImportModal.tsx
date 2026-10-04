import React, { useState } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { Upload } from 'lucide-react';

export interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (format: 'markdown' | 'opml', text: string, asNewSheet: boolean) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [format, setFormat] = useState<'markdown' | 'opml'>('markdown');
  const [text, setText] = useState('');
  const [asNewSheet, setAsNewSheet] = useState(false);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(reader.result as string);
      if (file.name.endsWith('.opml') || file.name.endsWith('.xml')) {
        setFormat('opml');
      } else {
        setFormat('markdown');
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (!text.trim()) return;
    onImport(format, text.trim(), asNewSheet);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Importa Outline (Markdown o OPML)"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <label className="flex items-center space-x-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={asNewSheet}
              onChange={(e) => setAsNewSheet(e.target.checked)}
              className="rounded text-adw-accent focus:ring-adw-accent"
            />
            <span className="opacity-80">Importa in un nuovo Foglio</span>
          </label>
          <div className="flex items-center space-x-2">
            <Button variant="flat" size="sm" onClick={onClose}>
              Annulla
            </Button>
            <Button
              variant="suggested"
              size="sm"
              disabled={!text.trim()}
              onClick={handleSubmit}
            >
              Importa nella Mappa
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {/* Scelta formato */}
          <div className="flex space-x-2">
            {(['markdown', 'opml'] as const).map((fmt) => (
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
                {fmt === 'markdown' ? 'Markdown (.md)' : 'OPML (.opml)'}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-medium transition-all">
            <Upload className="w-3.5 h-3.5 text-adw-accent" />
            <span>Carica da File...</span>
            <input
              type="file"
              accept=".md,.markdown,.txt,.opml,.xml"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            format === 'markdown'
              ? '# Argomento Principale\n\n- Sotto-argomento 1\n  - Dettaglio 1.1\n- Sotto-argomento 2 $\\int x dx$'
              : '<opml version="2.0">...'
          }
          rows={12}
          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-adw-cardBorder bg-adw-bg text-adw-fg focus:outline-none resize-none selection:bg-blue-500/20"
        />
      </div>
    </Modal>
  );
};
