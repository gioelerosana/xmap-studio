import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  HeaderBar,
  Banner,
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
  TitleRun,
} from '@xmap/core';
import {
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Moon,
  Sun,
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
  Settings,
  Printer,
} from 'lucide-react';
import {
  openLocalXmindFile,
  saveLocalXmindFile,
  pickAnyFile,
  saveBytes,
  confirmForceSave,
  downloadBlob,
} from './adapters/fileSystem.js';
import { MapView, type MapEditing } from './components/MapView.js';
import type { EditExit } from './components/map/NodeEditor.js';
import { neighborId, selectionAfterDelete } from './components/map/navigation.js';
import { AppMark } from './components/AppMark.js';
import { Inspector } from './components/Inspector.js';
import { INSPECTOR_PANEL, usePanelWidth } from './components/usePanelWidth.js';
import { ExportModal } from './components/ExportModal.js';
import { PrintModal } from './components/PrintModal.js';
import { ImportModal } from './components/ImportModal.js';
import { EmptyState } from './components/EmptyState.js';
import type { DropPlacement } from './components/map/dragTarget.js';
import { SettingsPage } from './components/SettingsPage.js';
import { useSettings } from './settings.js';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION_LABEL } from './appInfo.js';

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
      printToPdf: (opts: { pageSize: 'A4' | 'A3'; landscape: boolean }) => Promise<number[]>;
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

/** Nome provvisorio di una mappa nuova, mai salvata: al primo salvataggio si propone il titolo della radice. */
const UNTITLED_FILE_NAME = 'senza_titolo.xmind';

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80) || 'mappa'
  );
}

const COMPACT_QUERY = '(max-width: 639px)';
const WIDE_QUERY = '(min-width: 1024px)';
/** Livelli di compattazione dell'header: da questo livello in poi l'elemento va nel menu. */
const HEADER_LEVEL = { iconsOnly: 1, redoTheme: 2, title: 3, undo: 4, open: 5, max: 5 } as const;

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

async function readImageBlob(blob: Blob): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const mimeType = blob.type || 'image/png';

  let width = 0;
  let height = 0;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      // Fallback a Image se createImageBitmap fallisce
    }
  }

  if (width === 0 || height === 0) {
    await new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(new Error(`Impossibile decodificare l'immagine: ${err}`));
      };
      img.src = url;
    });
  }

  if (width <= 0) width = 400;
  if (height <= 0) height = 400;

  return { bytes, width, height, mimeType };
}

