import React, { useState, useEffect } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { renderLatexToSvg } from '@xmap/core';
import { Sparkles, AlertCircle } from 'lucide-react';

export interface LatexModalProps {
  isOpen: boolean;
  onClose: () => void;
  topicId: string;
  currentTitle?: string;
  initialLatex?: string;
  onApply: (topicId: string, latex: string, options: { titleMode: any; color: string }) => void;
  onRemove?: (topicId: string) => void;
}

const TEMPLATES = [
  { label: 'Frazione', latex: '\\frac{a}{b}' },
  { label: 'Integrale', latex: '\\int_{a}^{b} f(x) \\, dx' },
  { label: 'Sommatoria', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Radice', latex: '\\sqrt{x^2 + y^2}' },
  { label: 'Matrice', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Limiti', latex: '\\lim_{x \\to \\infty} \\frac{1}{x} = 0' },
];

export const LatexModal: React.FC<LatexModalProps> = ({
  isOpen,
  onClose,
  topicId,
  currentTitle = '',
  initialLatex = '',
  onApply,
  onRemove,
}) => {
  const [latex, setLatex] = useState(initialLatex);
  const [mode, setMode] = useState<'formula_only' | 'keep_title' | 'custom'>('formula_only');
  const [customTitle, setCustomTitle] = useState(currentTitle);
  const [color, setColor] = useState('#000000');
  const [svgPreview, setSvgPreview] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLatex(initialLatex);
    setMode('formula_only');
    setCustomTitle(currentTitle);
  }, [initialLatex, currentTitle, isOpen]);

  useEffect(() => {
    if (!latex.trim()) {
      setSvgPreview('');
      setError(null);
      return;
    }
    try {
      const res = renderLatexToSvg(latex.trim(), 28);
      if (res.error) {
        setError(res.error);
        setSvgPreview('');
      } else {
        setError(null);
        // Colora la formula in base al colore selezionato
        const colored = res.svg.replaceAll('currentColor', color);
        setSvgPreview(colored);
      }
    } catch (err: any) {
      setError(err.message || 'Errore di sintassi');
      setSvgPreview('');
    }
  }, [latex, color]);

  const handleApply = () => {
    if (!latex.trim() || error) return;
    let titleModeObj: any = { kind: 'formula_only' };
    if (mode === 'keep_title') {
      titleModeObj = { kind: 'keep_title' };
    } else if (mode === 'custom') {
      titleModeObj = { kind: 'custom', title: customTitle };
    }
    onApply(topicId, latex.trim(), { titleMode: titleModeObj, color });
    onClose();
  };

  const handleInsertTemplate = (tpl: string) => {
    setLatex((prev) => (prev ? `${prev} ${tpl}` : tpl));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Editor Formula LaTeX (MathJax)"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {initialLatex && onRemove && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onRemove(topicId);
                  onClose();
                }}
              >
                Rimuovi Equazione
              </Button>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="flat" size="sm" onClick={onClose}>
              Annulla
            </Button>
            <Button
              variant="suggested"
              size="sm"
              disabled={!latex.trim() || Boolean(error)}
              onClick={handleApply}
            >
              Applica Equazione
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Anteprima Live */}
        <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-adw-cardBorder bg-adw-bg min-h-[120px] transition-all">
          {svgPreview ? (
            <div
              className="max-w-full overflow-x-auto p-2"
              dangerouslySetInnerHTML={{ __html: svgPreview }}
            />
          ) : error ? (
            <div className="flex items-center space-x-2 text-adw-destructive text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <span className="text-xs opacity-50 italic">
              Inserisci una formula per vedere l'anteprima istantanea
            </span>
          )}
        </div>

        {/* Templates veloci */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
          <span className="opacity-60 flex items-center gap-1 shrink-0 font-medium">
            <Sparkles className="w-3.5 h-3.5" /> Modelli:
          </span>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => handleInsertTemplate(t.latex)}
              className="px-2 py-1 rounded bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.08)] hover:bg-adw-accent hover:text-white transition-colors shrink-0 font-mono text-[11px]"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Campo Codice LaTeX */}
        <div>
          <label className="block text-xs font-semibold mb-1 opacity-80">
            Formula LaTeX:
          </label>
          <textarea
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            placeholder="Esempio: \int_{-\infty}^{+\infty} e^{-x^2} dx = \sqrt{\pi}"
            rows={3}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)] resize-none"
            autoFocus
          />
        </div>

        {/* Modalità Titolo */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label
            className={`flex items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${
              mode === 'formula_only'
                ? 'border-adw-accent bg-adw-accent/10 font-semibold text-adw-accent'
                : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'
            }`}
          >
            <input
              type="radio"
              name="title_mode"
              checked={mode === 'formula_only'}
              onChange={() => setMode('formula_only')}
              className="hidden"
            />
            <span>Solo Formula</span>
          </label>

          <label
            className={`flex items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${
              mode === 'keep_title'
                ? 'border-adw-accent bg-adw-accent/10 font-semibold text-adw-accent'
                : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'
            }`}
          >
            <input
              type="radio"
              name="title_mode"
              checked={mode === 'keep_title'}
              onChange={() => setMode('keep_title')}
              className="hidden"
            />
            <span>Mantieni Titolo</span>
          </label>

          <label
            className={`flex items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${
              mode === 'custom'
                ? 'border-adw-accent bg-adw-accent/10 font-semibold text-adw-accent'
                : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'
            }`}
          >
            <input
              type="radio"
              name="title_mode"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
              className="hidden"
            />
            <span>Titolo Personalizzato</span>
          </label>
        </div>

        {mode === 'custom' && (
          <div>
            <label className="block text-xs font-semibold mb-1 opacity-80">
              Titolo del Blocco:
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]"
            />
          </div>
        )}

        {/* Colore Formula */}
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="opacity-80 font-medium">Colore Testo Formula:</span>
          <div className="flex items-center space-x-2">
            {['#000000', '#ffffff', '#3584e4', '#e01b24', '#33d17a', '#7953a9'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border border-black/20 dark:border-white/20 transition-transform ${
                  color === c ? 'scale-125 ring-2 ring-adw-accent' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
