import React from 'react';
import { Palette } from 'lucide-react';
import { cn } from '@xmap/ui-kit';

import { BRANCH_COLORS } from './constants.js';
import { FOCUS_RING, chipClass, swatchHairline, swatchSelected } from './classes.js';
import { InspectorSection } from './InspectorSection.js';

interface BranchColorSectionProps {
  color: string | null;
  onColorChange: (value: string | null) => void;
}

export const BranchColorSection: React.FC<BranchColorSectionProps> = ({ color, onColorChange }) => (
  <InspectorSection
    id="branch-color"
    title="Colore del ramo"
    icon={<Palette className="size-3.5" />}
    summary={
      color ? (
        <span className={cn('size-3 rounded-full', swatchHairline)} style={{ backgroundColor: color }} />
      ) : undefined
    }
  >
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={!color}
        onClick={() => onColorChange(null)}
        className={cn(chipClass(!color), 'flex h-6 items-center px-2')}
      >
        Nessuno
      </button>
      {BRANCH_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colore ${c}`}
          aria-pressed={color === c}
          onClick={() => onColorChange(c)}
          className={cn(
            'size-5 rounded-full',
            FOCUS_RING,
            color === c ? swatchSelected : swatchHairline
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  </InspectorSection>
);
