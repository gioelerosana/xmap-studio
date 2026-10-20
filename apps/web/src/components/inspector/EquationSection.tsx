import React from 'react';
import { AlertCircle, Sigma } from 'lucide-react';
import { Banner, Button, Input, SegmentedControl, Textarea, cn } from '@xmap/ui-kit';

import { FOCUS_RING, chipClass, swatchHairline, swatchSelected } from './classes.js';
import { INK_COLORS, TEMPLATES, TITLE_MODE_ITEMS } from './constants.js';
import { InspectorSection } from './InspectorSection.js';
import type { EquationDraft } from './useEquationDraft.js';

interface EquationSectionProps {
  hasEquation: boolean;
  draft: EquationDraft;
}

// Equazione: aperta di default solo se il blocco è già un'equazione
export const EquationSection: React.FC<EquationSectionProps> = ({ hasEquation, draft }) => {
  const {
    latex,
    setLatex,
    titleMode,
    setTitleMode,
    customTitle,
    setCustomTitle,
    inkColor,
    setInkColor,
    preview,
    applying,
    handleApplyEquation,
    handleRemoveEquation,
  } = draft;

  return (
    <InspectorSection
      // Stato ricordato separato per equazioni e testo; la key rimonta la sezione al cambio di tipo.
      key={hasEquation ? 'equation:eq' : 'equation:text'}
      id={hasEquation ? 'equation:eq' : 'equation:text'}
      title="Equazione LaTeX"
      icon={<Sigma className="size-3.5" />}
      defaultOpen={hasEquation}
      summary={hasEquation ? <Sigma className="size-3" /> : undefined}
    >
      <div className="eq-preview">
        {preview?.error ? (
          <Banner variant="error" className="w-full" icon={<AlertCircle className="size-4" />}>
            {preview.error}
          </Banner>
        ) : preview?.svg ? (
          <div className="max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: preview.svg }} />
        ) : (
          <span className="text-2xs italic text-muted-foreground">Anteprima formula</span>
        )}
      </div>

      <Textarea
        mono
        rows={2}
        aria-label="Formula LaTeX"
        value={latex}
        placeholder="\\int_{0}^{1} x^2\\,dx"
        onChange={(e) => setLatex(e.target.value)}
      />

      <div role="group" aria-label="Inserisci modello" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            className={cn(chipClass(false), 'shrink-0')}
            onClick={() => setLatex((prev) => (prev ? `${prev} ${tpl.latex}` : tpl.latex))}
          >
            {tpl.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <SegmentedControl
          size="sm"
          className="grid flex-1 grid-cols-3"
          items={TITLE_MODE_ITEMS}
          activeId={titleMode}
          onChange={(id) => setTitleMode(id)}
        />
        <div className="flex items-center gap-1" role="group" aria-label="Colore inchiostro">
          {INK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Inchiostro ${c}`}
              aria-pressed={inkColor === c}
              onClick={() => setInkColor(c)}
              className={cn(
                'size-4 shrink-0 rounded-full',
                FOCUS_RING,
                inkColor === c ? swatchSelected : swatchHairline
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {titleMode === 'custom' && (
        <Input
          size="sm"
          aria-label="Titolo mostrato"
          value={customTitle}
          placeholder="Titolo mostrato"
          onChange={(e) => setCustomTitle(e.target.value)}
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          disabled={!latex.trim() || !!preview?.error || applying}
          onClick={handleApplyEquation}
        >
          {applying ? 'Rendering…' : hasEquation ? 'Aggiorna equazione' : 'Applica equazione'}
        </Button>
        {hasEquation && (
          <Button variant="ghost" size="sm" onClick={handleRemoveEquation}>
            Rimuovi
          </Button>
        )}
      </div>
    </InspectorSection>
  );
};
