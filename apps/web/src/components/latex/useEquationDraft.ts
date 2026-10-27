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

export const SCALE_MIN = 50;
export const SCALE_MAX = 300;
export const SCALE_STEP = 5;
const BASE_EM_PX = 23.33;
const PREVIEW_EM_PX = 28;

export const clampScale = (percent: number) =>
  Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(percent)));

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
  // Percentuale di ingrandimento; riaprendo un'equazione si ricava dalla larghezza salvata.
  const [scalePercent, setScalePercent] = useState(() => {
    if (t.kind !== 'equation' || !t.latex || !t.imageW) return 100;
    try {
      const fontPx = t.textStyle?.fontSizePx;
      const baseWidth = controller.preview(t.latex, fontPx ? fontPx * 1.25 : BASE_EM_PX).width;
      if (!baseWidth) return 100;
      const percent = clampScale(Math.round((t.imageW / baseWidth) * (100 / SCALE_STEP)) * SCALE_STEP);
      return Math.abs(percent - 100) <= 3 ? 100 : percent;
    } catch {
      return 100;
    }
  });
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
        const res = controller.preview(trimmed, PREVIEW_EM_PX * (inlineFormula ? 1 : clampScale(scalePercent) / 100));
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
  }, [latex, inkColor, darkMode, controller, scalePercent, inlineFormula]);

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
      else await controller.apply(t.id, latex.trim(), { titleMode: mode, color: inkColor, scale: clampScale(scalePercent) / 100 });
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
    scalePercent,
    setScalePercent,
    preview,
    applying,
    handleApplyEquation,
    handleRemoveEquation,
  };
}

export type EquationDraft = ReturnType<typeof useEquationDraft>;
