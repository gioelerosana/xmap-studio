import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HeaderBar,
  ViewSwitcher,
  Button,
  IconButton,
  ToastContainer,
  ToastMessage,
} from '@xmap/ui-kit';
import {
  AppController,
  Layout,
  TopicView,
  WorkbookDto,
  buildArchiveBytes,
  RawArchive,
} from '@xmap/core';
import {
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Share2,
  Upload,
  Search,
  Moon,
  Sun,
  ListTree,
  Network,
} from 'lucide-react';
import { openLocalXmindFile, saveLocalXmindFile } from './adapters/fileSystem.js';
import { Outliner } from './components/Outliner.js';
import { MapView } from './components/MapView.js';
import { LatexModal } from './components/LatexModal.js';
import { TopicDetailsModal } from './components/TopicDetailsModal.js';
import { ExportModal } from './components/ExportModal.js';
import { ImportModal } from './components/ImportModal.js';
import { EmptyState } from './components/EmptyState.js';

declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: () => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      saveFileDialog: (suggestedName?: string) => Promise<string | null>;
      saveAtomic: (filePath: string, bytes: number[]) => Promise<{ backup?: string; bytes: number }>;
      checkXMindRunning: () => Promise<string[]>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      getInitialFile: () => Promise<string | null>;
      onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
    };
  }
}

