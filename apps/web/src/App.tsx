import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  cn,
} from '@xmap/ui-kit';
import {
  AppController,
  Layout,
  Point,
  TopicView,
  WorkbookDto,
  buildArchiveBytes,
  sha256HexAsync,
  RawArchive,
  MapStructure,
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
  PanelLeft,
} from 'lucide-react';
import {
  openLocalXmindFile,
  saveLocalXmindFile,
  pickAnyFile,
  saveBytes,
  confirmForceSave,
  downloadBlob,
} from './adapters/fileSystem.js';
import { Sidebar } from './components/Sidebar.js';
import { MapView, type MapEditing } from './components/MapView.js';
import type { EditExit } from './components/map/NodeEditor.js';
import { neighborId, selectionAfterDelete } from './components/map/navigation.js';
import { OutlineView } from './components/OutlineView.js';
import { AppMark } from './components/AppMark.js';
import { Inspector } from './components/Inspector.js';
import { INSPECTOR_PANEL, SIDEBAR_PANEL, usePanelWidth } from './components/usePanelWidth.js';
import { ExportModal } from './components/ExportModal.js';
import { ImportModal } from './components/ImportModal.js';
import { EmptyState } from './components/EmptyState.js';
import { DropPlacement, TopicFilter } from './components/TopicTree.js';

const TEXT_FIELD = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
const INTERACTIVE = `${TEXT_FIELD},button,a,[role="button"],[role="menuitem"],[role="dialog"]`;

declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: () => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFile: (options?: { description?: string; extensions?: string[] }) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      saveFileDialog: (suggestedName?: string) => Promise<string | null>;
      saveBytes: (
        suggestedName: string,
        bytes: number[],
        options?: { description?: string; extensions?: string[]; targetPath?: string; force?: boolean }
      ) => Promise<
        | { path: string }
        | { ok: false; code: string; message: string; processes?: string[]; path: string }
        | null
      >;
      saveAtomic: (
        filePath: string,
        bytes: number[],
        options?: { expectedHash?: string; force?: boolean }
      ) => Promise<
        | { ok: true; backup?: string; bytes: number }
        | { ok: false; code: string; message: string; processes?: string[] }
      >;
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

