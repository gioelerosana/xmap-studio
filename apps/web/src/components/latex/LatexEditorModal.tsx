import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { Button, IconButton, Input, Kbd, KbdGroup, SegmentedControl, cn } from '@xmap/ui-kit';

import { INK_COLORS, TITLE_MODE_ITEMS } from './constants.js';
import { LatexPreview } from './LatexPreview.js';
import { SuggestionList } from './SuggestionList.js';
import { SymbolPalette } from './SymbolPalette.js';
import type { LatexEditorModalProps } from './types.js';
import { SCALE_MAX, SCALE_MIN, SCALE_STEP, clampScale, useEquationDraft } from './useEquationDraft.js';
import { useLatexEditor } from './useLatexEditor.js';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="tab"][tabindex="0"], [tabindex]:not([tabindex="-1"])';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover';

// Editor LaTeX centrato: anteprima grande, campo con suggerimenti, tavolozza di simboli.
export const LatexEditorModal: React.FC<LatexEditorModalProps> = ({ topic, ...rest }) => {
  if (!topic || typeof document === 'undefined') return null;
  return createPortal(<LatexDialog topic={topic} {...rest} />, document.body);
};

const LatexDialog: React.FC<Omit<LatexEditorModalProps, 'topic'> & { topic: NonNullable<LatexEditorModalProps['topic']> }> = ({
  topic,
  onClose,
  controller,
  darkMode,
  onChanged,
  onToast,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  const draft = useEquationDraft({ topic, controller, darkMode, onChanged, onToast });
  const {
    latex,
    setLatex,
    titleMode,
    setTitleMode,
    customTitle,
    setCustomTitle,
    inkColor,
    setInkColor,
    scalePercent,
    setScalePercent,
    preview,
    applying,
    handleApplyEquation,
    handleRemoveEquation,
    inlineMode,
  } = draft;

  const canApply = !!latex.trim() && !preview?.error && !applying;
  const apply = async () => {
    if (!canApply) return;
    if (await handleApplyEquation()) onClose();
  };

  // Invio nel campo applica; Ctrl/Cmd+Invio lo gestisce il dialog (vedi handleDialogKeyDown).
  const editor = useLatexEditor({ value: latex, onValueChange: setLatex, onSubmit: () => void apply() });
  const { textareaRef } = editor;

  const hasEquation = topic.kind === 'equation' || !!topic.latex;
  // Una formula inline nel titolo non è un'equazione nativa: niente "Aggiorna" né "Rimuovi".
  const editsEquation = hasEquation && !inlineMode;
  // Con la formula come titolo (`$…$`) il sottotitolo ripeterebbe il LaTeX sotto l'anteprima.
  const subtitle = topic.title.startsWith('$') ? '' : topic.displayTitle || topic.title;
  const idleLabel = editsEquation ? 'Aggiorna' : 'Applica';
  const applyLabel = applying ? 'Rendering…' : idleLabel;

  // Focus iniziale sul campo, cursore in fondo; alla chiusura il focus torna dov'era.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    return () => previouslyFocused?.focus?.();
  }, [textareaRef]);

  // Esc chiude il dialog solo se non l'ha già usato un suggerimento aperto.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Il campo cresce con il contenuto, fino al limite imposto dalle classi.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [latex, textareaRef]);

  const remove = () => {
    if (handleRemoveEquation()) onClose();
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void apply();
      return;
    }
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/32 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] max-sm:items-end max-sm:p-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-[85dvh] w-full max-w-3xl animate-pop-in flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-dialog outline-none max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              Formula LaTeX
            </h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <IconButton label="Chiudi" size="sm" className="-mr-1.5 -mt-0.5" onClick={onClose}>
            <X />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
          <LatexPreview preview={preview} />

          <div className="relative">
            <textarea
              ref={textareaRef}
              {...editor.textareaProps}
              value={latex}
              rows={3}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              aria-label="Formula LaTeX"
              placeholder="\int_{0}^{1} x^2\,dx"
              className="block max-h-48 min-h-[5.5rem] w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-sm leading-6 text-foreground shadow-control outline-none transition-shadow placeholder:text-muted-foreground focus:border-ring focus:shadow-[inset_0_0_0_3px_color-mix(in_oklab,var(--ring)_24%,transparent)] dark:bg-input/32"
            />
            {editor.suggestions.length > 0 && (
              <SuggestionList
                id={editor.listId}
                items={editor.suggestions}
                activeIndex={editor.activeIndex}
                optionId={editor.optionId}
                onHover={editor.setActiveIndex}
                onAccept={editor.acceptSuggestion}
              />
            )}
          </div>

          <p className="text-2xs text-muted-foreground max-sm:hidden coarse:hidden">
            Digita <span className="font-mono">\</span> per i suggerimenti, <Kbd>Tab</Kbd> li accetta, <Kbd>↵</Kbd>{' '}
            applica, <KbdGroup>
              <Kbd>Maiusc</Kbd>
              <Kbd>↵</Kbd>
            </KbdGroup>{' '}
            va a capo.
          </p>

          <SymbolPalette onInsertSnippet={editor.insertSnippet} onInsertText={editor.insertText} />
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {inlineMode ? (
              <p className="text-2xs font-medium text-muted-foreground">Formula nel testo del blocco</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-medium text-muted-foreground">Titolo</span>
                  <SegmentedControl
                    size="sm"
                    aria-label="Titolo del blocco"
                    items={TITLE_MODE_ITEMS}
                    activeId={titleMode}
                    onChange={setTitleMode}
                  />
                </div>
                {titleMode === 'custom' && (
                  <Input
                    size="sm"
                    aria-label="Titolo mostrato"
                    className="min-w-40 flex-1"
                    value={customTitle}
                    placeholder="Titolo mostrato"
                    onChange={(event) => setCustomTitle(event.target.value)}
                  />
                )}
                <div className="flex items-center gap-2" role="group" aria-label="Dimensione della formula">
                  <span className="text-2xs font-medium text-muted-foreground">Dimensione</span>
                  <IconButton
                    label="Riduci dimensione"
                    size="sm"
                    disabled={scalePercent <= SCALE_MIN}
                    onClick={() => setScalePercent(clampScale(scalePercent - SCALE_STEP))}
                  >
                    <Minus />
                  </IconButton>
                  <Input
                    size="sm"
                    type="number"
                    inputMode="numeric"
                    aria-label="Dimensione in percentuale"
                    className="w-16 text-center"
                    min={SCALE_MIN}
                    max={SCALE_MAX}
                    step={SCALE_STEP}
                    value={scalePercent}
                    onChange={(event) => {
                      const next = event.target.valueAsNumber;
                      if (Number.isFinite(next)) setScalePercent(Math.min(SCALE_MAX, Math.max(1, Math.round(next))));
                    }}
                    onBlur={() => setScalePercent(clampScale(scalePercent))}
                  />
                  <span className="text-2xs text-muted-foreground">%</span>
                  <IconButton
                    label="Aumenta dimensione"
                    size="sm"
                    disabled={scalePercent >= SCALE_MAX}
                    onClick={() => setScalePercent(clampScale(scalePercent + SCALE_STEP))}
                  >
                    <Plus />
                  </IconButton>
                </div>
                <div className="flex items-center gap-2" role="group" aria-label="Colore inchiostro">
                  <span className="text-2xs font-medium text-muted-foreground">Colore</span>
                  {INK_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Inchiostro ${color}`}
                      aria-pressed={inkColor === color}
                      onClick={() => setInkColor(color)}
                      className={cn(
                        'size-5 shrink-0 rounded-full',
                        FOCUS_RING,
                        inkColor === color
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-popover'
                          : 'ring-1 ring-inset ring-border',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {editsEquation && (
              <Button variant="ghost-destructive" size="sm" onClick={remove}>
                Rimuovi formula
              </Button>
            )}
            <Button variant="secondary" className="ml-auto" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="default" disabled={!canApply && !applying} loading={applying} onClick={() => void apply()}>
              {applyLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
