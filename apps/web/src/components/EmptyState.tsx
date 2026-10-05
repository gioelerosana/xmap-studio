import React, { useState } from 'react';
import { Button } from '@xmap/ui-kit';
import { FolderOpen, Plus, FileSpreadsheet, Sigma } from 'lucide-react';

export interface EmptyStateProps {
  onOpenFile: () => void;
  onNewFile: () => void;
  onLoadDemo: () => void;
  onDropFiles: (file: File) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  onOpenFile,
  onNewFile,
  onLoadDemo,
  onDropFiles,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xmind') || file.type.includes('zip'))) {
      onDropFiles(file);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-[var(--adw-bg-color)] select-none">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`w-full max-w-md rounded-xl border border-dashed px-8 py-10 flex flex-col items-center text-center transition-colors ${
          isDragOver
            ? 'border-[var(--adw-accent-color)] bg-[var(--adw-accent-soft)]'
            : 'border-[var(--adw-card-border)] bg-[var(--adw-surface)]'
        }`}
      >
        <div className="w-12 h-12 rounded-xl bg-[var(--adw-accent-soft)] flex items-center justify-center text-[var(--adw-accent-color)] mb-4">
          <Sigma className="w-6 h-6" />
        </div>
        <h1 className="text-base font-semibold tracking-tight">XMap Studio</h1>
        <p className="text-[13px] text-[var(--adw-muted-color)] mt-1.5 mb-6 leading-relaxed">
          Editor di mappe XMind con equazioni LaTeX native. Lossless, offline, senza account.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="suggested" icon={<FolderOpen className="w-4 h-4" />} onClick={onOpenFile}>
            Apri mappa
          </Button>
          <Button variant="default" icon={<Plus className="w-4 h-4" />} onClick={onNewFile}>
            Nuova
          </Button>
          <Button variant="flat" icon={<FileSpreadsheet className="w-4 h-4" />} onClick={onLoadDemo}>
            Demo
          </Button>
        </div>

        <p className="mt-6 text-[11px] text-[var(--adw-muted-color)]">
          Trascina qui un file <b>.xmind</b> per aprirlo.
        </p>
      </div>
    </div>
  );
};
