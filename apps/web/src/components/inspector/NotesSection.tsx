import React from 'react';
import { FileText } from 'lucide-react';
import { Field, Select, Textarea } from '@xmap/ui-kit';

import { InspectorSection } from './InspectorSection.js';

interface NotesSectionProps {
  notes: string;
  hasNotes: boolean;
  onNotesChange: (value: string) => void;
  onNotesCommit: () => void;
  notesDisplay: 'icon' | 'block' | '';
  onNotesDisplayChange: (value: 'icon' | 'block' | '') => void;
}

export const NotesSection: React.FC<NotesSectionProps> = ({
  notes,
  hasNotes,
  onNotesChange,
  onNotesCommit,
  notesDisplay,
  onNotesDisplayChange,
}) => (
  <InspectorSection
    id="notes"
    title="Note"
    icon={<FileText className="size-3.5" />}
    summary={hasNotes ? '•' : undefined}
  >
    <Textarea
      rows={3}
      value={notes}
      placeholder="Appunti estesi del blocco…"
      onChange={(e) => onNotesChange(e.target.value)}
      onBlur={onNotesCommit}
    />
    <Field label="Visualizzazione in XMind">
      <Select
        size="sm"
        value={notesDisplay}
        onChange={(e) => onNotesDisplayChange(e.target.value as 'icon' | 'block' | '')}
      >
        <option value="">Predefinita (icona)</option>
        <option value="icon">Icona</option>
        <option value="block">Riquadro espanso</option>
      </Select>
    </Field>
  </InspectorSection>
);
