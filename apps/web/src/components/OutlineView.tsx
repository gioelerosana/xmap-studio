import React from 'react';
import { Card, EmptyHint } from '@xmap/ui-kit';
import { ListTree } from 'lucide-react';

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
      <div className="flex-1 flex items-center justify-center bg-background">
        <EmptyHint icon={<ListTree className="size-4" />} title="Nessun contenuto da mostrare." />
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <Card className="p-4">
          <pre className="font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">{text}</pre>
        </Card>
      </div>
    </div>
  );
};
