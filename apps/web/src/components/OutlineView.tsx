import React from 'react';

export interface OutlineViewProps {
  text: string;
}

/**
 * Vista outliner in sola lettura: una resa testuale dell'albero, utile per
 * rileggere o copiare la mappa senza passare dall'export.
 */
export const OutlineView: React.FC<OutlineViewProps> = ({ text }) => {
  if (!text.trim()) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-sm text-[var(--adw-muted-color)]">
        Nessun contenuto da mostrare.
      </div>
    );
  }
  return (
    <div className="flex-1 h-full overflow-y-auto">
      <pre className="max-w-3xl mx-auto px-8 py-6 text-[13px] leading-relaxed font-mono whitespace-pre-wrap text-[var(--adw-fg-color)]">
        {text}
      </pre>
    </div>
  );
};
