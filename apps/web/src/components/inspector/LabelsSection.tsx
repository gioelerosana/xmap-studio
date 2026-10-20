import React from 'react';
import { Link2, Tag } from 'lucide-react';
import { Field, Input } from '@xmap/ui-kit';

import { InspectorSection } from './InspectorSection.js';

interface LabelsSectionProps {
  labelCount: number;
  labelsStr: string;
  onLabelsChange: (value: string) => void;
  onLabelsCommit: () => void;
  hasHref: boolean;
  href: string;
  onHrefChange: (value: string) => void;
  onHrefCommit: () => void;
}

export const LabelsSection: React.FC<LabelsSectionProps> = ({
  labelCount,
  labelsStr,
  onLabelsChange,
  onLabelsCommit,
  hasHref,
  href,
  onHrefChange,
  onHrefCommit,
}) => (
  <InspectorSection
    id="labels"
    title="Etichette e link"
    icon={<Tag className="size-3.5" />}
    summary={
      labelCount > 0 || hasHref ? (
        <span className="flex items-center gap-1">
          {labelCount > 0 && <span>{labelCount}</span>}
          {hasHref && <Link2 className="size-3" />}
        </span>
      ) : undefined
    }
  >
    <Field label="Etichette (separate da virgola)">
      <Input
        value={labelsStr}
        placeholder="Importante, Revisione"
        onChange={(e) => onLabelsChange(e.target.value)}
        onBlur={onLabelsCommit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </Field>
    <Field label="Link (URL, mailto:, file: o #id)">
      <Input
        value={href}
        placeholder="https://…"
        onChange={(e) => onHrefChange(e.target.value)}
        onBlur={onHrefCommit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </Field>
  </InspectorSection>
);
