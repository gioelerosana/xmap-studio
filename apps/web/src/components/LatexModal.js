import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { renderLatexToSvg } from '@xmap/core';
import { Sparkles, AlertCircle } from 'lucide-react';
const TEMPLATES = [
    { label: 'Frazione', latex: '\\frac{a}{b}' },
    { label: 'Integrale', latex: '\\int_{a}^{b} f(x) \\, dx' },
    { label: 'Sommatoria', latex: '\\sum_{i=1}^{n} x_i' },
    { label: 'Radice', latex: '\\sqrt{x^2 + y^2}' },
    { label: 'Matrice', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
    { label: 'Limiti', latex: '\\lim_{x \\to \\infty} \\frac{1}{x} = 0' },
];
export const LatexModal = ({ isOpen, onClose, topicId, currentTitle = '', initialLatex = '', onApply, onRemove, }) => {
    const [latex, setLatex] = useState(initialLatex);
    const [mode, setMode] = useState('formula_only');
    const [customTitle, setCustomTitle] = useState(currentTitle);
    const [color, setColor] = useState('#000000');
    const [svgPreview, setSvgPreview] = useState('');
    const [error, setError] = useState(null);
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
            }
            else {
                setError(null);
                // Colora la formula in base al colore selezionato
                const colored = res.svg.replaceAll('currentColor', color);
                setSvgPreview(colored);
            }
        }
        catch (err) {
            setError(err.message || 'Errore di sintassi');
            setSvgPreview('');
        }
    }, [latex, color]);
    const handleApply = () => {
        if (!latex.trim() || error)
            return;
        let titleModeObj = { kind: 'formula_only' };
        if (mode === 'keep_title') {
            titleModeObj = { kind: 'keep_title' };
        }
        else if (mode === 'custom') {
            titleModeObj = { kind: 'custom', title: customTitle };
        }
        onApply(topicId, latex.trim(), { titleMode: titleModeObj, color });
        onClose();
    };
    const handleInsertTemplate = (tpl) => {
        setLatex((prev) => (prev ? `${prev} ${tpl}` : tpl));
    };
    return (_jsx(Modal, { isOpen: isOpen, onClose: onClose, title: "Editor Formula LaTeX (MathJax)", maxWidth: "max-w-2xl", footer: _jsxs("div", { className: "flex items-center justify-between w-full", children: [_jsx("div", { children: initialLatex && onRemove && (_jsx(Button, { variant: "destructive", size: "sm", onClick: () => {
                            onRemove(topicId);
                            onClose();
                        }, children: "Rimuovi Equazione" })) }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(Button, { variant: "flat", size: "sm", onClick: onClose, children: "Annulla" }), _jsx(Button, { variant: "suggested", size: "sm", disabled: !latex.trim() || Boolean(error), onClick: handleApply, children: "Applica Equazione" })] })] }), children: _jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "flex flex-col items-center justify-center p-6 rounded-xl border border-adw-cardBorder bg-adw-bg min-h-[120px] transition-all", children: svgPreview ? (_jsx("div", { className: "max-w-full overflow-x-auto p-2", dangerouslySetInnerHTML: { __html: svgPreview } })) : error ? (_jsxs("div", { className: "flex items-center space-x-2 text-adw-destructive text-sm", children: [_jsx(AlertCircle, { className: "w-5 h-5 shrink-0" }), _jsx("span", { children: error })] })) : (_jsx("span", { className: "text-xs opacity-50 italic", children: "Inserisci una formula per vedere l'anteprima istantanea" })) }), _jsxs("div", { className: "flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs", children: [_jsxs("span", { className: "opacity-60 flex items-center gap-1 shrink-0 font-medium", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5" }), " Modelli:"] }), TEMPLATES.map((t) => (_jsx("button", { type: "button", onClick: () => handleInsertTemplate(t.latex), className: "px-2 py-1 rounded bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.08)] hover:bg-adw-accent hover:text-white transition-colors shrink-0 font-mono text-[11px]", children: t.label }, t.label)))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold mb-1 opacity-80", children: "Formula LaTeX:" }), _jsx("textarea", { value: latex, onChange: (e) => setLatex(e.target.value), placeholder: "Esempio: \\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}", rows: 3, className: "w-full px-3 py-2 text-sm font-mono rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)] resize-none", autoFocus: true })] }), _jsxs("div", { className: "grid grid-cols-3 gap-2 text-xs", children: [_jsxs("label", { className: `flex items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${mode === 'formula_only'
                                ? 'border-adw-accent bg-adw-accent/10 font-semibold text-adw-accent'
                                : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`, children: [_jsx("input", { type: "radio", name: "title_mode", checked: mode === 'formula_only', onChange: () => setMode('formula_only'), className: "hidden" }), _jsx("span", { children: "Solo Formula" })] }), _jsxs("label", { className: `flex items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${mode === 'keep_title'
                                ? 'border-adw-accent bg-adw-accent/10 font-semibold text-adw-accent'
                                : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`, children: [_jsx("input", { type: "radio", name: "title_mode", checked: mode === 'keep_title', onChange: () => setMode('keep_title'), className: "hidden" }), _jsx("span", { children: "Mantieni Titolo" })] }), _jsxs("label", { className: `flex items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${mode === 'custom'
                                ? 'border-adw-accent bg-adw-accent/10 font-semibold text-adw-accent'
                                : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`, children: [_jsx("input", { type: "radio", name: "title_mode", checked: mode === 'custom', onChange: () => setMode('custom'), className: "hidden" }), _jsx("span", { children: "Titolo Personalizzato" })] })] }), mode === 'custom' && (_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-semibold mb-1 opacity-80", children: "Titolo del Blocco:" }), _jsx("input", { type: "text", value: customTitle, onChange: (e) => setCustomTitle(e.target.value), className: "w-full px-3 py-1.5 text-sm rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]" })] })), _jsxs("div", { className: "flex items-center justify-between text-xs pt-1", children: [_jsx("span", { className: "opacity-80 font-medium", children: "Colore Testo Formula:" }), _jsx("div", { className: "flex items-center space-x-2", children: ['#000000', '#ffffff', '#3584e4', '#e01b24', '#33d17a', '#7953a9'].map((c) => (_jsx("button", { type: "button", onClick: () => setColor(c), className: `w-6 h-6 rounded-full border border-black/20 dark:border-white/20 transition-transform ${color === c ? 'scale-125 ring-2 ring-adw-accent' : 'hover:scale-110'}`, style: { backgroundColor: c } }, c))) })] })] }) }));
};
