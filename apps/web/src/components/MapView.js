import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
import { Plus, Minus, Maximize2, Sparkles, FileText } from 'lucide-react';
export const MapView = ({ layout, selectedTopicId, onSelectTopic, onOpenDetails, onOpenLatex, onAddChild, onToggleCollapse, resourceResolver, }) => {
    const containerRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 60, y: 60 });
    const [isPanning, setIsPanning] = useState(false);
    const [startPan, setStartPan] = useState({ x: 0, y: 0 });
    // Gestione rotellina per zoom e pan
    const handleWheel = (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom((z) => Math.min(Math.max(z * zoomFactor, 0.2), 3.0));
        }
        else {
            setPan((p) => ({
                x: p.x - e.deltaX,
                y: p.y - e.deltaY,
            }));
        }
    };
    const handleMouseDown = (e) => {
        if (e.button === 0 && e.target.tagName === 'svg') {
            setIsPanning(true);
            setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
    };
    const handleMouseMove = (e) => {
        if (isPanning) {
            setPan({
                x: e.clientX - startPan.x,
                y: e.clientY - startPan.y,
            });
        }
    };
    const handleMouseUp = () => {
        setIsPanning(false);
    };
    const resetView = () => {
        setZoom(1);
        setPan({ x: 60, y: 60 });
    };
    if (!layout || layout.nodes.length === 0) {
        return (_jsx("div", { className: "flex-1 flex items-center justify-center text-sm opacity-50 select-none", children: "Nessun layout disponibile." }));
    }
    // Prepara l'URL per le immagini dei nodi
    const getResourceUrl = (src) => {
        if (!src)
            return undefined;
        const bytes = resourceResolver(src);
        if (!bytes)
            return undefined;
        const blob = new Blob([bytes], { type: 'image/png' });
        return URL.createObjectURL(blob);
    };
    return (_jsxs("div", { ref: containerRef, onWheel: handleWheel, onMouseDown: handleMouseDown, onMouseMove: handleMouseMove, onMouseUp: handleMouseUp, className: "relative flex-1 h-full w-full overflow-hidden bg-adw-bg select-none cursor-grab active:cursor-grabbing", children: [_jsxs("div", { className: "absolute bottom-5 right-5 z-20 flex items-center space-x-1.5 p-1.5 rounded-2xl bg-adw-card/90 backdrop-blur-md border border-adw-cardBorder shadow-lg", children: [_jsx("button", { type: "button", onClick: () => setZoom((z) => Math.max(z * 0.85, 0.2)), className: "p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10", title: "Zoom Indietro", children: _jsx(Minus, { className: "w-4 h-4" }) }), _jsxs("span", { className: "text-xs font-semibold px-1 min-w-[42px] text-center font-mono", children: [Math.round(zoom * 100), "%"] }), _jsx("button", { type: "button", onClick: () => setZoom((z) => Math.min(z * 1.15, 3.0)), className: "p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10", title: "Zoom Avanti", children: _jsx(Plus, { className: "w-4 h-4" }) }), _jsx("button", { type: "button", onClick: resetView, className: "p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-adw-accent", title: "Ripristina Vista", children: _jsx(Maximize2, { className: "w-4 h-4" }) })] }), _jsxs("svg", { className: "w-full h-full", style: {
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: '0 0',
                }, children: [_jsx("defs", { children: _jsx("marker", { id: "rel-arrow", viewBox: "0 0 10 10", refX: "6", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse", children: _jsx("path", { d: "M 0 1.5 L 8 5 L 0 8.5 z", fill: "#e01b24", opacity: "0.8" }) }) }), layout.edges.map((edge, idx) => {
                        const p = layout.nodes[edge.parent];
                        const c = layout.nodes[edge.child];
                        if (!p || !c)
                            return null;
                        const startX = p.x + p.w;
                        const startY = p.y + p.h / 2;
                        const endX = c.x;
                        const endY = c.y + c.h / 2;
                        const midX = (startX + endX) / 2;
                        const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
                        const strokeColor = c.accent || '#3584e4';
                        return (_jsx("path", { d: pathD, fill: "none", stroke: strokeColor, strokeWidth: p.depth === 0 ? 2.5 : 2, strokeLinecap: "round", opacity: 0.8 }, `edge-${idx}`));
                    }), layout.relationships.map((rel) => {
                        const fromNode = layout.nodes[rel.from];
                        const toNode = layout.nodes[rel.to];
                        if (!fromNode || !toNode)
                            return null;
                        const startX = fromNode.x + fromNode.w / 2;
                        const startY = fromNode.y + fromNode.h / 2;
                        const endX = toNode.x + toNode.w / 2;
                        const endY = toNode.y + toNode.h / 2;
                        const dx = endX - startX;
                        const dy = endY - startY;
                        const cx = (startX + endX) / 2 - dy * 0.2;
                        const cy = (startY + endY) / 2 + dx * 0.2;
                        return (_jsxs("g", { children: [_jsx("path", { d: `M ${startX} ${startY} Q ${cx} ${cy}, ${endX} ${endY}`, fill: "none", stroke: "#e01b24", strokeWidth: 1.8, strokeDasharray: "5,5", markerEnd: "url(#rel-arrow)", opacity: 0.7 }), rel.title && (_jsx("text", { x: cx, y: cy - 4, fill: "#e01b24", fontSize: 10, textAnchor: "middle", fontWeight: "bold", children: rel.title }))] }, `rel-${rel.id}`));
                    }), layout.nodes.map((node) => {
                        const isSelected = node.id === selectedTopicId;
                        const accent = node.accent || (node.depth === 0 ? '#3584e4' : undefined);
                        const hasChildren = node.childCount > 0;
                        return (_jsxs("g", { transform: `translate(${node.x}, ${node.y})`, className: "cursor-pointer", onClick: () => onSelectTopic(node.id), onDoubleClick: (e) => {
                                e.stopPropagation();
                                onOpenDetails(node.id);
                            }, children: [_jsx("rect", { width: node.w, height: node.h, rx: node.depth === 0 ? 12 : 8, className: "transition-all", fill: node.fill || (node.depth === 0 ? '#3584e4' : 'var(--adw-card-bg)'), stroke: isSelected
                                        ? '#3584e4'
                                        : accent || 'var(--adw-card-border)', strokeWidth: isSelected ? 2.5 : accent ? 1.8 : 1, filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.06))" }), _jsx("foreignObject", { x: 8, y: 4, width: node.w - 16, height: node.h - 8, children: _jsxs("div", { className: `w-full h-full flex items-center space-x-2 truncate select-none ${node.depth === 0 ? 'text-white font-bold' : 'text-adw-fg'}`, children: [node.latex ? (_jsxs("div", { className: "flex items-center space-x-1.5 overflow-hidden", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5 text-adw-accent shrink-0" }), _jsxs("span", { className: "font-mono text-xs truncate", children: ["$", node.latex, "$"] })] })) : (_jsx("span", { className: `truncate ${node.depth === 0 ? 'text-sm font-bold' : 'text-xs font-medium'}`, children: node.title || '(senza titolo)' })), node.hasNotes && (_jsx(FileText, { className: "w-3 h-3 opacity-50 shrink-0" }))] }) }), hasChildren && (_jsxs("g", { transform: `translate(${node.w}, ${node.h / 2})`, onClick: (e) => {
                                        e.stopPropagation();
                                        onToggleCollapse(node.id);
                                    }, className: "hover:scale-125 transition-transform", children: [_jsx("circle", { r: 7, fill: accent || '#3584e4', stroke: "white", strokeWidth: 1.5 }), node.collapsed ? (_jsx("path", { d: "M -2 -3 L 2 0 L -2 3", fill: "none", stroke: "white", strokeWidth: 1.5, strokeLinecap: "round" })) : (_jsx("circle", { r: 2, fill: "white" }))] }))] }, node.id));
                    })] })] }));
};
