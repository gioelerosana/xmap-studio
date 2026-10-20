import React, { useState } from 'react';
import { Modal, Button, Checkbox, Field, SegmentedControl, Textarea } from '@xmap/ui-kit';
import { Upload } from 'lucide-react';
import { pickAnyFile } from '../adapters/fileSystem.js';

type ImportFormat = 'markdown' | 'opml';

export interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (format: ImportFormat, text: string, asNewSheet: boolean) => void;
}

const FORMAT_ITEMS: { id: ImportFormat; label: string }[] = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'opml', label: 'OPML' },
];

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [format, setFormat] = useState<ImportFormat>('markdown');
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string>();
  const [asNewSheet, setAsNewSheet] = useState(true);

  if (!isOpen) return null;

  const handleFile = async () => {
    setFileError(undefined);
    try {
      const picked = await pickAnyFile({ description: 'Markdown o OPML', extensions: ['md', 'markdown', 'txt', 'opml', 'xml'] });
      if (!picked) return;
      setText(new TextDecoder().decode(picked.bytes));
      if (picked.name.endsWith('.opml') || picked.name.endsWith('.xml')) setFormat('opml');
      else setFormat('markdown');
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    }
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
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Checkbox checked={asNewSheet} onCheckedChange={setAsNewSheet} label="Importa in un nuovo foglio" />
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="default" disabled={!text.trim()} onClick={handleSubmit}>
              Importa
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SegmentedControl items={FORMAT_ITEMS} activeId={format} onChange={setFormat} />
          <Button variant="ghost" icon={<Upload className="size-4" />} onClick={handleFile}>
            Carica file…
          </Button>
        </div>

        {fileError && (
          <p role="alert" className="text-xs text-error-foreground">
            {fileError}
          </p>
        )}

        <Field label="Contenuto">
          <Textarea
            mono
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              format === 'markdown'
                ? '# Argomento principale\n- Sotto-argomento\n  - Dettaglio $\\int x\\,dx$'
                : '<opml version="2.0">…'
            }
            rows={12}
            className="resize-none text-xs"
          />
        </Field>
      </div>
    </Modal>
  );
};
