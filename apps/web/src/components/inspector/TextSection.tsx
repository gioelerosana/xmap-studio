import React from 'react';
import { Bold, FileText, Italic, Strikethrough, Underline } from 'lucide-react';
import type { AppController, TextStyle, TopicView } from '@xmap/core';
import { IconButton, Input } from '@xmap/ui-kit';

import { BRANCH_COLORS } from './constants.js';
import { ColorPopover } from './ColorPopover.js';
import { InspectorSection } from './InspectorSection.js';

export type TextStylePatch = Parameters<AppController['setTopicTextStyle']>[1];

interface TextSectionProps {
  topic: TopicView;
  title: string;
  onTitleChange: (value: string) => void;
  onTitleCommit: () => void;
  textStyle: TextStyle;
  onTextStyle: (patch: TextStylePatch) => void;
}

// Testo del blocco: titolo, stile e colore su due righe.
export const TextSection: React.FC<TextSectionProps> = ({
  topic: t,
  title,
  onTitleChange,
  onTitleCommit,
  textStyle: ts,
  onTextStyle,
}) => {
  const textStyleItems: { label: string; icon: React.ReactNode; active: boolean; patch: TextStylePatch }[] = [
    { label: 'Grassetto', icon: <Bold className="size-4" />, active: !!ts.bold, patch: { bold: !ts.bold } },
    { label: 'Corsivo', icon: <Italic className="size-4" />, active: !!ts.italic, patch: { italic: !ts.italic } },
    {
      label: 'Sottolineato',
      icon: <Underline className="size-4" />,
      active: !!ts.underline,
      patch: { underline: !ts.underline },
    },
    {
      label: 'Barrato',
      icon: <Strikethrough className="size-4" />,
      active: !!ts.strikethrough,
      patch: { strikethrough: !ts.strikethrough },
    },
  ];

  return (
    <InspectorSection id="text" title="Testo" icon={<FileText className="size-3.5" />} defaultOpen>
      <Input
        size="sm"
        aria-label="Titolo del blocco"
        value={title}
        placeholder="Titolo…"
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleCommit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {t.kind === 'text' && (
        <>
          <div className="flex items-center gap-1">
            {textStyleItems.map((item) => (
              <IconButton
                key={item.label}
                size="sm"
                variant="outline"
                label={item.label}
                aria-pressed={item.active}
                active={item.active}
                onClick={() => onTextStyle(item.patch)}
              >
                {item.icon}
              </IconButton>
            ))}
            <div className="ml-auto">
              <ColorPopover
                label="Colore testo"
                value={ts.color ?? null}
                colors={BRANCH_COLORS}
                noneLabel="Predefinito"
                onSelect={(c) => onTextStyle({ color: c })}
              />
            </div>
          </div>
          {t.titleRuns && t.titleRuns.length > 0 && (
            <div className="text-2xs text-muted-foreground">
              Il titolo contiene formattazione parziale da XMind.
            </div>
          )}
        </>
      )}
    </InspectorSection>
  );
};
