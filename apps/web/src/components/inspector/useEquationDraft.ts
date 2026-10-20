import { useEffect, useRef, useState } from 'react';
import type { AppController, TitleMode, TopicView } from '@xmap/core';

export type TitleModeId = 'formula_only' | 'keep_title' | 'custom';

interface EquationDraftOptions {
  topic: TopicView;
  controller: AppController;
  darkMode: boolean;
  onChanged: () => void;
  onToast: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

// Bozza dell'equazione: vive nel corpo dell'ispettore, non nella sezione, così sopravvive alla chiusura della sezione.
export function useEquationDraft({ topic: t, controller, darkMode, onChanged, onToast }: EquationDraftOptions) {
  const [latex, setLatex] = useState(t.latex || '');
  const [titleMode, setTitleMode] = useState<TitleModeId>('formula_only');
  const [customTitle, setCustomTitle] = useState(t.title);
  const [inkColor, setInkColor] = useState('#000000');
  const [preview, setPreview] = useState<{ svg: string; error: string | null } | null>(null);
  const [applying, setApplying] = useState(false);

  // Undo/redo (o modifiche da altre viste) cambiano il topic mentre il pannello è aperto:
  // il campo LaTeX si riallinea al valore del modello.
  useEffect(() => setLatex(t.latex || ''), [t.latex]);

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

  const handleApplyEquation = async () => {
    if (!latex.trim() || preview?.error) return;
    setApplying(true);
    try {
      let mode: TitleMode;
      if (titleMode === 'keep_title') mode = { kind: 'keep_title' };
      else if (titleMode === 'custom') mode = { kind: 'custom', title: customTitle };
      else mode = { kind: 'formula_only' };
      await controller.apply(t.id, latex.trim(), { titleMode: mode, color: inkColor });
      onChanged();
      onToast('success', 'Equazione applicata');
    } catch (err: any) {
      onToast('error', `Errore: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveEquation = () => {
    try {
      controller.removeEquation(t.id);
      onChanged();
      onToast('info', 'Equazione rimossa');
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  return {
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
  };
}

export type EquationDraft = ReturnType<typeof useEquationDraft>;
