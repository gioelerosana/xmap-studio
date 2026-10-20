import React from 'react';
import { Flag, X } from 'lucide-react';
import { GROUPS, markerDisplayName } from '@xmap/core';
import { cn } from '@xmap/ui-kit';

import { FOCUS_RING, chipClass } from './classes.js';
import { InspectorSection } from './InspectorSection.js';

interface MarkersSectionProps {
  markers: string[];
  onToggle: (markerId: string) => void;
}

export const MarkersSection: React.FC<MarkersSectionProps> = ({ markers, onToggle }) => (
  <InspectorSection
    id="markers"
    title="Marker"
    icon={<Flag className="size-3.5" />}
    summary={markers.length > 0 ? markers.length : undefined}
  >
    {markers.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {markers.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onToggle(m)}
            title="Rimuovi marker"
            className={cn(
              'flex items-center gap-1 rounded-sm bg-primary/8 px-1.5 py-0.5 text-2xs text-primary dark:bg-primary/16',
              FOCUS_RING
            )}
          >
            {markerDisplayName(m)}
            <X className="size-3.5" />
          </button>
        ))}
      </div>
    )}
    <div className="flex max-h-52 flex-col gap-2 overflow-y-auto pr-1">
      {GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-1">
            {group.markers.map((m) => {
              const active = markers.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onToggle(m.id)}
                  aria-pressed={active}
                  title={m.name}
                  className={chipClass(active)}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  </InspectorSection>
);
