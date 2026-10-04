import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronRight, ChevronDown, Plus, Sparkles, FileText, MoreVertical, Link, } from 'lucide-react';
export const Outliner = ({ topics, searchQuery, onSelectTopic, onAddChild, onOpenLatex, onOpenDetails, selectedTopicId, collapsedIds, onToggleCollapse, resourceResolver, }) => {
    // Costruzione della mappa genitore -> figli
    const root = topics[0];
    if (!root) {
        return _jsx("div", { className: "p-8 text-center opacity-50 text-sm", children: "Nessun argomento presente." });
    }
    const query = searchQuery.trim().toLowerCase();
    // Filtra se c'è query di ricerca
    const matchesQuery = (t) => {
        if (!query)
            return true;
        return (t.title.toLowerCase().includes(query) ||
            t.notes.toLowerCase().includes(query) ||
            (t.latex && t.latex.toLowerCase().includes(query)) ||
            t.labels.some((l) => l.toLowerCase().includes(query)));
    };
    // Mappa di discendenza per mostrare i nodi quando un figlio combacia con la ricerca
    const visibleTopicIds = new Set();
    if (query) {
        for (const t of topics) {
            if (matchesQuery(t)) {
                visibleTopicIds.add(t.id);
                // Aggiungi tutti i genitori nel path
                let curr = t;
                while (curr && curr.parentId) {
                    visibleTopicIds.add(curr.parentId);
                    curr = topics.find((p) => p.id === curr.parentId);
                }
            }
        }
    }
    // Costruisce l'albero visibile
    const isHiddenByCollapse = (topic) => {
        if (query)
            return false; // Nella ricerca mostra tutto ciò che matcha
        let currParentId = topic.parentId;
        while (currParentId) {
            if (collapsedIds.has(currParentId))
                return true;
            const parentTopic = topics.find((t) => t.id === currParentId);
            currParentId = parentTopic?.parentId;
        }
        return false;
    };
    return (_jsx("div", { className: "flex-1 h-full overflow-y-auto p-4 max-w-4xl mx-auto space-y-1 select-none", children: topics
            .filter((t) => (query ? visibleTopicIds.has(t.id) : !isHiddenByCollapse(t)))
            .map((topic) => {
            const isSelected = topic.id === selectedTopicId;
            const isCollapsed = collapsedIds.has(topic.id);
            const hasChildren = topic.childCount > 0;
            const indentPx = topic.depth * 24;
            return (_jsxs("div", { onClick: () => onSelectTopic(topic), onDoubleClick: () => onOpenDetails(topic), className: `group flex items-center justify-between px-3 py-2 rounded-xl transition-all border ${isSelected
                    ? 'bg-adw-accent/15 border-adw-accent text-adw-fg shadow-sm'
                    : 'bg-adw-card border-adw-cardBorder hover:border-adw-accent/40 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`, style: { marginLeft: `${indentPx}px` }, children: [_jsxs("div", { className: "flex items-center space-x-2.5 min-w-0 flex-1", children: [hasChildren ? (_jsx("button", { type: "button", onClick: (e) => {
                                    e.stopPropagation();
                                    onToggleCollapse(topic.id);
                                }, className: "p-0.5 rounded opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5", children: isCollapsed ? (_jsx(ChevronRight, { className: "w-4 h-4" })) : (_jsx(ChevronDown, { className: "w-4 h-4" })) })) : (_jsx("div", { className: "w-4 h-4 flex items-center justify-center opacity-30", children: _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-current" }) })), topic.fillColor && (_jsx("div", { className: "w-2.5 h-2.5 rounded-full shrink-0 shadow-xs", style: { backgroundColor: topic.fillColor } })), _jsxs("div", { className: "flex items-center space-x-2 truncate min-w-0", children: [topic.latex ? (_jsxs("span", { className: "font-mono text-xs px-2 py-0.5 rounded bg-adw-accent/10 text-adw-accent font-semibold flex items-center gap-1 shrink-0", children: [_jsx(Sparkles, { className: "w-3 h-3" }), "$", topic.latex, "$"] })) : (_jsx("span", { className: `text-sm truncate ${topic.depth === 0 ? 'font-bold text-base' : 'font-medium'}`, children: topic.title || (_jsx("span", { className: "opacity-40 italic", children: "(senza titolo)" })) })), topic.markers.length > 0 && (_jsx("div", { className: "flex items-center space-x-1 shrink-0", children: topic.markers.map((m) => (_jsx("span", { className: "px-1.5 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/10 font-medium opacity-80", children: m }, m))) })), topic.labels.length > 0 && (_jsx("div", { className: "flex items-center space-x-1 shrink-0", children: topic.labels.map((l) => (_jsxs("span", { className: "px-1.5 py-0.5 rounded-md text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium", children: ["#", l] }, l))) })), topic.notes && (_jsx("span", { title: topic.notes, className: "opacity-50 hover:opacity-100 shrink-0", children: _jsx(FileText, { className: "w-3.5 h-3.5" }) })), topic.href && (_jsx("a", { href: topic.href, target: "_blank", rel: "noreferrer", onClick: (e) => e.stopPropagation(), title: topic.href, className: "opacity-50 hover:opacity-100 text-adw-accent shrink-0", children: _jsx(Link, { className: "w-3.5 h-3.5" }) }))] })] }), _jsxs("div", { className: "flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity pl-2", children: [_jsx("button", { type: "button", title: "Aggiungi Sotto-Argomento", onClick: (e) => {
                                    e.stopPropagation();
                                    onAddChild(topic.id);
                                }, className: "p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10", children: _jsx(Plus, { className: "w-4 h-4" }) }), _jsx("button", { type: "button", title: "Formula LaTeX", onClick: (e) => {
                                    e.stopPropagation();
                                    onOpenLatex(topic.id);
                                }, className: "p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 text-adw-accent", children: _jsx(Sparkles, { className: "w-4 h-4" }) }), _jsx("button", { type: "button", title: "Dettagli e Modifica", onClick: (e) => {
                                    e.stopPropagation();
                                    onOpenDetails(topic);
                                }, className: "p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10", children: _jsx(MoreVertical, { className: "w-4 h-4" }) })] })] }, topic.id));
        }) }));
};
