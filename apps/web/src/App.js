import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo } from 'react';
import { HeaderBar, ViewSwitcher, Button, IconButton, ToastContainer, } from '@xmap/ui-kit';
import { AppController, buildArchiveBytes, } from '@xmap/core';
import { FolderOpen, Save, Undo2, Redo2, Share2, Upload, Search, Moon, Sun, ListTree, Network, } from 'lucide-react';
import { openLocalXmindFile, saveLocalXmindFile } from './adapters/fileSystem.js';
import { Outliner } from './components/Outliner.js';
import { MapView } from './components/MapView.js';
import { LatexModal } from './components/LatexModal.js';
import { TopicDetailsModal } from './components/TopicDetailsModal.js';
import { ExportModal } from './components/ExportModal.js';
import { ImportModal } from './components/ImportModal.js';
import { EmptyState } from './components/EmptyState.js';
export const App = () => {
    const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
    const [controller] = useState(() => new AppController());
    const [workbook, setWorkbook] = useState(null);
    const [activeSheetIndex, setActiveSheetIndex] = useState(0);
    const [viewMode, setViewMode] = useState('outliner');
    const [searchQuery, setSearchQuery] = useState('');
    const [darkMode, setDarkMode] = useState(true);
    const [selectedTopicId, setSelectedTopicId] = useState();
    const [collapsedIds, setCollapsedIds] = useState(new Set());
    const [toasts, setToasts] = useState([]);
    const [fileHandle, setFileHandle] = useState();
    const [isWindowMaximized, setIsWindowMaximized] = useState(false);
    // Stati dei Modali
    const [latexModalOpen, setLatexModalOpen] = useState(false);
    const [latexTargetTopicId, setLatexTargetTopicId] = useState('');
    const [detailsModalOpen, setDetailsModalOpen] = useState(false);
    const [detailsTargetTopic, setDetailsTargetTopic] = useState(null);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const addToast = (type, message) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((prev) => [...prev, { id, type, message }]);
    };
    const removeToast = (id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };
    // Sincronizzazione finestra massimizzata per Electron
    useEffect(() => {
        if (isElectron && window.electronAPI) {
            window.electronAPI.isMaximized().then(setIsWindowMaximized);
            const unsubscribe = window.electronAPI.onMaximizedChange(setIsWindowMaximized);
            return unsubscribe;
        }
    }, [isElectron]);
    // Caricamento file passato da CLI o doppio clic in Electron
    useEffect(() => {
        if (isElectron && window.electronAPI) {
            window.electronAPI.getInitialFile().then(async (filePath) => {
                if (filePath && window.electronAPI) {
                    const res = await window.electronAPI.openFilePath(filePath);
                    if (res) {
                        const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
                        setWorkbook(dto);
                        setActiveSheetIndex(0);
                        addToast('success', `Aperto: ${res.name}`);
                    }
                }
            });
        }
    }, [controller, isElectron]);
    // Tema Dark/Light
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        }
        else {
            document.documentElement.classList.remove('dark');
        }
    }, [darkMode]);
    const currentSheet = workbook?.sheets[activeSheetIndex];
    const allTopics = useMemo(() => currentSheet?.topics || [], [currentSheet]);
    const currentLayout = useMemo(() => {
        if (!workbook || viewMode !== 'map')
            return null;
        return controller.mapLayout(activeSheetIndex, collapsedIds);
    }, [controller, workbook, activeSheetIndex, viewMode, collapsedIds]);
    const refreshState = useCallback(() => {
        setWorkbook(controller.workbook());
    }, [controller]);
    // Gestione File
    const handleOpenLocalFile = async () => {
        try {
            if (isElectron && window.electronAPI) {
                const res = await window.electronAPI.openFileDialog();
                if (!res)
                    return;
                const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
                setWorkbook(dto);
                setActiveSheetIndex(0);
                setCollapsedIds(new Set());
                addToast('success', `Mappa aperta: ${res.name}`);
                return;
            }
            const res = await openLocalXmindFile();
            if (!res)
                return;
            const dto = await controller.open(res.data, res.name, res.name);
            setWorkbook(dto);
            setFileHandle(res.handle);
            setActiveSheetIndex(0);
            setCollapsedIds(new Set());
            addToast('success', `Mappa aperta: ${res.name}`);
        }
        catch (err) {
            addToast('error', `Errore apertura file: ${err.message || String(err)}`);
        }
    };
    const handleLoadDemo = async () => {
        try {
            const response = await fetch('/demo.xmind');
            if (!response.ok)
                throw new Error('File demo non reperibile');
            const buffer = await response.arrayBuffer();
            const dto = await controller.open(new Uint8Array(buffer), 'Relazioni.xmap-studio.xmind');
            setWorkbook(dto);
            setFileHandle(undefined);
            setActiveSheetIndex(0);
            setCollapsedIds(new Set());
            addToast('info', 'Mappa demo caricata!');
        }
        catch (err) {
            addToast('error', `Impossibile caricare la demo: ${err.message}`);
        }
    };
    const handleNewMap = async () => {
        const blankJson = JSON.stringify([
            {
                id: 'sheet-1',
                class: 'sheet',
                title: 'Nuova Mappa',
                rootTopic: {
                    id: 'root-topic-1',
                    title: 'Argomento Centrale',
                    children: {
                        attached: [
                            { id: 'child-1', title: 'Sotto-argomento 1' },
                            { id: 'child-2', title: 'Sotto-argomento 2' },
                        ],
                    },
                },
            },
        ]);
        const enc = new TextEncoder();
        const rawArchive = {
            entries: new Map([
                ['content.json', enc.encode(blankJson)],
                ['manifest.json', enc.encode(JSON.stringify({ 'file-entries': { 'content.json': {} } }))],
                ['metadata.json', enc.encode(JSON.stringify({ creator: { name: 'XMap Studio' } }))],
            ]),
            resources: new Map(),
        };
        const bytes = await buildArchiveBytes(rawArchive);
        const dto = await controller.open(bytes, 'senza_titolo.xmind');
        setWorkbook(dto);
        setFileHandle(undefined);
        setActiveSheetIndex(0);
        setCollapsedIds(new Set());
        addToast('success', 'Nuova mappa creata');
    };
    const handleSave = async () => {
        if (!workbook)
            return;
        try {
            // Controllo di sicurezza XMind in background
            if (isElectron && window.electronAPI) {
                const running = await window.electronAPI.checkXMindRunning();
                if (running.length > 0) {
                    addToast('warning', `Attenzione: XMind è in esecuzione (${running.join(', ')}). Rischio sovrascrittura.`);
                }
            }
            const { bytes, validation } = await controller.prepareArchiveBytes();
            if (isElectron && window.electronAPI) {
                let savePath = workbook.path;
                if (!savePath || savePath === 'senza_titolo.xmind' || !savePath.includes('/')) {
                    const selected = await window.electronAPI.saveFileDialog(workbook.fileName || 'mappa.xmind');
                    if (!selected)
                        return;
                    savePath = selected;
                }
                const report = await window.electronAPI.saveAtomic(savePath, Array.from(bytes));
                controller.save();
                refreshState();
                addToast('success', `Salvataggio atomico completato. ${report.backup ? `Backup salvato in: ${report.backup}` : ''}`);
                return;
            }
            const newHandle = await saveLocalXmindFile(bytes, workbook.fileName || 'mappa.xmind', fileHandle);
            if (newHandle) {
                setFileHandle(newHandle);
            }
            controller.save();
            refreshState();
            addToast('success', `Mappa salvata con successo (${validation.resourceRefs} formule/risorse registrate)`);
        }
        catch (err) {
            addToast('error', `Errore durante il salvataggio: ${err.message}`);
        }
    };
    // Scorciatoie da tastiera globali
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    if (controller.workbook()?.canRedo) {
                        controller.redo();
                        refreshState();
                    }
                }
                else {
                    if (controller.workbook()?.canUndo) {
                        controller.undo();
                        refreshState();
                    }
                }
            }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                if (controller.workbook()?.canRedo) {
                    controller.redo();
                    refreshState();
                }
            }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                handleSave();
            }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                handleOpenLocalFile();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [controller, handleSave]);
    const handleToggleCollapse = (topicId) => {
        setCollapsedIds((prev) => {
            const next = new Set(prev);
            if (next.has(topicId)) {
                next.delete(topicId);
            }
            else {
                next.add(topicId);
            }
            return next;
        });
    };
    // Apertura Modali
    const openLatexModal = (topicId) => {
        setLatexTargetTopicId(topicId);
        setLatexModalOpen(true);
    };
    const openDetailsModal = (topic) => {
        setDetailsTargetTopic(topic);
        setDetailsModalOpen(true);
    };
    const handleAddChild = (parentId) => {
        const { dto, newId } = controller.addTopic(parentId, 'Nuovo Argomento');
        setWorkbook(dto);
        setSelectedTopicId(newId);
    };
    return (_jsxs("div", { className: "flex flex-col h-screen w-screen overflow-hidden bg-adw-bg text-adw-fg select-none", children: [_jsx(HeaderBar, { title: controller.mapTitle() || 'XMap Studio', subtitle: workbook?.dirty ? 'Modificato (non salvato)' : undefined, leftContent: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "flat", size: "sm", icon: _jsx(FolderOpen, { className: "w-4 h-4" }), onClick: handleOpenLocalFile, title: "Apri file .xmind (Ctrl+O)", children: "Apri" }), _jsx(Button, { variant: workbook?.dirty ? 'suggested' : 'flat', size: "sm", icon: _jsx(Save, { className: "w-4 h-4" }), disabled: !workbook, onClick: handleSave, title: "Salva mappa (Ctrl+S)", children: "Salva" }), _jsx("div", { className: "h-4 w-px bg-adw-headerbarBorder mx-1" }), _jsx(IconButton, { size: "sm", disabled: !workbook?.canUndo, onClick: () => {
                                controller.undo();
                                refreshState();
                            }, title: "Annulla (Ctrl+Z)", children: _jsx(Undo2, { className: "w-4 h-4" }) }), _jsx(IconButton, { size: "sm", disabled: !workbook?.canRedo, onClick: () => {
                                controller.redo();
                                refreshState();
                            }, title: "Ripristina (Ctrl+Y)", children: _jsx(Redo2, { className: "w-4 h-4" }) })] }), centerContent: workbook && (_jsx(ViewSwitcher, { items: [
                        { id: 'outliner', label: 'Outliner', icon: _jsx(ListTree, { className: "w-3.5 h-3.5" }) },
                        { id: 'map', label: 'Mappa Concettuale', icon: _jsx(Network, { className: "w-3.5 h-3.5" }) },
                    ], activeId: viewMode, onChange: (id) => setViewMode(id) })), rightContent: _jsxs(_Fragment, { children: [workbook && (_jsxs("div", { className: "relative flex items-center", children: [_jsx(Search, { className: "w-3.5 h-3.5 absolute left-2.5 opacity-40 pointer-events-none" }), _jsx("input", { type: "text", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), placeholder: "Cerca nodi o formule...", className: "w-40 focus:w-56 transition-all pl-8 pr-2.5 py-1 text-xs rounded-lg border border-adw-cardBorder bg-white/70 dark:bg-black/20 focus:outline-none focus:ring-1 focus:ring-adw-accent" })] })), workbook && (_jsxs(_Fragment, { children: [_jsx(IconButton, { size: "sm", title: "Importa Outline", onClick: () => setImportModalOpen(true), children: _jsx(Upload, { className: "w-4 h-4" }) }), _jsx(IconButton, { size: "sm", title: "Esporta (Markdown, OPML, Outline)", onClick: () => setExportModalOpen(true), children: _jsx(Share2, { className: "w-4 h-4" }) })] })), _jsx(IconButton, { size: "sm", title: "Cambia Tema", onClick: () => setDarkMode(!darkMode), children: darkMode ? _jsx(Sun, { className: "w-4 h-4" }) : _jsx(Moon, { className: "w-4 h-4" }) })] }), showWindowControls: isElectron, windowControlProps: isElectron
                    ? {
                        onMinimize: () => window.electronAPI?.minimize(),
                        onMaximize: () => window.electronAPI?.maximize(),
                        onClose: () => window.electronAPI?.close(),
                        isMaximized: isWindowMaximized,
                    }
                    : undefined }), _jsx("main", { className: "flex-1 flex flex-col overflow-hidden relative", children: !workbook ? (_jsx(EmptyState, { onOpenFile: handleOpenLocalFile, onNewFile: handleNewMap, onLoadDemo: handleLoadDemo, onDropFiles: async (file) => {
                        const buffer = await file.arrayBuffer();
                        const dto = await controller.open(new Uint8Array(buffer), file.name);
                        setWorkbook(dto);
                        setActiveSheetIndex(0);
                        addToast('success', `Aperto ${file.name}`);
                    } })) : (_jsxs("div", { className: "flex-1 flex flex-col overflow-hidden", children: [viewMode === 'outliner' ? (_jsx(Outliner, { topics: allTopics, searchQuery: searchQuery, onSelectTopic: (t) => setSelectedTopicId(t.id), onAddChild: handleAddChild, onOpenLatex: openLatexModal, onOpenDetails: openDetailsModal, selectedTopicId: selectedTopicId, collapsedIds: collapsedIds, onToggleCollapse: handleToggleCollapse, resourceResolver: (src) => controller.resourceBytes(src) })) : (_jsx(MapView, { layout: currentLayout, selectedTopicId: selectedTopicId, onSelectTopic: (id) => setSelectedTopicId(id), onOpenDetails: (id) => {
                                const t = allTopics.find((x) => x.id === id);
                                if (t)
                                    openDetailsModal(t);
                            }, onOpenLatex: openLatexModal, onAddChild: handleAddChild, onToggleCollapse: handleToggleCollapse, resourceResolver: (src) => controller.resourceBytes(src) })), workbook.sheets.length > 1 && (_jsx("div", { className: "h-9 border-t border-adw-cardBorder bg-adw-card flex items-center px-3 space-x-1 overflow-x-auto text-xs font-medium", children: workbook.sheets.map((sheet, idx) => (_jsx("button", { type: "button", onClick: () => setActiveSheetIndex(idx), className: `px-3 py-1 rounded-md transition-colors ${idx === activeSheetIndex
                                    ? 'bg-adw-accent text-white font-semibold'
                                    : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'}`, children: sheet.title }, sheet.id || idx))) }))] })) }), _jsx(LatexModal, { isOpen: latexModalOpen, onClose: () => setLatexModalOpen(false), topicId: latexTargetTopicId, currentTitle: allTopics.find((t) => t.id === latexTargetTopicId)?.title, initialLatex: allTopics.find((t) => t.id === latexTargetTopicId)?.latex, onApply: async (topicId, latex, options) => {
                    try {
                        const updated = await controller.apply(topicId, latex, {
                            titleMode: options.titleMode,
                            color: options.color,
                        });
                        setWorkbook(updated);
                        addToast('success', 'Equazione applicata con successo');
                    }
                    catch (err) {
                        addToast('error', `Errore applicazione equazione: ${err.message}`);
                    }
                }, onRemove: (topicId) => {
                    const updated = controller.removeEquation(topicId);
                    setWorkbook(updated);
                    addToast('info', 'Equazione rimossa');
                } }), _jsx(TopicDetailsModal, { isOpen: detailsModalOpen, onClose: () => setDetailsModalOpen(false), topic: detailsTargetTopic, onSave: (updates) => {
                    if (!detailsTargetTopic)
                        return;
                    controller.setTopicTitle(detailsTargetTopic.id, updates.title);
                    controller.setTopicNotes(detailsTargetTopic.id, updates.notes);
                    if (updates.notesDisplay !== undefined) {
                        controller.setTopicNotesDisplay(detailsTargetTopic.id, updates.notesDisplay);
                    }
                    controller.setTopicLabels(detailsTargetTopic.id, updates.labels);
                    if (updates.href !== undefined) {
                        controller.setTopicHref(detailsTargetTopic.id, updates.href);
                    }
                    if (updates.color !== undefined) {
                        controller.setTopicColor(detailsTargetTopic.id, updates.color);
                    }
                    if (updates.markerToggle) {
                        controller.toggleTopicMarker(detailsTargetTopic.id, updates.markerToggle);
                    }
                    refreshState();
                }, onOpenLatex: openLatexModal, onDeleteTopic: (topicId) => {
                    const updated = controller.removeTopic(topicId);
                    setWorkbook(updated);
                    addToast('info', 'Blocco eliminato');
                } }), _jsx(ExportModal, { isOpen: exportModalOpen, onClose: () => setExportModalOpen(false), getExportContent: (fmt) => controller.export(fmt) }), _jsx(ImportModal, { isOpen: importModalOpen, onClose: () => setImportModalOpen(false), onImport: async (fmt, text, asNewSheet) => {
                    try {
                        const updated = await controller.importOutline(fmt, text, { asNewSheet });
                        setWorkbook(updated);
                        addToast('success', 'Outline importato con successo');
                    }
                    catch (err) {
                        addToast('error', `Errore durante l'importazione: ${err.message}`);
                    }
                } }), _jsx(ToastContainer, { toasts: toasts, onDismiss: removeToast })] }));
};
