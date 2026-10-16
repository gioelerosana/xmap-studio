import React, { useState } from 'react';
import { Button, Shortcut } from '@xmap/ui-kit';
import { FileCheck, FileSpreadsheet, FileUp, FolderOpen, Plus, ShieldCheck, Sigma } from 'lucide-react';
import { AppMark } from './AppMark.js';

export interface EmptyStateProps {
  onOpenFile: () => void;
  onNewFile: () => void;
  onLoadDemo: () => void;
  onDropFiles: (file: File) => void;
}

// Punti a 16px che svaniscono verso i bordi: il fondo resta quieto attorno al contenuto.
const dotGridStyle: React.CSSProperties = {
  backgroundImage: 'radial-gradient(var(--map-grid-dot) 1px, transparent 1px)',
  backgroundSize: '16px 16px',
  WebkitMaskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
  maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
};

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
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        // dragleave scatta anche entrando nei figli: esce solo se il cursore lascia l'area.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
      }}
      onDrop={handleDrop}
      className="relative flex flex-1 overflow-y-auto overflow-x-hidden bg-background p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground select-none"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={dotGridStyle} />

      <div className="relative m-auto flex w-full max-w-md flex-col items-center text-center">
        <AppMark size={48} />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">XMap Studio</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Editor di mappe XMind con equazioni LaTeX native. Lossless, offline, senza account.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="default" size="lg" icon={<FolderOpen className="size-4" />} onClick={onOpenFile}>
            Apri mappa…
          </Button>
          <Shortcut keys="Ctrl+O" className="coarse:hidden" />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" icon={<Plus className="size-4" />} onClick={onNewFile}>
            Nuova mappa
          </Button>
          <Button variant="ghost" icon={<FileSpreadsheet className="size-4" />} onClick={onLoadDemo}>
            Demo
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">Oppure trascina qui un file .xmind</p>

        <ul className="mt-10 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t pt-6 text-2xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Sigma className="size-3.5" />
            LaTeX nativo
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            Salvataggio sicuro
          </li>
          <li className="flex items-center gap-1.5">
            <FileCheck className="size-3.5" />
            Compatibile XMind
          </li>
        </ul>
      </div>

      {isDragOver && (
        <div className="pointer-events-none absolute inset-4 z-10 flex animate-fade-in items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/8">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileUp className="size-4 text-primary" />
            Rilascia per aprire il file .xmind
          </p>
        </div>
      )}
    </div>
  );
};