export const App: React.FC = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
  const [controller] = useState(() => new AppController());
  const [workbook, setWorkbook] = useState<WorkbookDto | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  // Cresce a ogni documento aperto: la mappa si riadatta solo allora (o al cambio di foglio).
  const [documentKey, setDocumentKey] = useState(0);
  const { settings, darkMode, update: updateSettings, reset: resetSettings } = useSettings();
  const toggleDarkMode = useCallback(() => updateSettings({ theme: darkMode ? 'light' : 'dark' }), [darkMode, updateSettings]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  // La selezione multipla contiene sempre la primaria: ogni altro cambio di
  // `selectedTopicId` (nuovo blocco, undo, immagine incollata…) la riporta a singola.
  useEffect(() => {
    setSelectedTopicIds((prev) =>
      selectedTopicId && prev.includes(selectedTopicId) ? prev : selectedTopicId ? [selectedTopicId] : []
    );
  }, [selectedTopicId]);
  const [inspectorWidth, setInspectorWidth] = usePanelWidth(
    INSPECTOR_PANEL.storageKey,
    INSPECTOR_PANEL.defaultWidth,
    INSPECTOR_PANEL.min,
    INSPECTOR_PANEL.max,
  );
  // Smartphone: il tap seleziona soltanto, il pannello dettagli (bottom sheet)
  // si apre su richiesta per non coprire la mappa a ogni tocco.
  // Su desktop la selezione apre i dettagli solo se l'impostazione lo chiede.
  const compact = useMediaQuery(COMPACT_QUERY);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsClosed, setDetailsClosed] = useState(false);
  const inspectorVisible = Boolean(selectedTopicId) && (compact ? detailsOpen : !detailsClosed && (detailsOpen || settings.detailsOnSelect));

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
  const inlineDetails = headerLevel < HEADER_LEVEL.redoTheme;
  const inlineRedo = headerLevel < HEADER_LEVEL.redoTheme;
  const inlineUndo = headerLevel < HEADER_LEVEL.undo;
  const inlineOpen = headerLevel < HEADER_LEVEL.open;
  const showTitle = headerLevel < HEADER_LEVEL.title;

  useEffect(() => {
    setDetailsClosed(false);
    if (!selectedTopicId) setDetailsOpen(false);
  }, [selectedTopicId]);

  const openDetails = useCallback((id: string) => {
    setSelectedTopicId(id);
    setSelectedTopicIds([id]);
    setDetailsClosed(false);
    setDetailsOpen(true);
  }, []);

  const toggleDetails = useCallback(() => {
    if (!selectedTopicId) return;
    if (inspectorVisible) {
      setDetailsClosed(true);
      setDetailsOpen(false);
    } else {
      setDetailsClosed(false);
      setDetailsOpen(true);
    }
  }, [selectedTopicId, inspectorVisible]);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [pendingReplacement, setPendingReplacement] = useState<(() => Promise<void>) | null>(null);
  const [replacePrompt, setReplacePrompt] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [busy, setBusy] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closePrompt, setClosePrompt] = useState<CloseAction>(null);
  const [editing, setEditing] = useState<MapEditing | null>(null);
  const [connectingTopicId, setConnectingTopicId] = useState<string | null>(null);
  const inMemoryClipboard = useRef<string | null>(null);
  const [canPaste, setCanPaste] = useState(false);

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

  const handleSelectTopic = useCallback(
    (topicId: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean }) => {
      const isMulti = Boolean(modifiers?.shiftKey || modifiers?.ctrlKey);
      if (!isMulti) {
        // Clic semplice: torna alla selezione singola
        setSelectedTopicId(topicId);
        setSelectedTopicIds([topicId]);
        return;
      }

      // Maiusc+clic o Ctrl/Cmd+clic: aggiunge o toglie dalla selezione
      setSelectedTopicIds((prev) => {
        const base = prev.length > 0 ? prev : (selectedTopicId ? [selectedTopicId] : []);
        const alreadySelected = base.includes(topicId);
        let next: string[];

        if (alreadySelected) {
          next = base.filter((id) => id !== topicId);
        } else {
          next = [...base, topicId];
        }

        // Mantiene la selezione primaria se ancora valida, altrimenti aggiorna
        if (next.length === 0) {
          setSelectedTopicId(undefined);
        } else if (alreadySelected && selectedTopicId === topicId) {
          setSelectedTopicId(next[next.length - 1]);
        } else if (!alreadySelected && !selectedTopicId) {
          setSelectedTopicId(topicId);
        }
        return next;
      });
    },
    [selectedTopicId]
  );

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
  const mapStructure: MapStructure = settings.mapStructure;
  const setMapStructure = useCallback((structure: MapStructure) => updateSettings({ mapStructure: structure }), [updateSettings]);

  const currentLayout = useMemo<Layout | null>(() => {
    if (!workbook) return null;
    return controller.mapLayout(activeSheetIndex, collapsedIds, mapStructure);
  }, [controller, workbook, activeSheetIndex, collapsedIds, mapStructure]);

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
          setDocumentKey((k) => k + 1);
          setCollapsedIds(new Set());
          setSelectedTopicId(undefined);
          setSelectedTopicIds([]);
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
          setDocumentKey((k) => k + 1);
          setCollapsedIds(new Set());
          setSelectedTopicId(undefined);
          setSelectedTopicIds([]);
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
        setDocumentKey((k) => k + 1);
        setCollapsedIds(new Set());
        setSelectedTopicId(undefined);
        setSelectedTopicIds([]);
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
        setDocumentKey((k) => k + 1);
        setCollapsedIds(new Set());
        setSelectedTopicId(undefined);
        setSelectedTopicIds([]);
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
      const dto = await controller.open(bytes, undefined, UNTITLED_FILE_NAME);
      setWorkbook(dto);
      setFileHandle(undefined);
      setActiveSheetIndex(0);
      setDocumentKey((k) => k + 1);
      setCollapsedIds(new Set());
      setSelectedTopicId(undefined);
      setSelectedTopicIds([]);
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
        const suggestedName =
          workbook.path === null && workbook.fileName === UNTITLED_FILE_NAME
            ? `${sanitizeName(controller.mapTitle() || 'mappa')}.xmind`
            : workbook.fileName || 'mappa.xmind';

        if (isElectron && window.electronAPI) {
          let savePath = workbook.path;
          if (saveAs || !savePath) {
            const selected = await window.electronAPI.saveFileDialog(suggestedName);
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
          suggestedName,
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

  const siblingRangeInfo = useMemo(() => {
    const ids = selectedTopicIds.length > 0 ? selectedTopicIds : (selectedTopicId ? [selectedTopicId] : []);
    if (ids.length === 0) return null;
    return controller.siblingRange(ids);
  }, [selectedTopicIds, selectedTopicId, controller, workbook]);

  const canAddSummary = Boolean(siblingRangeInfo);

  const handleCreateSummary = useCallback(() => {
    const ids = selectedTopicIds.length > 0 ? selectedTopicIds : (selectedTopicId ? [selectedTopicId] : []);
    if (ids.length === 0) {
      addToast('warning', 'Seleziona almeno un blocco per creare un sommario.');
      return;
    }

    const range = controller.siblingRange(ids);
    if (!range) {
      addToast('warning', 'Impossibile creare un sommario con questa selezione (radice, blocchi liberi o fogli diversi).');
      return;
    }

    try {
      const { summaryTopicId } = controller.addTopicSummary(range.parentId, range.start, range.end, 'Sommario');
      setSelectedTopicId(summaryTopicId);
      setSelectedTopicIds([summaryTopicId]);
      setEditing({ id: summaryTopicId, mode: 'all', isNew: true });
      refreshState();
      addToast('success', 'Sommario aggiunto');
    } catch (err: any) {
      addToast('error', err.message || 'Impossibile creare il sommario.');
    }
  }, [selectedTopicIds, selectedTopicId, controller, refreshState, addToast]);

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
      setSelectedTopicIds(cur ? [cur] : []);
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
      } else if (e.shiftKey && key === 'n') {
        e.preventDefault();
        if (selectedTopic) handleAddChild(selectedTopic.id);
        else if (allTopics[0]) handleAddChild(allTopics[0].id);
      } else if (key === ',') {
        e.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (key === ']' || e.code === 'BracketRight') {
        if (inField) return;
        e.preventDefault();
        handleCreateSummary();
      } else if (key === 'p') {
        if (workbook) {
          e.preventDefault();
          setPrintModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, doUndoRedo, handleSave, handleSaveAs, handleOpenLocalFile, selectedTopic, allTopics, handleCreateSummary, workbook]);

  // Esc chiude l'Inspector se aperto e non si sta editando testo; con selezione multipla torna a singola
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (editing) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      if (selectedTopicIds.length > 1) {
        e.preventDefault();
        setSelectedTopicIds(selectedTopicId ? [selectedTopicId] : []);
        return;
      }
      if (inspectorVisible) {
        e.preventDefault();
        setDetailsClosed(true);
        setDetailsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, inspectorVisible, selectedTopicIds, selectedTopicId]);


  // Annulla la modalità di connessione relazione con Esc
  useEffect(() => {
    if (!connectingTopicId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConnectingTopicId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [connectingTopicId]);

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

  const handleAddImage = useCallback(
    async (file: Blob, source: 'paste' | 'drop' = 'paste') => {
      try {
        const targetParentId =
          selectedTopic?.id ?? allTopics.find((t) => t.depth === 0)?.id ?? allTopics[0]?.id;
        if (!targetParentId) return;

        const { bytes, width, height, mimeType } = await readImageBlob(file);
        const { newId } = controller.addImageTopic(targetParentId, bytes, mimeType, { width, height });

        setCollapsedIds((prev) => {
          if (!prev.has(targetParentId)) return prev;
          const next = new Set(prev);
          next.delete(targetParentId);
          return next;
        });

        setSelectedTopicId(newId);
        refreshState();
        addToast(
          'success',
          source === 'paste' ? 'Immagine incollata sulla mappa' : 'Immagine aggiunta alla mappa'
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile aggiungere l'immagine: ${msg}`);
      }
    },
    [controller, selectedTopic, allTopics, refreshState, addToast]
  );




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
        setSelectedTopicIds([newId]);
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

  
  const handleResizeTopicWidth = useCallback(
    (id: string, width: number | null) => {
      try {
        controller.setTopicCustomWidth(id, width);
        refreshState();
      } catch (err: any) {
        addToast('error', `Ridimensionamento non riuscito: ${err.message}`);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleResizeTopicImage = useCallback(
    (id: string, size: { width: number; height: number }) => {
      try {
        controller.setTopicImageSize(id, size);
        refreshState();
      } catch (err: any) {
        addToast('error', `Ridimensionamento immagine non riuscito: ${err.message}`);
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
      setSelectedTopicIds(next ? [next] : []);
      setEditing(null);
      refreshState();
      addToast('info', 'Blocco eliminato — Ctrl+Z per annullare');
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  const handleRemoveTopicKeepChildren = (topicId: string) => {
    const fallback = currentLayout ? selectionAfterDelete(currentLayout, topicId) : undefined;
    try {
      const { childIds } = controller.removeTopicKeepChildren(topicId);
      const next = childIds[0] ?? fallback;
      setSelectedTopicId(next);
      setSelectedTopicIds(next ? [next] : []);
      setEditing(null);
      refreshState();
      addToast('info', 'Blocco rimosso, figli ricollegati — Ctrl+Z per annullare');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  };

  const handleCopyTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      try {
        const payload = controller.copyTopic(id);
        inMemoryClipboard.current = payload;
        setCanPaste(true);
        navigator.clipboard?.writeText(payload).catch(() => {});
        addToast('info', 'Blocco copiato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile copiare il blocco: ${msg}`);
      }
    },
    [controller, selectedTopic, addToast]
  );

  const handleCutTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      const topic = allTopics.find((t) => t.id === id);
      if (!topic || topic.depth === 0) {
        addToast('warning', 'La radice non può essere tagliata');
        return;
      }
      try {
        const payload = controller.copyTopic(id);
        inMemoryClipboard.current = payload;
        setCanPaste(true);
        navigator.clipboard?.writeText(payload).catch(() => {});
        const next = currentLayout ? selectionAfterDelete(currentLayout, id) : undefined;
        controller.removeTopic(id);
        setSelectedTopicId(next);
        setSelectedTopicIds(next ? [next] : []);
        setEditing(null);
        refreshState();
        addToast('info', 'Blocco tagliato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile tagliare il blocco: ${msg}`);
      }
    },
    [controller, selectedTopic, allTopics, currentLayout, refreshState, addToast]
  );

  const handleDuplicateTopic = useCallback(
    (topicId?: string) => {
      const id = topicId ?? selectedTopic?.id;
      if (!id) return;
      try {
        const { newId } = controller.duplicateTopic(id);
        setSelectedTopicId(newId);
        setSelectedTopicIds([newId]);
        refreshState();
        addToast('success', 'Blocco duplicato');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile duplicare il blocco: ${msg}`);
      }
    },
    [controller, selectedTopic, refreshState, addToast]
  );

  const handlePasteTopic = useCallback(
    async (targetParentId?: string) => {
      let text = '';
      try {
        text = await navigator.clipboard?.readText();
      } catch {
        text = inMemoryClipboard.current || '';
      }
      if (!text && inMemoryClipboard.current) {
        text = inMemoryClipboard.current;
      }

      const targetId =
        targetParentId ??
        selectedTopic?.id ??
        allTopics.find((t) => t.depth === 0)?.id;

      if (!targetId) return;

      if (text && text.includes('"xmapStudioClipboard"')) {
        try {
          const { newId } = controller.pasteTopic(targetId, text);
          setCollapsedIds((prev) => {
            if (!prev.has(targetId)) return prev;
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          setSelectedTopicId(newId);
          setSelectedTopicIds([newId]);
          refreshState();
          addToast('success', 'Blocco incollato');
          return;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile incollare il blocco: ${msg}`);
          return;
        }
      }

      const clean = text?.trim() ?? '';
      if (clean.length > 0) {
        try {
          const { newId } = controller.addTopic(targetId, clean);
          setCollapsedIds((prev) => {
            if (!prev.has(targetId)) return prev;
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          setSelectedTopicId(newId);
          setSelectedTopicIds([newId]);
          refreshState();
          addToast('success', 'Nuovo blocco creato dal testo');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile creare il blocco: ${msg}`);
        }
      }
    },
    [controller, selectedTopic, allTopics, refreshState, addToast]
  );

  const handleConnectRelationshipTarget = useCallback(
    (targetTopicId: string) => {
      if (!connectingTopicId) return;
      if (connectingTopicId === targetTopicId) {
        addToast('warning', 'Non puoi collegare un blocco a se stesso');
        setConnectingTopicId(null);
        return;
      }
      try {
        controller.addTopicRelationship(connectingTopicId, targetTopicId);
        refreshState();
        addToast('success', 'Relazione creata');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Impossibile creare la relazione: ${msg}`);
      }
      setConnectingTopicId(null);
    },
    [connectingTopicId, controller, refreshState, addToast]
  );

  // Incolla (Ctrl+V), Copia (Ctrl+C), Taglia (Ctrl+X) e Drag & Drop sulla mappa
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (editing) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;

      // 1. Se c'è un'immagine, usa il flusso immagini esistente
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              void handleAddImage(file, 'paste');
              return;
            }
          }
        }
      }

      // 2. Altrimenti testo / payload blocco XMap Studio
      const text = e.clipboardData?.getData('text/plain') || inMemoryClipboard.current;
      if (!text) return;

      const targetParentId =
        selectedTopic?.id ?? allTopics.find((t) => t.depth === 0)?.id ?? allTopics[0]?.id;
      if (!targetParentId) return;

      if (text.includes('"xmapStudioClipboard"')) {
        e.preventDefault();
        try {
          const { newId } = controller.pasteTopic(targetParentId, text);
          setCollapsedIds((prev) => {
            if (!prev.has(targetParentId)) return prev;
            const next = new Set(prev);
            next.delete(targetParentId);
            return next;
          });
          setSelectedTopicId(newId);
          setSelectedTopicIds([newId]);
          refreshState();
          addToast('success', 'Blocco incollato');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile incollare il blocco: ${msg}`);
        }
        return;
      }

      // Altrimenti se c'è un blocco selezionato e testo semplice, crea un sotto-blocco con quel testo
      const clean = text.trim();
      if (clean.length > 0 && selectedTopic) {
        e.preventDefault();
        try {
          const { newId } = controller.addTopic(selectedTopic.id, clean);
          setCollapsedIds((prev) => {
            if (!prev.has(selectedTopic.id)) return prev;
            const next = new Set(prev);
            next.delete(selectedTopic.id);
            return next;
          });
          setSelectedTopicId(newId);
          setSelectedTopicIds([newId]);
          refreshState();
          addToast('success', 'Nuovo blocco creato dal testo');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast('error', `Impossibile creare il blocco: ${msg}`);
        }
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      if (editing) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      if (!selectedTopic) return;

      e.preventDefault();
      handleCopyTopic(selectedTopic.id);
    };

    const onCut = (e: ClipboardEvent) => {
      if (editing) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as Element | null;
      if (target?.closest?.(TEXT_FIELD)) return;
      if (!selectedTopic || selectedTopic.depth === 0) return;

      e.preventDefault();
      handleCutTopic(selectedTopic.id);
    };

    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (types && Array.from(types).includes('Files')) {
        e.preventDefault();
      }
    };

    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return;
      if (editing) return;
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          void handleAddImage(file, 'drop');
          return;
        }
      }
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [editing, handleAddImage, controller, selectedTopic, allTopics, refreshState, addToast, handleCopyTopic, handleCutTopic]);

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
        setSelectedTopicIds([newId]);
        setEditing({ id: newId, mode: 'all', isNew: true });
        refreshState();
      } catch (err: any) {
        addToast('error', err.message);
      }
    },
    [controller, refreshState, addToast]
  );

  const handleCommitEdit = (id: string, text: string, exit: EditExit, runs?: TitleRun[]) => {
    const isNew = editing?.id === id && editing.isNew;
    setEditing(null);
    const topic = allTopics.find((t) => t.id === id);
    try {
      if (topic) {
        if (runs && runs.length > 0) {
          controller.setTopicTitleRuns(id, runs, { mergeWithPrevious: isNew });
          refreshState();
        } else if (topic.titleRuns && topic.titleRuns.length > 0) {
          controller.setTopicTitleRuns(id, [{ text: text.trim().length > 0 ? text : topic.title }], {
            mergeWithPrevious: isNew,
          });
          refreshState();
        } else if (text.trim().length > 0 && text !== topic.title) {
          controller.setTopicTitle(id, text, { mergeWithPrevious: isNew });
          refreshState();
        }
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
    Boolean(workbook) &&
    !editing &&
    !exportModalOpen &&
    !importModalOpen &&
    !aboutOpen &&
    !settingsOpen &&
    !replacePrompt &&
    !closePrompt &&
    !busy;
  useEffect(() => {
    if (!mapKeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;

      // Scorciatoia Ctrl+D / Cmd+D: duplica il blocco selezionato
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
        const target = e.target as Element | null;
        if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;
        if (selectedTopic && selectedTopic.depth > 0) {
          e.preventDefault();
          handleDuplicateTopic(selectedTopic.id);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.(INTERACTIVE) || document.querySelector('[role="dialog"]')) return;
      const sel = selectedTopic;
      if (!sel) return;
      const c = keyCtx.current;
      const go = (dir: 'up' | 'down' | 'left' | 'right') => {
        const id = currentLayout ? neighborId(currentLayout, sel.id, dir) : undefined;
        if (id) {
          setSelectedTopicId(id);
          setSelectedTopicIds([id]);
        }
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
          if (selectedTopicIds.length > 1) {
            setSelectedTopicIds(selectedTopicId ? [selectedTopicId] : []);
          } else {
            setSelectedTopicId(undefined);
            setSelectedTopicIds([]);
          }
          break;
        default:
          if (e.key.length !== 1 || sel.kind !== 'text') return;
          setEditing({ id: sel.id, mode: 'text', text: e.key });
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapKeysEnabled, selectedTopic, currentLayout, selectedTopicIds, selectedTopicId, handleDuplicateTopic]);

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
    ...(workbook && !inlineDetails
      ? [{ id: 'details', label: 'Dettagli blocco', icon: <PanelRight className="size-4" />, disabled: !selectedTopicId, onSelect: toggleDetails }]
      : []),
  ];

  // Con il pulsante tema già in header la voce nel menu ⋮ sarebbe un doppione.
  const themeItem = (separatorBefore: boolean): MenuItem[] =>
    inlineRedo
      ? []
      : [{ id: 'theme', label: darkMode ? 'Tema chiaro' : 'Tema scuro', icon: darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />, separatorBefore, onSelect: toggleDarkMode }];

  const menuItems: MenuItem[] = workbook
    ? [
        ...overflowItems,
        { id: 'save-as', label: 'Salva con nome…', icon: <Save className="size-4" />, shortcut: 'Ctrl+Shift+S', separatorBefore: overflowItems.length > 0, onSelect: handleSaveAs },
        { id: 'export', label: 'Esporta Markdown / OPML…', icon: <FileDown className="size-4" />, separatorBefore: true, onSelect: () => setExportModalOpen(true) },
        { id: 'print', label: 'Stampa…', icon: <Printer className="size-4" />, shortcut: 'Ctrl+P', onSelect: () => setPrintModalOpen(true) },
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
        ...themeItem(true),
        { id: 'about', label: 'Informazioni', icon: <Info className="size-4" />, onSelect: () => setAboutOpen(true) },
      ]
    : [
        ...overflowItems,
        ...themeItem(overflowItems.length > 0),
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
        rightContent={
          <>
            {inlineRedo && (
              <IconButton size="sm" onClick={toggleDarkMode} label="Cambia tema">
                {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </IconButton>
            )}
            {workbook && inlineDetails && (
              <IconButton
                size="sm"
                active={inspectorVisible}
                disabled={!selectedTopicId}
                onClick={toggleDetails}
                title="Dettagli blocco"
                label="Dettagli blocco"
              >
                <PanelRight className="size-4" />
              </IconButton>
            )}
            <IconButton
              size="sm"
              active={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
              label="Impostazioni (Ctrl+,)"
            >
              <Settings className="size-4" />
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

      <main className="relative flex flex-1 overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {settingsOpen && (
          <SettingsPage
            onClose={() => setSettingsOpen(false)}
            settings={settings}
            onUpdate={updateSettings}
            onReset={resetSettings}
          />
        )}
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
              setDocumentKey((k) => k + 1);
              setCollapsedIds(new Set());
              setSelectedTopicId(undefined);
              setSelectedTopicIds([]);
              addToast('success', `Aperto ${file.name}`);
            }}
          />
        ) : (
          <>
            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              {connectingTopicId && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto px-4 w-full max-w-md animate-fade-in">
                  <Banner
                    variant="info"
                    title="Clicca il blocco da collegare — Esc per annullare"
                    action={
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setConnectingTopicId(null)}
                      >
                        Annulla
                      </Button>
                    }
                  />
                </div>
              )}
              <MapView
                layout={currentLayout}
                viewKey={`${documentKey}:${activeSheetIndex}`}
                selectedTopicId={selectedTopicId}
                selectedTopicIds={selectedTopicIds}
                onSelectTopic={handleSelectTopic}
                onAddSummary={handleCreateSummary}
                canAddSummary={canAddSummary}
                onOpenDetails={openDetails}
                onOpenLatex={openDetails}
                detailsOpen={inspectorVisible}
                onAddChild={(id) => createTopic(id, 'child')}
                onAddSibling={(id, where) => createTopic(id, where ?? 'after')}
                onDeleteTopic={handleDeleteSelected}
                onRemoveTopicKeepChildren={handleRemoveTopicKeepChildren}
                editing={editing}
                onStartEdit={startEdit}
                onCommitEdit={handleCommitEdit}
                onCancelEdit={() => setEditing(null)}
                onToggleCollapse={handleToggleCollapse}
                resourceResolver={resolveResource}
                // In stampa la mappa si ridisegna in chiaro: colori di formule e testo sono calcolati in JS.
                darkMode={darkMode && !printModalOpen}
                structure={mapStructure}
                onStructureChange={setMapStructure}
                onMoveTopic={handleMove}
                onMoveFloatingTopic={handleMoveFloating}
                onRelationshipControlPointsChange={handleRelationshipControlPoint}
                onResizeTopicWidth={handleResizeTopicWidth}
                onResizeTopicImage={handleResizeTopicImage}
                onCopyTopic={handleCopyTopic}
                onCutTopic={handleCutTopic}
                onPasteTopic={handlePasteTopic}
                onDuplicateTopic={handleDuplicateTopic}
                onStartConnectRelationship={(id) => setConnectingTopicId(id)}
                canPaste={canPaste || Boolean(inMemoryClipboard.current)}
                isConnectingRelationship={Boolean(connectingTopicId)}
                onConnectRelationshipTarget={handleConnectRelationshipTarget}
              />

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
                        setSelectedTopicIds([]);
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
                onClose={() => {
                  setDetailsClosed(true);
                  setDetailsOpen(false);
                }}
                darkMode={darkMode}
                onToast={addToast}
                width={inspectorWidth}
                onWidthChange={setInspectorWidth}
                selectedTopicIds={selectedTopicIds}
                onAddSummaryForSiblings={handleCreateSummary}
                canAddSummary={canAddSummary}
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
      <PrintModal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        layout={currentLayout}
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

      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} title={APP_NAME} size="sm">
        <div className="flex flex-col gap-3">
          <AppMark size={40} />
          <p className="text-sm text-muted-foreground">{APP_DESCRIPTION}</p>
          <p className="text-2xs text-muted-foreground font-mono">{APP_VERSION_LABEL}</p>
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