const MAP_STRUCTURE_KEY = 'xmap-studio.map-structure';
const COMPACT_QUERY = '(max-width: 639px)';
const WIDE_QUERY = '(min-width: 1024px)';
const SIDEBAR_KEY = 'xmap-studio.sidebar';
/** Livelli di compattazione dell'header: da questo livello in poi l'elemento va nel menu. */
const HEADER_LEVEL = { iconsOnly: 1, redoTheme: 2, title: 3, undo: 4, open: 5, views: 6, max: 6 } as const;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return Boolean(matches);
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
  // Sotto lg la sidebar è un drawer, chiuso di default.
  // Nascosta di default per lasciare spazio alla mappa; su desktop si ricorda la scelta.
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.(WIDE_QUERY).matches &&
      window.localStorage?.getItem(SIDEBAR_KEY) === 'open'
  );
  const [sidebarWidth, setSidebarWidth] = usePanelWidth(
    SIDEBAR_PANEL.storageKey,
    SIDEBAR_PANEL.defaultWidth,
    SIDEBAR_PANEL.min,
    SIDEBAR_PANEL.max,
  );
  const [inspectorWidth, setInspectorWidth] = usePanelWidth(
    INSPECTOR_PANEL.storageKey,
    INSPECTOR_PANEL.defaultWidth,
    INSPECTOR_PANEL.min,
    INSPECTOR_PANEL.max,
    sidebarOpen ? sidebarWidth : 0,
  );
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      if (window.matchMedia(WIDE_QUERY).matches) window.localStorage?.setItem(SIDEBAR_KEY, open ? 'closed' : 'open');
      return !open;
    });
  }, []);
  // Smartphone: il tap seleziona soltanto, il pannello dettagli (bottom sheet)
  // si apre su richiesta per non coprire la mappa a ogni tocco.
  const compact = useMediaQuery(COMPACT_QUERY);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const inspectorVisible = Boolean(selectedTopicId) && (!compact || detailsOpen);

  // Header adattivo: se i pulsanti non ci stanno si sale di livello e le azioni
  // meno usate passano nel menu ⋮ (vedi HEADER_LEVEL). Si misura lo spazio reale,
  // non la viewport: conta anche la dimensione del testo impostata nel sistema.
  const headerRef = useRef<HTMLElement>(null);
  const [headerLevel, setHeaderLevel] = useState(0);
  const [, forceHeaderMeasure] = useReducer((n: number) => n + 1, 0);
  const hasWorkbook = Boolean(workbook);
  // Cambiano i pulsanti presenti: si riparte dal livello pieno. Va prima della misura,
  // così i due aggiornamenti si compongono invece di annullarsi.
  useLayoutEffect(() => setHeaderLevel(0), [hasWorkbook]);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (el && el.scrollWidth > el.clientWidth + 1 && headerLevel < HEADER_LEVEL.max) {
      setHeaderLevel((l) => l + 1);
    }
  });
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let width = el.clientWidth;
    // Si osservano anche i gruppi interni: font caricati tardi o pulsanti che
    // cambiano possono creare overflow senza che l'header cambi larghezza.
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        setHeaderLevel(0);
      }
      forceHeaderMeasure();
    });
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, []);
  const showLabels = headerLevel < HEADER_LEVEL.iconsOnly;
  const inlineRedo = headerLevel < HEADER_LEVEL.redoTheme;
  const inlineUndo = headerLevel < HEADER_LEVEL.undo;
  const inlineOpen = headerLevel < HEADER_LEVEL.open;
  const inlineViews = headerLevel < HEADER_LEVEL.views;
  const showTitle = headerLevel < HEADER_LEVEL.title;
  useEffect(() => {
    if (!selectedTopicId) setDetailsOpen(false);
  }, [selectedTopicId]);
  const openDetails = useCallback((id: string) => {
    setSelectedTopicId(id);
    setDetailsOpen(true);
  }, []);
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
  const [editing, setEditing] = useState<(MapEditing & { isNew?: boolean }) | null>(null);

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

  // Solo visualizzazione: la struttura salvata nel file non cambia.
  const [mapStructure, setMapStructure] = useState<MapStructure>(() =>
    typeof window !== 'undefined' && window.localStorage?.getItem(MAP_STRUCTURE_KEY) === 'logic' ? 'logic' : 'tree'
  );
  useEffect(() => {
    window.localStorage?.setItem(MAP_STRUCTURE_KEY, mapStructure);
  }, [mapStructure]);

  const currentLayout = useMemo<Layout | null>(() => {
    if (!workbook || viewMode !== 'map') return null;
    return controller.mapLayout(activeSheetIndex, collapsedIds, mapStructure);
  }, [controller, workbook, activeSheetIndex, viewMode, collapsedIds, mapStructure]);

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
        const dto = await controller.open(res.data, undefined, res.name);
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
      const response = await fetch('demo.xmind');
      if (!response.ok) throw new Error('File demo non reperibile');
      const buffer = await response.arrayBuffer();
      await requestWorkbookReplacement(async () => {
        const dto = await controller.open(new Uint8Array(buffer), undefined, 'Relazioni.xmap-studio.xmind');
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
      const dto = await controller.open(bytes, undefined, 'senza_titolo.xmind');
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
        const { bytes, validation } = await controller.prepareArchiveBytes();
        const hasDesktopPath = isElectron && workbook.path !== null;
        const expectedHash =
          !saveAs && (hasDesktopPath || Boolean(fileHandle))
            ? controller.expectedFileHash()
            : undefined;
        const contentHash = await sha256HexAsync(bytes);

        if (isElectron && window.electronAPI) {
          let savePath = workbook.path;
          if (saveAs || !savePath) {
            const selected = await window.electronAPI.saveFileDialog(workbook.fileName || 'mappa.xmind');
            if (!selected) return false;
            savePath = selected;
          }
          const payload = Array.from(bytes);
          let outcome = await window.electronAPI.saveAtomic(savePath, payload, { expectedHash, force });
          if (!outcome.ok && outcome.code === 'xmind_running') {
            if (!confirmForceSave(outcome.processes ?? [])) {
              addToast('warning', 'Salvataggio annullato.');
              return false;
            }
            outcome = await window.electronAPI.saveAtomic(savePath, payload, { expectedHash, force: true });
          }
          if (!outcome.ok) {
            addToast('error', `Errore durante il salvataggio: ${outcome.message}`);
            return false;
          }
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

  // Undo/redo: la selezione resta se il blocco esiste ancora, altrimenti risale al genitore.
  const doUndoRedo = useCallback(
    (kind: 'undo' | 'redo') => {
      const parentOf = new Map(allTopics.map((t) => [t.id, t.parentId]));
      kind === 'undo' ? controller.undo() : controller.redo();
      const dto = controller.workbook();
      const alive = new Set(dto?.sheets[activeSheetIndex]?.topics.map((t) => t.id));
      let cur = selectedTopicId;
      while (cur && !alive.has(cur)) cur = parentOf.get(cur);
      setSelectedTopicId(cur);
      setEditing(null);
      refreshState();
    },
    [controller, allTopics, activeSheetIndex, selectedTopicId, refreshState]
  );

  // Scorciatoie da tastiera
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const inField = (e.target as Element | null)?.closest?.(TEXT_FIELD);
      if (key === 'z' || key === 'y') {
        // In un campo di testo vale l'undo nativo del campo.
        if (inField) return;
        e.preventDefault();
        doUndoRedo(key === 'y' || e.shiftKey ? 'redo' : 'undo');
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
  }, [controller, doUndoRedo, handleSave, handleSaveAs, handleOpenLocalFile, selectedTopic, allTopics]);

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
        setDetailsOpen(true);
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

  const handleMoveFloating = useCallback(
    (id: string, position: Point) => {
      try {
        controller.setTopicPosition(id, position);
        refreshState();
      } catch (err: any) {
        addToast('error', `Spostamento non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleRelationshipControlPoint = useCallback(
    (relationshipId: string, points: [Point | null | undefined, Point | null | undefined]) => {
      try {
        controller.setRelationshipControlPoints(relationshipId, points);
        refreshState();
      } catch (err: any) {
        addToast('error', `Relazione non modificata: ${err.message}`);
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
    try {
      const next = currentLayout ? selectionAfterDelete(currentLayout, selectedTopic.id) : undefined;
      controller.removeTopic(selectedTopic.id);
      setSelectedTopicId(next);
      setEditing(null);
      refreshState();
      addToast('info', 'Blocco eliminato — Ctrl+Z per annullare');
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  // Nuovo blocco da tastiera o dalla mappa: si seleziona ed entra subito in editing in place.
  const createTopic = useCallback(
    (anchorId: string, kind: 'child' | 'after' | 'before') => {
      try {
        const { newId } =
          kind === 'child'
            ? controller.addTopic(anchorId, 'Nuovo blocco')
            : controller.addSiblingTopic(anchorId, 'Nuovo blocco', kind);
        // Il genitore collassato va espanso (per i fratelli il genitore non cambia, ma è innocuo).
        setCollapsedIds((prev) => {
          if (!prev.has(anchorId)) return prev;
          const next = new Set(prev);
          next.delete(anchorId);
          return next;
        });
        setSelectedTopicId(newId);
        setEditing({ id: newId, mode: 'all', isNew: true });
        refreshState();
      } catch (err: any) {
        addToast('error', err.message);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleCommitEdit = (id: string, text: string, exit: EditExit) => {
    const isNew = editing?.id === id && editing.isNew;
    setEditing(null);
    const topic = allTopics.find((t) => t.id === id);
    try {
      if (topic && text.trim().length > 0 && text !== topic.title) {
        controller.setTopicTitle(id, text, { mergeWithPrevious: isNew });
        refreshState();
      }
    } catch (err: any) {
      addToast('error', err.message);
      return;
    }
    if (exit === 'tab') createTopic(id, 'child');
  };

  const startEdit = (id: string) => {
    const t = allTopics.find((x) => x.id === id);
    if (!t) return;
    if (t.kind !== 'text') openDetails(id);
    else setEditing({ id, mode: 'all' });
  };

  // Scorciatoie sulla mappa (stile XMind): solo con il focus fuori da campi e controlli, senza modali.
  const keyCtx = useRef({ startEdit, createTopic, handleDeleteSelected });
  keyCtx.current = { startEdit, createTopic, handleDeleteSelected };
  const mapKeysEnabled =
    viewMode === 'map' &&
    Boolean(workbook) &&
    !editing &&
    !exportModalOpen &&
    !importModalOpen &&
    !aboutOpen &&
    !replacePrompt &&
    !closePrompt &&
    !busy;
  useEffect(() => {
    if (!mapKeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;
      const sel = selectedTopic;
      if (!sel) return;
      const c = keyCtx.current;
      const go = (dir: 'up' | 'down' | 'left' | 'right') => {
        const id = currentLayout ? neighborId(currentLayout, sel.id, dir) : undefined;
        if (id) setSelectedTopicId(id);
      };
      switch (e.key) {
        case 'Tab':
          if (e.shiftKey) return;
          c.createTopic(sel.id, 'child');
          break;
        case 'Enter':
          c.createTopic(sel.id, e.shiftKey ? 'before' : 'after');
          break;
        case 'F2':
        case ' ':
          c.startEdit(sel.id);
          break;
        case 'Delete':
        case 'Backspace':
          if (sel.depth === 0) return;
          c.handleDeleteSelected();
          break;
        case 'ArrowUp': go('up'); break;
        case 'ArrowDown': go('down'); break;
        case 'ArrowLeft': go('left'); break;
        case 'ArrowRight': go('right'); break;
        case 'Escape':
          setSelectedTopicId(undefined);
          break;
        default:
          if (e.key.length !== 1 || sel.kind !== 'text') return;
          setEditing({ id: sel.id, mode: 'text', text: e.key });
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapKeysEnabled, selectedTopic, currentLayout]);

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

  // Azioni dell'header che non ci stanno: in testa al menu ⋮.
  const overflowItems: MenuItem[] = [
    ...(!inlineOpen ? [{ id: 'open', label: 'Apri…', icon: <FolderOpen className="size-4" />, onSelect: handleOpenLocalFile }] : []),
    ...(workbook && !inlineUndo
      ? [{ id: 'undo', label: 'Annulla', icon: <Undo2 className="size-4" />, disabled: !workbook.canUndo, onSelect: () => doUndoRedo('undo') }]
      : []),
    ...(workbook && !inlineRedo
      ? [{ id: 'redo', label: 'Ripeti', icon: <Redo2 className="size-4" />, disabled: !workbook.canRedo, onSelect: () => doUndoRedo('redo') }]
      : []),
    ...(workbook && !inlineViews
      ? [
          viewMode === 'map'
            ? { id: 'view-outline', label: 'Vista outliner', icon: <ListTree className="size-4" />, onSelect: () => setViewMode('outline') }
            : { id: 'view-map', label: 'Vista mappa', icon: <Network className="size-4" />, onSelect: () => setViewMode('map') },
        ]
      : []),
  ];

  const menuItems: MenuItem[] = workbook
    ? [
        ...overflowItems,
        { id: 'save-as', label: 'Salva con nome…', icon: <Save className="size-4" />, shortcut: 'Ctrl+Shift+S', separatorBefore: overflowItems.length > 0, onSelect: handleSaveAs },
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
        ...overflowItems,
        { id: 'theme', label: darkMode ? 'Tema chiaro' : 'Tema scuro', icon: darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />, separatorBefore: overflowItems.length > 0, onSelect: () => setDarkMode((v) => !v) },
        { id: 'about', label: 'Informazioni', icon: <Info className="size-4" />, onSelect: () => setAboutOpen(true) },
      ];

  return (
    <div className="flex flex-col h-dvh w-screen overflow-hidden bg-background text-foreground select-none">
      <HeaderBar
        title={showTitle ? (workbook ? controller.mapTitle() || workbook.fileName : 'XMap Studio') : undefined}
        subtitle={showTitle && workbook?.dirty ? 'Modifiche non salvate' : undefined}
        headerRef={headerRef}
        leftContent={
          <>
            {workbook && (
              <IconButton
                size="sm"
                active={sidebarOpen}
                onClick={toggleSidebar}
                label={sidebarOpen ? 'Nascondi elenco blocchi' : 'Mostra elenco blocchi'}
              >
                <PanelLeft className="size-4" />
              </IconButton>
            )}
            {inlineOpen && (
              <Button variant="ghost" size="sm" icon={<FolderOpen className="size-4" />} onClick={handleOpenLocalFile} title="Apri (Ctrl+O)">
                <span className={cn(!showLabels && 'sr-only')}>Apri</span>
              </Button>
            )}
            <Button
              variant={workbook?.dirty ? 'default' : 'ghost'}
              size="sm"
              icon={<Save className="size-4" />}
              disabled={!workbook || busy}
              onClick={handleSave}
              title="Salva (Ctrl+S)"
            >
              <span className={cn(!showLabels && 'sr-only')}>Salva</span>
            </Button>
            {workbook && (inlineUndo || inlineRedo) && <Separator orientation="vertical" className="mx-1 h-4" />}
            {workbook && inlineUndo && (
              <IconButton size="sm" disabled={!workbook.canUndo} onClick={() => doUndoRedo('undo')} label="Annulla (Ctrl+Z)">
                <Undo2 className="size-4" />
              </IconButton>
            )}
            {workbook && inlineRedo && (
              <IconButton size="sm" disabled={!workbook.canRedo} onClick={() => doUndoRedo('redo')} label="Ripeti (Ctrl+Shift+Z)">
                <Redo2 className="size-4" />
              </IconButton>
            )}
          </>
        }
        centerContent={
          workbook &&
          inlineViews && (
            <ViewSwitcher
              items={[
                { id: 'map', label: 'Mappa', icon: <Network className="size-4" /> },
                { id: 'outline', label: 'Outliner', icon: <ListTree className="size-4" /> },
              ]}
              activeId={viewMode}
              onChange={(id) => setViewMode(id as 'map' | 'outline')}
              size="sm"
              className={cn(!showLabels && '[&_span]:sr-only')}
            />
          )
        }
        rightContent={
          <>
            {workbook && (
              <IconButton
                size="sm"
                active={inspectorVisible}
                onClick={() => {
                  if (inspectorVisible) {
                    if (compact) setDetailsOpen(false);
                    else setSelectedTopicId(undefined);
                  } else {
                    const id = selectedTopicId ?? allTopics[0]?.id;
                    if (id) openDetails(id);
                  }
                }}
                label={inspectorVisible ? 'Chiudi pannello dettagli' : 'Apri pannello dettagli'}
              >
                <PanelRight className="size-4" />
              </IconButton>
            )}
            {inlineRedo && (
              <IconButton size="sm" onClick={() => setDarkMode((v) => !v)} label="Cambia tema">
                {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </IconButton>
            )}
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

      <main className="relative flex flex-1 overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {!workbook ? (
          <EmptyState
            onOpenFile={handleOpenLocalFile}
            onNewFile={handleNewMap}
            onLoadDemo={handleLoadDemo}
            onDropFiles={async (file) => {
              const buffer = await file.arrayBuffer();
              const dto = await controller.open(new Uint8Array(buffer), undefined, file.name);
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
              onSelect={(id) => {
                setSelectedTopicId(id);
                // Sotto lg il drawer copre la mappa: si chiude dopo la scelta.
                if (!window.matchMedia(WIDE_QUERY).matches) setSidebarOpen(false);
              }}
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              onToggleCollapse={handleToggleCollapse}
              onAddChild={handleAddChild}
              onAddRootChild={() => allTopics[0] && handleAddChild(allTopics[0].id)}
              onMove={handleMove}
            />

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {viewMode === 'map' ? (
                <MapView
                  layout={currentLayout}
                  selectedTopicId={selectedTopicId}
                  onSelectTopic={setSelectedTopicId}
                  onOpenDetails={openDetails}
                  onOpenLatex={openDetails}
                  detailsOpen={inspectorVisible}
                  onAddChild={(id) => createTopic(id, 'child')}
                  onDeleteTopic={handleDeleteSelected}
                  editing={editing}
                  onStartEdit={startEdit}
                  onCommitEdit={handleCommitEdit}
                  onCancelEdit={() => setEditing(null)}
                  onToggleCollapse={handleToggleCollapse}
                  resourceResolver={resolveResource}
                  darkMode={darkMode}
                  structure={mapStructure}
                  onStructureChange={setMapStructure}
                  onMoveTopic={handleMove}
                  onMoveFloatingTopic={handleMoveFloating}
                  onRelationshipControlPointsChange={handleRelationshipControlPoint}
                />
              ) : (
                <OutlineView text={outlineText} />
              )}

              {workbook.sheets.length > 1 && (
                <div className="flex h-[calc(2.25rem+env(safe-area-inset-bottom))] shrink-0 items-center gap-1 overflow-x-auto border-t bg-sidebar px-2 pb-[env(safe-area-inset-bottom)]">
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

            {inspectorVisible && (
              <Inspector
                topic={selectedTopic}
                allTopics={allTopics}
                relationships={currentSheet?.relationships || []}
                controller={controller}
                onChanged={refreshState}
                onClose={() => (compact ? setDetailsOpen(false) : setSelectedTopicId(undefined))}
                darkMode={darkMode}
                onToast={addToast}
                width={inspectorWidth}
                onWidthChange={setInspectorWidth}
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
