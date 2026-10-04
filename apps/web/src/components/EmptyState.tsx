import React, { useState } from 'react';
import { Button } from '@xmap/ui-kit';
import { FolderOpen, Plus, FileSpreadsheet, Sparkles, ShieldCheck } from 'lucide-react';

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xmind') || file.type.includes('zip'))) {
      onDropFiles(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-adw-bg select-none">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full max-w-xl p-10 rounded-3xl border-2 border-dashed flex flex-col items-center text-center transition-all ${
          isDragOver
            ? 'border-adw-accent bg-adw-accent/5 scale-[1.02]'
            : 'border-adw-cardBorder bg-adw-card shadow-sm hover:border-adw-accent/40'
        }`}
      >
        <div className="w-16 h-16 rounded-2xl bg-adw-accent/10 flex items-center justify-center text-adw-accent mb-5">
          <Sparkles className="w-8 h-8" />
        </div>

        <h1 className="text-xl font-bold tracking-tight mb-2">
          Benvenuto in XMap Studio
        </h1>
        <p className="text-sm opacity-60 max-w-md mb-8">
          Editor concettuale professionale con supporto nativo XMind, formule matematiche LaTeX/MathJax e architettura lossless garantita.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="suggested"
            size="md"
            icon={<FolderOpen className="w-4 h-4" />}
            onClick={onOpenFile}
          >
            Apri Mappa .xmind
          </Button>

          <Button
            variant="default"
            size="md"
            icon={<Plus className="w-4 h-4" />}
            onClick={onNewFile}
          >
            Nuova Mappa
          </Button>

          <Button
            variant="flat"
            size="md"
            icon={<FileSpreadsheet className="w-4 h-4 text-adw-accent" />}
            onClick={onLoadDemo}
          >
            Carica Mappa Demo
          </Button>
        </div>

        <div className="mt-8 pt-6 border-t border-adw-cardBorder w-full flex items-center justify-center text-xs opacity-50 space-x-2">
          <ShieldCheck className="w-4 h-4 text-adw-success" />
          <span>Trascina qui qualsiasi file <b>.xmind</b> per aprirlo istantaneamente</span>
        </div>
      </div>
    </div>
  );
};
