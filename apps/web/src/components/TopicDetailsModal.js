import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { GROUPS } from '@xmap/core';
import { Tag, Link, FileText, Palette, Sparkles, Flag, Trash2, } from 'lucide-react';
export const TopicDetailsModal = ({ isOpen, onClose, topic, onSave, onOpenLatex, onDeleteTopic, }) => {
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [notesDisplay, setNotesDisplay] = useState(null);
    const [labelsStr, setLabelsStr] = useState('');
    const [href, setHref] = useState('');
    const [color, setColor] = useState(null);
    const [activeTab, setActiveTab] = useState('generale');
    useEffect(() => {
        if (topic) {
            setTitle(topic.title);
            setNotes(topic.notes);
            setNotesDisplay(topic.notesDisplay ?? null);
            setLabelsStr(topic.labels.join(', '));
            setHref(topic.href ?? '');
            setColor(topic.fillColor ?? null);
        }
    }, [topic, isOpen]);
    if (!topic)
        return null;
    const handleSave = () => {
        const labels = labelsStr
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        onSave({
            title,
            notes,
            notesDisplay,
            labels,
            href: href.trim() || undefined,
            color,
        });
        onClose();
    };
    return (_jsx(Modal, { isOpen: isOpen, onClose: onClose, title: "Dettagli & Propriet\u00E0 Blocco", maxWidth: "max-w-2xl", footer: _jsxs("div", { className: "flex items-center justify-between w-full", children: [_jsx("div", { children: topic.depth > 0 && (_jsx(Button, { variant: "destructive", size: "sm", icon: _jsx(Trash2, { className: "w-3.5 h-3.5" }), onClick: () => {
                            if (confirm('Eliminare questo blocco e i suoi sotto-rami?')) {
                                onDeleteTopic(topic.id);
                                onClose();
                            }
                        }, children: "Elimina Blocco" })) }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(Button, { variant: "flat", size: "sm", onClick: onClose, children: "Annulla" }), _jsx(Button, { variant: "suggested", size: "sm", onClick: handleSave, children: "Salva Modifiche" })] })] }), children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex border-b border-adw-cardBorder space-x-4 text-xs font-medium", children: [_jsx("button", { type: "button", onClick: () => setActiveTab('generale'), className: `pb-2 transition-colors border-b-2 ${activeTab === 'generale'
                                ? 'border-adw-accent text-adw-accent font-semibold'
                                : 'border-transparent opacity-60 hover:opacity-100'}`, children: "Generale & Note" }), _jsxs("button", { type: "button", onClick: () => setActiveTab('marker'), className: `pb-2 transition-colors border-b-2 ${activeTab === 'marker'
                                ? 'border-adw-accent text-adw-accent font-semibold'
                                : 'border-transparent opacity-60 hover:opacity-100'}`, children: ["Marker & Icone (", topic.markers.length, ")"] })] }), activeTab === 'generale' && (_jsxs("div", { className: "space-y-3.5 text-xs", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsx("label", { className: "font-semibold opacity-80", children: "Titolo Blocco:" }), topic.latex ? (_jsx(Button, { variant: "flat", size: "sm", icon: _jsx(Sparkles, { className: "w-3.5 h-3.5 text-adw-accent" }), onClick: () => {
                                                onClose();
                                                onOpenLatex(topic.id);
                                            }, children: "Modifica Formula LaTeX" })) : (_jsx(Button, { variant: "flat", size: "sm", icon: _jsx(Sparkles, { className: "w-3.5 h-3.5 text-adw-accent" }), onClick: () => {
                                                onClose();
                                                onOpenLatex(topic.id);
                                            }, children: "Inserisci LaTeX" }))] }), _jsx("input", { type: "text", value: title, onChange: (e) => setTitle(e.target.value), placeholder: "Titolo dell'argomento...", className: "w-full px-3 py-1.5 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]" })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsxs("label", { className: "font-semibold opacity-80 flex items-center gap-1.5", children: [_jsx(FileText, { className: "w-3.5 h-3.5" }), " Note del Blocco:"] }), _jsxs("div", { className: "flex items-center space-x-1.5 text-[11px]", children: [_jsx("span", { className: "opacity-60", children: "Visualizzazione:" }), _jsxs("select", { value: notesDisplay || 'default', onChange: (e) => setNotesDisplay(e.target.value === 'default'
                                                        ? null
                                                        : e.target.value), className: "px-2 py-0.5 rounded border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg", children: [_jsx("option", { value: "default", children: "Predefinita" }), _jsx("option", { value: "icon", children: "Icona a lato" }), _jsx("option", { value: "block", children: "Riquadro espanso" })] })] })] }), _jsx("textarea", { value: notes, onChange: (e) => setNotes(e.target.value), placeholder: "Note dettagliate o citazioni...", rows: 3, className: "w-full px-3 py-2 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)] resize-none" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsxs("label", { className: "font-semibold opacity-80 mb-1 flex items-center gap-1.5", children: [_jsx(Tag, { className: "w-3.5 h-3.5" }), " Etichette (separate da virgola):"] }), _jsx("input", { type: "text", value: labelsStr, onChange: (e) => setLabelsStr(e.target.value), placeholder: "es. Importante, Revisione, Studio", className: "w-full px-3 py-1.5 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]" })] }), _jsxs("div", { children: [_jsxs("label", { className: "font-semibold opacity-80 mb-1 flex items-center gap-1.5", children: [_jsx(Link, { className: "w-3.5 h-3.5" }), " Collegamento Href / Web URL:"] }), _jsx("input", { type: "text", value: href, onChange: (e) => setHref(e.target.value), placeholder: "https://... o #topic-id", className: "w-full px-3 py-1.5 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]" })] })] }), _jsxs("div", { children: [_jsxs("label", { className: "font-semibold opacity-80 mb-1.5 flex items-center gap-1.5", children: [_jsx(Palette, { className: "w-3.5 h-3.5" }), " Colore Sfondo / Ramo (svg:fill):"] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("button", { type: "button", onClick: () => setColor(null), className: `px-2 py-1 rounded border text-[11px] ${!color ? 'border-adw-accent font-semibold text-adw-accent' : 'opacity-60'}`, children: "Predefinito" }), ['#E65D5D', '#E9863F', '#C99A12', '#79A83B', '#1599B5', '#7953A9', '#4E5D6C'].map((c) => (_jsx("button", { type: "button", onClick: () => setColor(c), className: `w-5 h-5 rounded-full border border-black/20 dark:border-white/20 transition-transform ${color === c ? 'scale-125 ring-2 ring-adw-accent' : 'hover:scale-110'}`, style: { backgroundColor: c } }, c)))] })] })] })), activeTab === 'marker' && (_jsx("div", { className: "space-y-4 max-h-[360px] overflow-y-auto pr-1", children: GROUPS.map((group) => (_jsxs("div", { className: "space-y-1.5", children: [_jsxs("div", { className: "text-xs font-semibold opacity-70 flex items-center gap-1", children: [_jsx(Flag, { className: "w-3 h-3 text-adw-accent" }), " ", group.label] }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: group.markers.map((m) => {
                                    const isSelected = topic.markers.includes(m.id);
                                    return (_jsx("button", { type: "button", onClick: () => onSave({
                                            title,
                                            notes,
                                            notesDisplay,
                                            labels: topic.labels,
                                            markerToggle: m.id,
                                        }), className: `px-2.5 py-1 rounded-md text-xs border transition-all flex items-center space-x-1.5 ${isSelected
                                            ? 'bg-adw-accent text-white border-adw-accent font-medium shadow-sm'
                                            : 'bg-white dark:bg-[#2b2b2b] border-adw-cardBorder hover:border-adw-accent opacity-80'}`, children: _jsx("span", { children: m.name }) }, m.id));
                                }) })] }, group.id))) }))] }) }));
};
