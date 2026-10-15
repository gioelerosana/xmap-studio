import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HeaderBar,
  ViewSwitcher,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Modal,
  Separator,
  ToastContainer,
  ToastMessage,
} from '@xmap/ui-kit';
import {
  AppController,
  Layout,
  TopicView,
  WorkbookDto,
  buildArchiveBytes,
  sha256HexAsync,
  RawArchive,
} from '@xmap/core';
import {
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Moon,
  Sun,
  ListTree,
  Network,
  MoreVertical,
  FileDown,
  FileUp,
  Sigma,
  Paperclip,
  Merge,
  Split,
  Trash2,
  Info,
  PanelRight,
} from 'lucide-react';
import {
  openLocalXmindFile,
  saveLocalXmindFile,
  pickAnyFile,
  saveBytes,
  downloadBlob,
} from './adapters/fileSystem.js';
import { Sidebar } from './components/Sidebar.js';
import { MapView } from './components/MapView.js';
import { OutlineView } from './components/OutlineView.js';
import { AppMark } from './components/AppMark.js';
import { Inspector } from './components/Inspector.js';
import { ExportModal } from './components/ExportModal.js';
import { ImportModal } from './components/ImportModal.js';
import { EmptyState } from './components/EmptyState.js';
import { DropPlacement, TopicFilter } from './components/TopicTree.js';

declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: () => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFile: (options?: { description?: string; extensions?: string[] }) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      saveFileDialog: (suggestedName?: string) => Promise<string | null>;
      saveBytes: (suggestedName: string, bytes: number[], options?: { description?: string; extensions?: string[] }) => Promise<{ path: string } | null>;
      saveAtomic: (
        filePath: string,
        bytes: number[],
        expectedHash?: string
      ) => Promise<{ backup?: string; bytes: number }>;
      checkXMindRunning: () => Promise<string[]>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      forceClose: () => void;
      isMaximized: () => Promise<boolean>;
      getInitialFile: () => Promise<string | null>;
      onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
      onBeforeClose: (callback: () => void) => () => void;
    };
  }
}

type CloseAction = null | 'confirm';
type ReplacementAction = 'save' | 'discard' | 'cancel';

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80) || 'mappa'
  );
}