export const App: React.FC = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
  const [controller] = useState(() => new AppController());
  const [workbook, setWorkbook] = useState<WorkbookDto | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'outliner' | 'map'>('outliner');
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  // Stati dei Modali
  const [latexModalOpen, setLatexModalOpen] = useState(false);
  const [latexTargetTopicId, setLatexTargetTopicId] = useState<string>('');
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [detailsTargetTopic, setDetailsTargetTopic] = useState<TopicView | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const addToast = (type: 'info' | 'success' | 'warning' | 'error', message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
  };

  const removeToast = (id: string) => {
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
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const currentSheet = workbook?.sheets[activeSheetIndex];
  const allTopics = useMemo(() => currentSheet?.topics || [], [currentSheet]);

  const currentLayout = useMemo<Layout | null>(() => {
    if (!workbook || viewMode !== 'map') return null;
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
        if (!res) return;
        const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
        setWorkbook(dto);
        setActiveSheetIndex(0);
        setCollapsedIds(new Set());
        addToast('success', `Mappa aperta: ${res.name}`);
        return;
      }

      const res = await openLocalXmindFile();
      if (!res) return;
      const dto = await controller.open(res.data, res.name, res.name);
      setWorkbook(dto);
      setFileHandle(res.handle);
      setActiveSheetIndex(0);
      setCollapsedIds(new Set());
      addToast('success', `Mappa aperta: ${res.name}`);
    } catch (err: any) {
      addToast('error', `Errore apertura file: ${err.message || String(err)}`);
    }
  };

  const handleLoadDemo = async () => {
    try {
      const response = await fetch('/demo.xmind');
      if (!response.ok) throw new Error('File demo non reperibile');
      const buffer = await response.arrayBuffer();
      const dto = await controller.open(new Uint8Array(buffer), 'Relazioni.xmap-studio.xmind');
      setWorkbook(dto);
      setFileHandle(undefined);
      setActiveSheetIndex(0);
      setCollapsedIds(new Set());
      addToast('info', 'Mappa demo caricata!');
    } catch (err: any) {
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
    const rawArchive: RawArchive = {
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
    if (!workbook) return;
    try {
      // Controllo di sicurezza XMind in background
      if (isElectron && window.electronAPI) {
        const running = await window.electronAPI.checkXMindRunning();
        if (running.length > 0) {
          addToast(
            'warning',
            `Attenzione: XMind è in esecuzione (${running.join(', ')}). Rischio sovrascrittura.`
          );
        }
      }

      const { bytes, validation } = await controller.prepareArchiveBytes();

      if (isElectron && window.electronAPI) {
        let savePath = workbook.path;
        if (!savePath || savePath === 'senza_titolo.xmind' || !savePath.includes('/')) {
          const selected = await window.electronAPI.saveFileDialog(workbook.fileName || 'mappa.xmind');
          if (!selected) return;
          savePath = selected;
        }
        const report = await window.electronAPI.saveAtomic(savePath, Array.from(bytes));
        controller.save();
        refreshState();
        addToast(
          'success',
          `Salvataggio atomico completato. ${report.backup ? `Backup salvato in: ${report.backup}` : ''}`
        );
        return;
      }

      const newHandle = await saveLocalXmindFile(
        bytes,
        workbook.fileName || 'mappa.xmind',
        fileHandle
      );
      if (newHandle) {
        setFileHandle(newHandle);
      }
      controller.save();
      refreshState();
      addToast(
        'success',
        `Mappa salvata con successo (${validation.resourceRefs} formule/risorse registrate)`
      );
    } catch (err: any) {
      addToast('error', `Errore durante il salvataggio: ${err.message}`);
    }
  };

  // Scorciatoie da tastiera globali
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (controller.workbook()?.canRedo) {
            controller.redo();
            refreshState();
          }
        } else {
          if (controller.workbook()?.canUndo) {
            controller.undo();
            refreshState();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (controller.workbook()?.canRedo) {
          controller.redo();
          refreshState();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenLocalFile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controller, handleSave]);

  const handleToggleCollapse = (topicId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  // Apertura Modali
  const openLatexModal = (topicId: string) => {
    setLatexTargetTopicId(topicId);
    setLatexModalOpen(true);
  };

  const openDetailsModal = (topic: TopicView) => {
    setDetailsTargetTopic(topic);
    setDetailsModalOpen(true);
  };

  const handleAddChild = (parentId: string) => {
    const { dto, newId } = controller.addTopic(parentId, 'Nuovo Argomento');
    setWorkbook(dto);
    setSelectedTopicId(newId);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-adw-bg text-adw-fg select-none">
      {/* HeaderBar GNOME Adwaita con CSD */}
      <HeaderBar
        title={controller.mapTitle() || 'XMap Studio'}
        subtitle={workbook?.dirty ? 'Modificato (non salvato)' : undefined}
        leftContent={
          <>
            <Button
              variant="flat"
              size="sm"
              icon={<FolderOpen className="w-4 h-4" />}
              onClick={handleOpenLocalFile}
              title="Apri file .xmind (Ctrl+O)"
            >
              Apri
            </Button>
            <Button
              variant={workbook?.dirty ? 'suggested' : 'flat'}
              size="sm"
              icon={<Save className="w-4 h-4" />}
              disabled={!workbook}
              onClick={handleSave}
              title="Salva mappa (Ctrl+S)"
            >
              Salva
            </Button>
            <div className="h-4 w-px bg-adw-headerbarBorder mx-1" />
            <IconButton
              size="sm"
              disabled={!workbook?.canUndo}
              onClick={() => {
                controller.undo();
                refreshState();
              }}
              title="Annulla (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </IconButton>
            <IconButton
              size="sm"
              disabled={!workbook?.canRedo}
              onClick={() => {
                controller.redo();
                refreshState();
              }}
              title="Ripristina (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </IconButton>
          </>
        }
        centerContent={
          workbook && (
            <ViewSwitcher
              items={[
                { id: 'outliner', label: 'Outliner', icon: <ListTree className="w-3.5 h-3.5" /> },
                { id: 'map', label: 'Mappa Concettuale', icon: <Network className="w-3.5 h-3.5" /> },
              ]}
              activeId={viewMode}
              onChange={(id) => setViewMode(id as 'outliner' | 'map')}
            />
          )
        }
        rightContent={
          <>
            {workbook && (
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-2.5 opacity-40 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cerca nodi o formule..."
                  className="w-40 focus:w-56 transition-all pl-8 pr-2.5 py-1 text-xs rounded-lg border border-adw-cardBorder bg-white/70 dark:bg-black/20 focus:outline-none focus:ring-1 focus:ring-adw-accent"
                />
              </div>
            )}
            {workbook && (
              <>
                <IconButton
                  size="sm"
                  title="Importa Outline"
                  onClick={() => setImportModalOpen(true)}
                >
                  <Upload className="w-4 h-4" />
                </IconButton>
                <IconButton
                  size="sm"
                  title="Esporta (Markdown, OPML, Outline)"
                  onClick={() => setExportModalOpen(true)}
                >
                  <Share2 className="w-4 h-4" />
                </IconButton>
              </>
            )}
            <IconButton
              size="sm"
              title="Cambia Tema"
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </IconButton>
          </>
        }
        showWindowControls={isElectron}
        windowControlProps={
          isElectron
            ? {
                onMinimize: () => window.electronAPI?.minimize(),
                onMaximize: () => window.electronAPI?.maximize(),
                onClose: () => window.electronAPI?.close(),
                isMaximized: isWindowMaximized,
              }
            : undefined
        }
      />

      {/* Area Principale di Lavoro */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {!workbook ? (
          <EmptyState
            onOpenFile={handleOpenLocalFile}
            onNewFile={handleNewMap}
            onLoadDemo={handleLoadDemo}
            onDropFiles={async (file) => {
              const buffer = await file.arrayBuffer();
              const dto = await controller.open(new Uint8Array(buffer), file.name);
              setWorkbook(dto);
              setActiveSheetIndex(0);
              addToast('success', `Aperto ${file.name}`);
            }}
          />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Vista Selezionata */}
            {viewMode === 'outliner' ? (
              <Outliner
                topics={allTopics}
                searchQuery={searchQuery}
                onSelectTopic={(t) => setSelectedTopicId(t.id)}
                onAddChild={handleAddChild}
                onOpenLatex={openLatexModal}
                onOpenDetails={openDetailsModal}
                selectedTopicId={selectedTopicId}
                collapsedIds={collapsedIds}
                onToggleCollapse={handleToggleCollapse}
                resourceResolver={(src) => controller.resourceBytes(src)}
              />
            ) : (
              <MapView
                layout={currentLayout}
                selectedTopicId={selectedTopicId}
                onSelectTopic={(id) => setSelectedTopicId(id)}
                onOpenDetails={(id) => {
                  const t = allTopics.find((x) => x.id === id);
                  if (t) openDetailsModal(t);
                }}
                onOpenLatex={openLatexModal}
                onAddChild={handleAddChild}
                onToggleCollapse={handleToggleCollapse}
                resourceResolver={(src) => controller.resourceBytes(src)}
              />
            )}

            {/* Schede Fogli (Se ce ne sono più di uno) */}
            {workbook.sheets.length > 1 && (
              <div className="h-9 border-t border-adw-cardBorder bg-adw-card flex items-center px-3 space-x-1 overflow-x-auto text-xs font-medium">
                {workbook.sheets.map((sheet, idx) => (
                  <button
                    key={sheet.id || idx}
                    type="button"
                    onClick={() => setActiveSheetIndex(idx)}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      idx === activeSheetIndex
                        ? 'bg-adw-accent text-white font-semibold'
                        : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {sheet.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modale Formula LaTeX */}
      <LatexModal
        isOpen={latexModalOpen}
        onClose={() => setLatexModalOpen(false)}
        topicId={latexTargetTopicId}
        currentTitle={allTopics.find((t) => t.id === latexTargetTopicId)?.title}
        initialLatex={allTopics.find((t) => t.id === latexTargetTopicId)?.latex}
        onApply={async (topicId, latex, options) => {
          try {
            const updated = await controller.apply(topicId, latex, {
              titleMode: options.titleMode,
              color: options.color,
            });
            setWorkbook(updated);
            addToast('success', 'Equazione applicata con successo');
          } catch (err: any) {
            addToast('error', `Errore applicazione equazione: ${err.message}`);
          }
        }}
        onRemove={(topicId) => {
          const updated = controller.removeEquation(topicId);
          setWorkbook(updated);
          addToast('info', 'Equazione rimossa');
        }}
      />

      {/* Modale Dettagli Blocco */}
      <TopicDetailsModal
        isOpen={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        topic={detailsTargetTopic}
        onSave={(updates) => {
          if (!detailsTargetTopic) return;
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
        }}
        onOpenLatex={openLatexModal}
        onDeleteTopic={(topicId) => {
          const updated = controller.removeTopic(topicId);
          setWorkbook(updated);
          addToast('info', 'Blocco eliminato');
        }}
      />

      {/* Modale Esporta */}
      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        getExportContent={(fmt) => controller.export(fmt)}
      />

      {/* Modale Importa */}
      <ImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={async (fmt, text, asNewSheet) => {
          try {
            const updated = await controller.importOutline(fmt, text, { asNewSheet });
            setWorkbook(updated);
            addToast('success', 'Outline importato con successo');
          } catch (err: any) {
            addToast('error', `Errore durante l'importazione: ${err.message}`);
          }
        }}
      />

      {/* Container Notifiche Toast */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};
