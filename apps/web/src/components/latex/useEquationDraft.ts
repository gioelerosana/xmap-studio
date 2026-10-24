import { useEffect, useRef, useState } from 'react';
import {
  findInlineMathSegments,
  formatInlineMath,
  replaceInlineMathSegment,
  spliceTextRuns,
  type AppController,
  type TitleMode,
  type TopicView,
} from '@xmap/core';

export type TitleModeId = 'formula_only' | 'keep_title' | 'custom';

interface EquationDraftOptions {
  topic: TopicView;
  controller: AppController;
  darkMode: boolean;
  onChanged: () => void;
  onToast: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

// Bozza dell'equazione dell'editor LaTeX: anteprima con debounce, applicazione e rimozione.
export function useEquationDraft({ topic: t, controller, darkMode, onChanged, onToast }: EquationDraftOptions) {
  // Un blocco che non è un'equazione nativa ma ha `$…$` nel titolo modifica la prima formula del testo.
  const inlineFormula = t.kind === 'equation' ? undefined : findInlineMathSegments(t.title)[0];
  const inlineMode = inlineFormula !== undefined;
  const initialLatex = inlineFormula ? inlineFormula.latex : t.latex || '';
  const [latex, setLatex] = useState(initialLatex);
  const [titleMode, setTitleMode] = useState<TitleModeId>('formula_only');
  const [customTitle, setCustomTitle] = useState(t.title);
  const [inkColor, setInkColor] = useState('#000000');
  const [preview, setPreview] = useState<{ svg: string; error: string | null } | null>(null);
  const [applying, setApplying] = useState(false);

  // Undo/redo (o modifiche da altre viste) cambiano il topic mentre l'editor è aperto:
  // il campo LaTeX si riallinea al valore del modello.
  useEffect(() => setLatex(initialLatex), [initialLatex]);

  // L'inchiostro salvato resta nero (compatibilità XMind); in tema scuro
  // l'anteprima usa il colore del testo solo per la visualizzazione.
  const previewInk = inkColor === '#000000' && darkMode ? '#ffffff' : inkColor;

  // Anteprima LaTeX con debounce.
  const previewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    const trimmed = latex.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    previewTimer.current = window.setTimeout(() => {
      try {
        const res = controller.preview(trimmed, 28);
        if (res.error) {
          setPreview({ svg: '', error: res.error });
        } else {
          setPreview({ svg: res.svg.replaceAll('currentColor', previewInk), error: null });
        }
      } catch (err: any) {
        setPreview({ svg: '', error: err?.message || 'Errore di sintassi' });
      }
    }, 220);
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [latex, inkColor, darkMode, controller]);

  // Riscrive solo la formula inline del titolo: delimitatori e frammenti di stile restano.
  // La validazione di `replaceInlineMathSegment` avviene prima di toccare il modello.
  const writeInlineFormula = (formula: string) => {
    const target = findInlineMathSegments(t.title)[0];
    if (!target) throw new Error('Formula non trovata nel testo del blocco.');
    const nextTitle = replaceInlineMathSegment(t.title, 0, formula);
    if (t.titleRuns && t.titleRuns.length > 0) {
      const replacement = formatInlineMath(formula, target.display);
      controller.setTopicTitleRuns(t.id, spliceTextRuns(t.titleRuns, target.start, target.end, replacement));
    } else {
      controller.setTopicTitle(t.id, nextTitle);
    }
  };

  // Restituisce `true` se l'equazione è stata applicata (l'editor può chiudersi).
  const handleApplyEquation = async (): Promise<boolean> => {
    if (!latex.trim() || preview?.error) return false;
    setApplying(true);
    try {
      let mode: TitleMode;
      if (titleMode === 'keep_title') mode = { kind: 'keep_title' };
      else if (titleMode === 'custom') mode = { kind: 'custom', title: customTitle };
      else mode = { kind: 'formula_only' };
      if (inlineMode) writeInlineFormula(latex.trim());
      else await controller.apply(t.id, latex.trim(), { titleMode: mode, color: inkColor });
      onChanged();
      onToast('success', inlineMode ? 'Formula aggiornata' : 'Equazione applicata');
      return true;
    } catch (err: any) {
      onToast('error', `Errore: ${err.message}`);
      return false;
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveEquation = (): boolean => {
    try {
      controller.removeEquation(t.id);
      onChanged();
      onToast('info', 'Equazione rimossa');
      return true;
    } catch (err: any) {
      onToast('error', err.message);
      return false;
    }
  };

  return {
    latex,
    setLatex,
    inlineMode,
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
  };
}

export type EquationDraft = ReturnType<typeof useEquationDraft>;