export const App: React.FC = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
  const [controller] = useState(() => new AppController());
  const [workbook, setWorkbook] = useState<WorkbookDto | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'map' | 'outline'>('map');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<TopicFilter>('all');
  const [darkMode, setDarkMode] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [pendingReplacement, setPendingReplacement] = useState<(() => Promise<void>) | null>(null);
  const [replacePrompt, setReplacePrompt] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [busy, setBusy] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [closePrompt, setClosePrompt] = useState<CloseAction>(null);

  const addToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshState = useCallback(() => {
    setWorkbook(controller.workbook());
  }, [controller]);

  const resolveResource = useCallback(
    (src: string) => controller.resourceBytes(src),
    [controller]
  );

  const requestWorkbookReplacement = useCallback(
    async (replace: () => Promise<void>) => {
      if (controller.isDirty()) {
        setPendingReplacement(() => replace);
        setReplacePrompt(true);
        return;
      }
      await replace();
    },
    [controller]
  );

  const currentSheet = workbook?.sheets[activeSheetIndex];
  const allTopics = useMemo(() => currentSheet?.topics || [], [currentSheet]);
  const selectedTopic = useMemo(
    () => allTopics.find((t) => t.id === selectedTopicId) || null,
    [allTopics, selectedTopicId]
  );

  const currentLayout = useMemo<Layout | null>(() => {
    if (!workbook || viewMode !== 'map') return null;
    return controller.mapLayout(activeSheetIndex, collapsedIds);
  }, [controller, workbook, activeSheetIndex, viewMode, collapsedIds]);

  const outlineText = useMemo(() => {
    if (!workbook || viewMode !== 'outline') return '';
    return controller.export('outline');
  }, [controller, workbook, viewMode, activeSheetIndex]);

  // Tema
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Finestra massimizzata
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    window.electronAPI.isMaximized().then(setIsWindowMaximized);
    return window.electronAPI.onMaximizedChange(setIsWindowMaximized);
  }, [isElectron]);

  const openFromPath = useCallback(
    async (filePath: string) => {
      if (!window.electronAPI) return;
      const res = await window.electronAPI.openFilePath(filePath);
      if (!res) return;
      try {
        await requestWorkbookReplacement(async () => {
          const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
          setWorkbook(dto);
          setFileHandle(undefined);
          setActiveSheetIndex(0);
          setCollapsedIds(new Set());
          setSelectedTopicId(undefined);
          addToast('success', `Aperto: ${res.name}`);
        });
      } catch (err: any) {
        addToast('error', `Errore apertura file: ${err.message || String(err)}`);
      }
    },
    [controller, addToast, requestWorkbookReplacement]
  );

  // File iniziale + aperture successive (Electron)
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    void window.electronAPI.getInitialFile().then((p) => {
      if (p) void openFromPath(p);
    });
  }, [isElectron, openFromPath]);

  const handleOpenLocalFile = useCallback(async () => {
    try {
      if (isElectron && window.electronAPI) {
        const res = await window.electronAPI.openFileDialog();
        if (!res) return;
        await requestWorkbookReplacement(async () => {
          const dto = await controller.open(new Uint8Array(res.bytes), res.path, res.name);
          setWorkbook(dto);
          setFileHandle(undefined);
          setActiveSheetIndex(0);
          setCollapsedIds(new Set());
          setSelectedTopicId(undefined);
          addToast('success', `Mappa aperta: ${res.name}`);
        });
        return;
      }

      const res = await openLocalXmindFile();
      if (!res) return;
      await requestWorkbookReplacement(async () => {
        const dto = await controller.open(res.data, res.name, res.name);
        setWorkbook(dto);
        setFileHandle(res.handle);
        setActiveSheetIndex(0);
        setCollapsedIds(new Set());
        setSelectedTopicId(undefined);
        addToast('success', `Mappa aperta: ${res.name}`);
      });
    } catch (err: any) {
      addToast('error', `Errore apertura file: ${err.message || String(err)}`);
    }
  }, [controller, isElectron, addToast, requestWorkbookReplacement]);

  const handleLoadDemo = async () => {
    try {
      const response = await fetch('/demo.xmind');
      if (!response.ok) throw new Error('File demo non reperibile');
      const buffer = await response.arrayBuffer();
      await requestWorkbookReplacement(async () => {
        const dto = await controller.open(new Uint8Array(buffer), 'Relazioni.xmap-studio.xmind');
        setWorkbook(dto);
        setFileHandle(undefined);
        setActiveSheetIndex(0);
        setCollapsedIds(new Set());
        setSelectedTopicId(undefined);
        addToast('info', 'Mappa demo caricata');
      });
    } catch (err: any) {
      addToast('error', `Impossibile caricare la demo: ${err.message}`);
    }
  };

  const handleNewMap = async () => {
    const blank = JSON.stringify([
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
    const raw: RawArchive = {
      entries: new Map([
        ['content.json', enc.encode(blank)],
        ['manifest.json', enc.encode(JSON.stringify({ 'file-entries': { 'content.json': {} } }))],
        ['metadata.json', enc.encode(JSON.stringify({ creator: { name: 'XMap Studio' } }))],
      ]),
      resources: new Map(),
    };
    const bytes = await buildArchiveBytes(raw);
    await requestWorkbookReplacement(async () => {
      const dto = await controller.open(bytes, 'senza_titolo.xmind');
      setWorkbook(dto);
      setFileHandle(undefined);
      setActiveSheetIndex(0);
      setCollapsedIds(new Set());
      setSelectedTopicId(undefined);
      addToast('success', 'Nuova mappa creata');
    });
  };

  const writeWorkbook = useCallback(
    async (force: boolean, saveAs: boolean): Promise<boolean> => {
      if (!workbook) return false;
      setBusy(true);
      try {
        if (!force && isElectron && window.electronAPI) {
          const running = await window.electronAPI.checkXMindRunning();
          if (running.length > 0) {
            const proceed = confirm(
              `XMind è in esecuzione (${running.join(', ')}). Salvando adesso il file potrebbe essere sovrascritto o corrotto.\n\nForzare il salvataggio?`
            );
            if (!proceed) {
              addToast('warning', 'Salvataggio annullato.');
              return false;
            }
          }
        }

        const { bytes, validation } = await controller.prepareArchiveBytes();
        const hasDesktopPath =
          isElectron && workbook.path !== 'senza_titolo.xmind' && workbook.path.includes('/');
        const expectedHash =
          !saveAs && (hasDesktopPath || Boolean(fileHandle))
            ? controller.expectedFileHash()
            : undefined;
        const contentHash = await sha256HexAsync(bytes);

        if (isElectron && window.electronAPI) {
          let savePath = workbook.path;
          if (saveAs || !savePath || savePath === 'senza_titolo.xmind' || !savePath.includes('/')) {
            const selected = await window.electronAPI.saveFileDialog(workbook.fileName || 'mappa.xmind');
            if (!selected) return false;
            savePath = selected;
          }
          await window.electronAPI.saveAtomic(savePath, Array.from(bytes), expectedHash);
          controller.markSaved(savePath, contentHash);
          refreshState();
          addToast('success', `Salvato (${bytes.length.toLocaleString('it-IT')} byte)`);
          return true;
        }

        const handle = await saveLocalXmindFile(
          bytes,
          workbook.fileName || 'mappa.xmind',
          saveAs ? undefined : fileHandle,
          expectedHash
        );
        if (handle) setFileHandle(handle);
        controller.markSaved(undefined, contentHash);
        refreshState();
        addToast('success', `Mappa salvata (${validation.resourceRefs} risorse registrate)`);
        return true;
      } catch (err: any) {
        addToast('error', `Errore durante il salvataggio: ${err.message}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [workbook, controller, fileHandle, isElectron, addToast, refreshState]
  );

  const handleSave = useCallback(async () => {
    if (!workbook) return;
    if (!workbook.dirty) {
      addToast('info', 'Nessuna modifica da salvare.');
      return;
    }
    await writeWorkbook(false, false);
  }, [workbook, writeWorkbook, addToast]);

  const handleSaveAs = useCallback(async () => {
    if (!workbook) return;
    await writeWorkbook(false, true);
  }, [workbook, writeWorkbook]);

  const handleConfirmReplacement = async (action: ReplacementAction) => {
    if (action === 'cancel') {
      setReplacePrompt(false);
      setPendingReplacement(null);
      return;
    }
    if (action === 'save') {
      const ok = await writeWorkbook(false, false);
      if (!ok) return;
    }
    const replace = pendingReplacement;
    setReplacePrompt(false);
    setPendingReplacement(null);
    try {
      await replace?.();
    } catch (err: any) {
      addToast('error', `Impossibile aprire la mappa: ${err.message || String(err)}`);
    }
  };

  // Scorciatoie da tastiera
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        e.shiftKey ? controller.redo() : controller.undo();
        refreshState();
      } else if (key === 'y') {
        e.preventDefault();
        controller.redo();
        refreshState();
      } else if (key === 's') {
        e.preventDefault();
        e.shiftKey ? handleSaveAs() : handleSave();
      } else if (key === 'o') {
        e.preventDefault();
        handleOpenLocalFile();
      } else if (key === 'm') {
        e.preventDefault();
        setViewMode('map');
      } else if (e.shiftKey && key === 'n') {
        e.preventDefault();
        if (selectedTopic) handleAddChild(selectedTopic.id);
        else if (allTopics[0]) handleAddChild(allTopics[0].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, refreshState, handleSave, handleSaveAs, handleOpenLocalFile, selectedTopic, allTopics]);

  // Chiusura con modifiche non salvate
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [controller]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    return window.electronAPI.onBeforeClose(() => {
      if (controller.isDirty()) setClosePrompt('confirm');
      else window.electronAPI?.forceClose();
    });
  }, [isElectron, controller]);

  const handleToggleCollapse = useCallback((topicId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(topicId) ? next.delete(topicId) : next.add(topicId);
      return next;
    });
  }, []);

  const handleAddChild = useCallback(
    (parentId: string) => {
      try {
        const { newId } = controller.addTopic(parentId, 'Nuovo blocco');
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
        setSelectedTopicId(newId);
        refreshState();
      } catch (err: any) {
        addToast('error', err.message);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleMove = useCallback(
    (id: string, targetId: string, placement: DropPlacement) => {
      try {
        controller.moveTopic(id, targetId, placement);
        refreshState();
        addToast('success', 'Blocco spostato');
      } catch (err: any) {
        addToast('error', `Spostamento non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleExportEquation = async (format: 'svg' | 'png') => {
    if (!selectedTopic || selectedTopic.kind !== 'equation') return;
    try {
      const { bytes, mime, extension } = await controller.exportEquation(selectedTopic.id, format);
      const base = sanitizeName(selectedTopic.title || controller.mapTitle() || 'equazione');
      await saveBytes(bytes, `${base}.${extension}`, mime, {
        description: format.toUpperCase(),
        extensions: [extension],
      });
      addToast('success', `Equazione esportata in ${format.toUpperCase()}`);
    } catch (err: any) {
      addToast('error', `Esportazione non riuscita: ${err.message}`);
    }
  };

  const handleAttach = async () => {
    if (!selectedTopic) return;
    try {
      const picked = await pickAnyFile({ description: 'Tutti i file' });
      if (!picked) return;
      controller.attachFileToTopic(selectedTopic.id, picked.name, picked.bytes);
      refreshState();
      addToast('success', `Allegato: ${picked.name}`);
    } catch (err: any) {
      addToast('error', `Allegato non aggiunto: ${err.message}`);
    }
  };

  const handleMerge = async () => {
    if (!workbook) return;
    try {
      const picked = await pickAnyFile({ description: 'File XMind', extensions: ['xmind'] });
      if (!picked) return;
      const res = await controller.mergeWorkbook(picked.bytes);
      refreshState();
      addToast('success', `Unite ${res.addedSheets} mappe (${res.addedTopics} blocchi)`);
    } catch (err: any) {
      addToast('error', `Unione non riuscita: ${err.message}`);
    }
  };

  const handleSplit = async () => {
    if (!selectedTopic || selectedTopic.depth === 0) {
      addToast('warning', 'Seleziona un blocco non radice da estrarre.');
      return;
    }
    try {
      const bytes = await controller.splitTopic(selectedTopic.id);
      const base = sanitizeName(selectedTopic.title || 'mappa');
      const saved = await saveBytes(bytes, `${base}.xmind`, 'application/vnd.xmind.workbook', {
        description: 'File XMind',
        extensions: ['xmind'],
      });
      if (!saved) return;
      addToast('success', 'Ramo estratto in una nuova mappa');
    } catch (err: any) {
      addToast('error', `Estrazione non riuscita: ${err.message}`);
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedTopic || selectedTopic.depth === 0) return;
    if (!confirm(`Eliminare «${selectedTopic.displayTitle}» e i suoi sotto-blocchi?`)) return;
    try {
      controller.removeTopic(selectedTopic.id);
      setSelectedTopicId(undefined);
      refreshState();
      addToast('info', 'Blocco eliminato');
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  const handleConfirmClose = async (action: 'save' | 'discard' | 'cancel') => {
    if (action === 'cancel') {
      setClosePrompt(null);
      return;
    }
    if (action === 'save') {
      const ok = await writeWorkbook(false, false);
      if (!ok) return;
    }
    window.electronAPI?.forceClose();
  };

  const menuItems: MenuItem[] = workbook
    ? [
        { id: 'save-as', label: 'Salva con nome…', icon: <Save className="size-4" />, shortcut: 'Ctrl+Shift+S', onSelect: handleSaveAs },
        { id: 'export', label: 'Esporta Markdown / OPML…', icon: <FileDown className="size-4" />, separatorBefore: true, onSelect: () => setExportModalOpen(true) },
        { id: 'import', label: 'Importa Markdown / OPML…', icon: <FileUp className="size-4" />, onSelect: () => setImportModalOpen(true) },
        {
          id: 'export-svg',
          label: 'Esporta equazione SVG',
          icon: <Sigma className="size-4" />,
          separatorBefore: true,
          disabled: selectedTopic?.kind !== 'equation',
          onSelect: () => handleExportEquation('svg'),
        },
        {
          id: 'export-png',
          label: 'Esporta equazione PNG',
          icon: <Sigma className="size-4" />,
          disabled: selectedTopic?.kind !== 'equation',
          onSelect: () => handleExportEquation('png'),
        },
        { id: 'attach', label: 'Allega file…', icon: <Paperclip className="size-4" />, separatorBefore: true, disabled: !selectedTopic, onSelect: handleAttach },
        { id: 'merge', label: 'Unisci una mappa…', icon: <Merge className="size-4" />, onSelect: handleMerge },
        { id: 'split', label: 'Estrai ramo come mappa…', icon: <Split className="size-4" />, disabled: !selectedTopic || selectedTopic.depth === 0, onSelect: handleSplit },
        {
          id: 'delete',
          label: 'Elimina blocco',
          icon: <Trash2 className="size-4" />,
          danger: true,
          separatorBefore: true,
          disabled: !selectedTopic || selectedTopic.depth === 0,
          onSelect: handleDeleteSelected,
        },
        { id: 'theme', label: darkMode ? 'Tema chiaro' : 'Tema scuro', icon: darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />, separatorBefore: true, onSelect: () => setDarkMode((v) => !v) },
        { id: 'about', label: 'Informazioni', icon: <Info className="size-4" />, onSelect: () => setAboutOpen(true) },
      ]
    : [
        { id: 'theme', label: darkMode ? 'Tema chiaro' : 'Tema scuro', icon: darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />, onSelect: () => setDarkMode((v) => !v) },
        { id: 'about', label: 'Informazioni', icon: <Info className="size-4" />, onSelect: () => setAboutOpen(true) },
      ];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground select-none">
      <HeaderBar
        title={workbook ? controller.mapTitle() || workbook.fileName : 'XMap Studio'}
        subtitle={workbook?.dirty ? 'Modifiche non salvate' : undefined}
        leftContent={
          <>
            <Button variant="ghost" size="sm" icon={<FolderOpen className="size-4" />} onClick={handleOpenLocalFile} title="Apri (Ctrl+O)">
              Apri
            </Button>
            <Button
              variant={workbook?.dirty ? 'default' : 'ghost'}
              size="sm"
              icon={<Save className="size-4" />}
              disabled={!workbook || busy}
              onClick={handleSave}
              title="Salva (Ctrl+S)"
            >
              Salva
            </Button>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <IconButton size="sm" disabled={!workbook?.canUndo} onClick={() => { controller.undo(); refreshState(); }} label="Annulla (Ctrl+Z)">
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton size="sm" disabled={!workbook?.canRedo} onClick={() => { controller.redo(); refreshState(); }} label="Ripeti (Ctrl+Shift+Z)">
              <Redo2 className="size-4" />
            </IconButton>
          </>
        }
        centerContent={
          workbook && (
            <ViewSwitcher
              items={[
                { id: 'map', label: 'Mappa', icon: <Network className="size-4" /> },
                { id: 'outline', label: 'Outliner', icon: <ListTree className="size-4" /> },
              ]}
              activeId={viewMode}
              onChange={(id) => setViewMode(id as 'map' | 'outline')}
              size="sm"
            />
          )
        }
        rightContent={
          <>
            {workbook && (
              <IconButton
                size="sm"
                active={Boolean(selectedTopicId)}
                disabled={!workbook}
                onClick={() => {
                  if (selectedTopicId) setSelectedTopicId(undefined);
                  else if (allTopics[0]) setSelectedTopicId(allTopics[0].id);
                }}
                label={selectedTopicId ? 'Chiudi pannello dettagli' : 'Apri pannello dettagli'}
              >
                <PanelRight className="size-4" />
              </IconButton>
            )}
            <IconButton size="sm" onClick={() => setDarkMode((v) => !v)} label="Cambia tema">
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconButton>
            <Menu items={menuItems} widthClass="w-72" trigger={
              <IconButton size="sm" label="Menu">
                <MoreVertical className="size-4" />
              </IconButton>
            } />
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

      <main className="flex-1 flex overflow-hidden">
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
              setCollapsedIds(new Set());
              setSelectedTopicId(undefined);
              addToast('success', `Aperto ${file.name}`);
            }}
          />
        ) : (
          <>
            <Sidebar
              topics={allTopics}
              searchQuery={searchQuery}
              onSearch={setSearchQuery}
              filter={filter}
              onFilter={setFilter}
              selectedTopicId={selectedTopicId}
              collapsedIds={collapsedIds}
              onSelect={setSelectedTopicId}
              onToggleCollapse={handleToggleCollapse}
              onAddChild={handleAddChild}
              onAddRootChild={() => allTopics[0] && handleAddChild(allTopics[0].id)}
              onMove={handleMove}
            />

            <div className="flex-1 flex flex-col overflow-hidden">
              {viewMode === 'map' ? (
                <MapView
                  layout={currentLayout}
                  selectedTopicId={selectedTopicId}
                  onSelectTopic={setSelectedTopicId}
                  onOpenDetails={(id) => setSelectedTopicId(id)}
                  onOpenLatex={(id) => setSelectedTopicId(id)}
                  onAddChild={handleAddChild}
                  onDeleteTopic={handleDeleteSelected}
                  onToggleCollapse={handleToggleCollapse}
                  resourceResolver={resolveResource}
                  darkMode={darkMode}
                />
              ) : (
                <OutlineView text={outlineText} />
              )}

              {workbook.sheets.length > 1 && (
                <div className="h-9 shrink-0 border-t bg-sidebar flex items-center gap-1 px-2 overflow-x-auto">
                  {workbook.sheets.map((sheet, idx) => (
                    <Button
                      key={sheet.id || idx}
                      size="xs"
                      variant={idx === activeSheetIndex ? 'ghost' : 'ghost-muted'}
                      className={idx === activeSheetIndex ? 'bg-sidebar-row-active shadow-control text-foreground font-medium' : undefined}
                      onClick={() => {
                        setActiveSheetIndex(idx);
                        setSelectedTopicId(undefined);
                      }}
                    >
                      {sheet.title}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {selectedTopicId && (
              <Inspector
                topic={selectedTopic}
                allTopics={allTopics}
                relationships={currentSheet?.relationships || []}
                controller={controller}
                onChanged={refreshState}
                onClose={() => setSelectedTopicId(undefined)}
                darkMode={darkMode}
                onToast={addToast}
              />
            )}
          </>
        )}
      </main>

      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        getExportContent={(fmt) => controller.export(fmt)}
        suggestedBase={sanitizeName(controller.mapTitle() || 'mappa')}
      />
      <ImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={async (fmt, text, asNewSheet) => {
          try {
            await controller.importOutline(fmt, text, { asNewSheet });
            refreshState();
            addToast('success', 'Outline importato');
          } catch (err: any) {
            addToast('error', `Import non riuscito: ${err.message}`);
          }
        }}
      />

      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} title="XMap Studio" size="sm">
        <div className="flex flex-col gap-3">
          <AppMark size={40} />
          <p className="text-sm text-muted-foreground">
            Editor per mappe XMind con equazioni LaTeX native. Lossless, offline, scrittura atomica e validata.
          </p>
          <p className="text-2xs text-muted-foreground font-mono">Versione 2.0 — TypeScript / React</p>
        </div>
      </Modal>

      <Modal
        isOpen={closePrompt === 'confirm'}
        onClose={() => setClosePrompt(null)}
        title="Salvare le modifiche?"
        description="Ci sono modifiche non salvate. Se chiudi senza salvare andranno perse."
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => handleConfirmClose('cancel')}>Annulla</Button>
            <Button variant="destructive-outline" onClick={() => handleConfirmClose('discard')}>Non salvare</Button>
            <Button variant="default" onClick={() => handleConfirmClose('save')}>Salva</Button>
          </div>
        }
      >
        <span />
      </Modal>

      <Modal
        isOpen={replacePrompt}
        onClose={() => void handleConfirmReplacement('cancel')}
        title="Salvare prima di aprire un’altra mappa?"
        description="Le modifiche non salvate andranno perse se sostituisci la mappa aperta."
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => void handleConfirmReplacement('cancel')}>Annulla</Button>
            <Button variant="destructive-outline" onClick={() => void handleConfirmReplacement('discard')}>Non salvare</Button>
            <Button variant="default" onClick={() => void handleConfirmReplacement('save')}>Salva</Button>
          </div>
        }
      >
        <span />
      </Modal>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};
