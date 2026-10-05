import React, { useState } from 'react';
import { Modal, Button, cn } from '@xmap/ui-kit';
import { Upload } from 'lucide-react';
import { pickAnyFile } from '../adapters/fileSystem.js';

type ImportFormat = 'markdown' | 'opml';

export interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (format: ImportFormat, text: string, asNewSheet: boolean) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [format, setFormat] = useState<ImportFormat>('markdown');
  const [text, setText] = useState('');
  const [asNewSheet, setAsNewSheet] = useState(true);

  if (!isOpen) return null;

  const handleFile = async () => {
    const picked = await pickAnyFile({ description: 'Markdown o OPML', extensions: ['md', 'markdown', 'txt', 'opml', 'xml'] });
    if (!picked) return;
    setText(new TextDecoder().decode(picked.bytes));
    if (picked.name.endsWith('.opml') || picked.name.endsWith('.xml')) setFormat('opml');
    else setFormat('markdown');
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
      title="Importa outline"
      description="Il contenuto viene aggiunto come nuovo foglio della mappa aperta."
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none text-[var(--adw-muted-color)]">
            <input
              type="checkbox"
              checked={asNewSheet}
              onChange={(e) => setAsNewSheet(e.target.checked)}
              className="rounded"
            />
            Importa in un nuovo foglio
          </label>
          <div className="flex items-center gap-2">
            <Button variant="flat" size="sm" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="suggested" size="sm" disabled={!text.trim()} onClick={handleSubmit}>
              Importa
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {(['markdown', 'opml'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setFormat(fmt)}
                className={cn(
                  'px-3 h-7 rounded-md text-xs border transition-colors',
                  format === fmt
                    ? 'border-[var(--adw-accent-color)] bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)] font-medium'
                    : 'border-[var(--adw-card-border)] text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
                )}
              >
                {fmt === 'markdown' ? 'Markdown' : 'OPML'}
              </button>
            ))}
          </div>

          <Button variant="flat" size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={handleFile}>
            Carica file…
          </Button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            format === 'markdown'
              ? '# Argomento principale\n- Sotto-argomento\n  - Dettaglio $\\int x\\,dx$'
              : '<opml version="2.0">…'
          }
          rows={12}
          className="w-full px-3 py-2 text-xs font-mono rounded-md border border-[var(--adw-card-border)] bg-[var(--adw-surface)] text-[var(--adw-fg-color)] focus:outline-none resize-none"
        />
      </div>
    </Modal>
  );
};
