import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { Copy, Download, Check } from 'lucide-react';
import { downloadBlob } from '../adapters/fileSystem.js';
export const ExportModal = ({ isOpen, onClose, getExportContent, }) => {
    const [format, setFormat] = useState('markdown');
    const [copied, setCopied] = useState(false);
    if (!isOpen)
        return null;
    const content = getExportContent(format);
    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const handleDownload = () => {
        const ext = format === 'markdown' ? 'md' : format === 'opml' ? 'opml' : 'txt';
        const mime = format === 'markdown'
            ? 'text/markdown'
            : format === 'opml'
                ? 'text/xml'
                : 'text/plain';
        downloadBlob(new TextEncoder().encode(content), `export.${ext}`, mime);
    };
    return (_jsx(Modal, { isOpen: isOpen, onClose: onClose, title: "Esporta Mappa Concettuale", maxWidth: "max-w-2xl", footer: _jsxs("div", { className: "flex items-center justify-between w-full", children: [_jsx(Button, { variant: "flat", size: "sm", icon: copied ? _jsx(Check, { className: "w-3.5 h-3.5 text-adw-success" }) : _jsx(Copy, { className: "w-3.5 h-3.5" }), onClick: handleCopy, children: copied ? 'Copiato negli Appunti!' : 'Copia' }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(Button, { variant: "flat", size: "sm", onClick: onClose, children: "Chiudi" }), _jsx(Button, { variant: "suggested", size: "sm", icon: _jsx(Download, { className: "w-3.5 h-3.5" }), onClick: handleDownload, children: "Scarica File" })] })] }), children: _jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "flex space-x-2", children: ['markdown', 'opml', 'outline'].map((fmt) => (_jsx("button", { type: "button", onClick: () => setFormat(fmt), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${format === fmt
                            ? 'border-adw-accent bg-adw-accent/10 text-adw-accent font-semibold'
                            : 'border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`, children: fmt === 'markdown' ? 'Markdown (.md)' : fmt === 'opml' ? 'OPML 2.0 (.opml)' : 'Outline Testo (.txt)' }, fmt))) }), _jsx("textarea", { readOnly: true, value: content, rows: 14, className: "w-full px-3 py-2 text-xs font-mono rounded-lg border border-adw-cardBorder bg-adw-bg text-adw-fg focus:outline-none resize-none selection:bg-blue-500/20" })] }) }));
};
