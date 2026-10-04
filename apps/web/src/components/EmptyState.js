import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Button } from '@xmap/ui-kit';
import { FolderOpen, Plus, FileSpreadsheet, Sparkles, ShieldCheck } from 'lucide-react';
export const EmptyState = ({ onOpenFile, onNewFile, onLoadDemo, onDropFiles, }) => {
    const [isDragOver, setIsDragOver] = useState(false);
    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragOver(true);
    };
    const handleDragLeave = () => {
        setIsDragOver(false);
    };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.xmind') || file.type.includes('zip'))) {
            onDropFiles(file);
        }
    };
    return (_jsx("div", { className: "flex-1 flex flex-col items-center justify-center p-8 bg-adw-bg select-none", children: _jsxs("div", { onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop, className: `w-full max-w-xl p-10 rounded-3xl border-2 border-dashed flex flex-col items-center text-center transition-all ${isDragOver
                ? 'border-adw-accent bg-adw-accent/5 scale-[1.02]'
                : 'border-adw-cardBorder bg-adw-card shadow-sm hover:border-adw-accent/40'}`, children: [_jsx("div", { className: "w-16 h-16 rounded-2xl bg-adw-accent/10 flex items-center justify-center text-adw-accent mb-5", children: _jsx(Sparkles, { className: "w-8 h-8" }) }), _jsx("h1", { className: "text-xl font-bold tracking-tight mb-2", children: "Benvenuto in XMap Studio" }), _jsx("p", { className: "text-sm opacity-60 max-w-md mb-8", children: "Editor concettuale professionale con supporto nativo XMind, formule matematiche LaTeX/MathJax e architettura lossless garantita." }), _jsxs("div", { className: "flex flex-wrap items-center justify-center gap-3", children: [_jsx(Button, { variant: "suggested", size: "md", icon: _jsx(FolderOpen, { className: "w-4 h-4" }), onClick: onOpenFile, children: "Apri Mappa .xmind" }), _jsx(Button, { variant: "default", size: "md", icon: _jsx(Plus, { className: "w-4 h-4" }), onClick: onNewFile, children: "Nuova Mappa" }), _jsx(Button, { variant: "flat", size: "md", icon: _jsx(FileSpreadsheet, { className: "w-4 h-4 text-adw-accent" }), onClick: onLoadDemo, children: "Carica Mappa Demo" })] }), _jsxs("div", { className: "mt-8 pt-6 border-t border-adw-cardBorder w-full flex items-center justify-center text-xs opacity-50 space-x-2", children: [_jsx(ShieldCheck, { className: "w-4 h-4 text-adw-success" }), _jsxs("span", { children: ["Trascina qui qualsiasi file ", _jsx("b", { children: ".xmind" }), " per aprirlo istantaneamente"] })] })] }) }));
};
