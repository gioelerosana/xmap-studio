import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Button, Modal, ToastContainer } from '@xmap/ui-kit';
import { AppController, type Layout, type MapStructure, type WorkbookDto } from '@xmap/core';
import { MapView, type MapEditing } from './components/MapView.js';
import { FloatingToolbar } from './components/toolbar/FloatingToolbar.js';
import { LatexEditorModal } from './components/latex/LatexEditorModal.js';
import { ExportModal } from './components/ExportModal.js';
import { PrintModal } from './components/PrintModal.js';
import { ImportModal } from './components/ImportModal.js';
import { EmptyState } from './components/EmptyState.js';
import { AppMark } from './components/AppMark.js';
import { SettingsPage } from './components/SettingsPage.js';
import { useSettings } from './settings.js';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION_LABEL } from './appInfo.js';
import { sanitizeName } from './app/fileNames.js';
import { useAdaptiveHeader } from './app/useAdaptiveHeader.js';
import { useToasts } from './app/useToasts.js';
import { useSelection } from './app/useSelection.js';
import { useTopicActions } from './app/useTopicActions.js';
import { useWorkbookSave } from './app/useWorkbookSave.js';
import { useWorkbookFiles } from './app/useWorkbookFiles.js';
import { useElectronWindow } from './app/useElectronWindow.js';
import { useTopicEditing } from './app/useTopicEditing.js';
import { useRelationships } from './app/useRelationships.js';
import { useImageInsert } from './app/useImageInsert.js';
import { useTopicClipboard } from './app/useTopicClipboard.js';
import { useClipboardEvents } from './app/useClipboardEvents.js';
import { useDocumentTools } from './app/useDocumentTools.js';
import { useMapKeyboard } from './app/useMapKeyboard.js';
import { useGlobalShortcuts } from './app/useGlobalShortcuts.js';
import { buildMenuItems } from './app/buildMenuItems.js';
import { AppHeader } from './app/AppHeader.js';

export const App: React.FC = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
  const [controller] = useState(() => new AppController());
  const [workbook, setWorkbook] = useState<WorkbookDto | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  // Cresce a ogni documento aperto: la mappa si riadatta solo allora (o al cambio di foglio).
  const [documentKey, setDocumentKey] = useState(0);
  const { settings, darkMode, update: updateSettings, reset: resetSettings } = useSettings();
  const toggleDarkMode = useCallback(() => updateSettings({ theme: darkMode ? 'light' : 'dark' }), [darkMode, updateSettings]);

  const selection = useSelection();
  const { selectedTopicId, selectedTopicIds, selectSingle } = selection;
  const { headerRef, layout: headerLayout } = useAdaptiveHeader(Boolean(workbook));
  const { toasts, addToast, removeToast } = useToasts();

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [busy, setBusy] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<MapEditing | null>(null);
  // Blocco aperto nell'editor LaTeX centrato; `undefined` = editor chiuso.
  const [latexTopicId, setLatexTopicId] = useState<string | undefined>();

  const refreshState = useCallback(() => {
    setWorkbook(controller.workbook());
  }, [controller]);

  // Mostra una mappa appena caricata: nuovo documento, primo foglio, nessuna selezione.
  const adoptWorkbook = useCallback(
    (dto: WorkbookDto, handle?: FileSystemFileHandle) => {
      setWorkbook(dto);
      setFileHandle(handle);
      setActiveSheetIndex(0);
      setDocumentKey((k) => k + 1);
      setCollapsedIds(new Set());
      selectSingle(undefined);
    },
    [selectSingle]
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

  const siblingRangeInfo = useMemo(() => {
    const ids = selectedTopicIds.length > 0 ? selectedTopicIds : (selectedTopicId ? [selectedTopicId] : []);
    if (ids.length === 0) return null;
    return controller.siblingRange(ids);
  }, [selectedTopicIds, selectedTopicId, controller, workbook]);

  const canAddSummary = Boolean(siblingRangeInfo);

  // Tema
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const openLatex = useCallback(
    (id: string) => {
      selectSingle(id);
      setLatexTopicId(id);
    },
    [selectSingle]
  );
  const latexTopic = useMemo(
    () => (latexTopicId ? allTopics.find((t) => t.id === latexTopicId) ?? null : null),
    [allTopics, latexTopicId]
  );

  const { writeWorkbook, handleSave, handleSaveAs } = useWorkbookSave({
    controller,
    workbook,
    fileHandle,
    setFileHandle,
    setBusy,
    isElectron,
    refreshState,
    addToast,
  });

  const {
    openFromPath,
    handleOpenLocalFile,
    handleLoadDemo,
    handleNewMap,
    openDroppedFile,
    replacePrompt,
    handleConfirmReplacement,
    closePrompt,
    setClosePrompt,
    handleConfirmClose,
  } = useWorkbookFiles({ controller, isElectron, adoptWorkbook, addToast, writeWorkbook });

  const isWindowMaximized = useElectronWindow({
    isElectron,
    controller,
    openInitialFile: openFromPath,
    setClosePrompt,
  });

  const {
    createTopic,
    handleAddChild,
    handleToggleCollapse,
    handleMove,
    handleResizeTopicWidth,
    handleResizeTopicImage,
    handleMoveFloating,
    handleDeleteSelected,
    handleRemoveTopicKeepChildren,
    handleCreateSummary,
    doUndoRedo,
    handleCommitEdit,
    startEdit,
  } = useTopicEditing({
    controller,
    refreshState,
    addToast,
    selection,
    selectedTopic,
    allTopics,
    activeSheetIndex,
    currentLayout,
    editing,
    setEditing,
    setCollapsedIds,
    openLatex,
  });

  const {
    connectingTopicId,
    setConnectingTopicId,
    handleConnectRelationshipTarget,
    handleRelationshipControlPoint,
  } = useRelationships({ controller, refreshState, addToast });

  const topicActions = useTopicActions({ controller, refreshState, addToast });

  const { insertImage } = useImageInsert({
    controller,
    selectedTopic,
    allTopics,
    refreshState,
    addToast,
    selection,
    setCollapsedIds,
  });

  const {
    inMemoryClipboard,
    canPaste,
    handleCopyTopic,
    handleCutTopic,
    handleDuplicateTopic,
    handlePasteTopic,
  } = useTopicClipboard({
    controller,
    selectedTopic,
    allTopics,
    currentLayout,
    refreshState,
    addToast,
    selection,
    setCollapsedIds,
    setEditing,
    insertImage,
  });

  useClipboardEvents({
    controller,
    editing,
    selectedTopic,
    allTopics,
    selection,
    refreshState,
    addToast,
    setCollapsedIds,
    inMemoryClipboard,
    insertImage,
    handleCopyTopic,
    handleCutTopic,
  });

  const { handleExportEquation, handleAttach, handleMerge, handleSplit } = useDocumentTools({
    controller,
    selectedTopic,
    hasWorkbook: Boolean(workbook),
    refreshState,
    addToast,
  });

  // Scorciatoie della mappa attive solo con una mappa aperta e nessun modale o editing in corso.
  const mapKeysEnabled =
    Boolean(workbook) &&
    !editing &&
    !exportModalOpen &&
    !importModalOpen &&
    !aboutOpen &&
    !settingsOpen &&
    !latexTopic &&
    !replacePrompt &&
    !closePrompt &&
    !busy;

  useMapKeyboard({
    enabled: mapKeysEnabled,
    selectedTopic,
    currentLayout,
    selection,
    setEditing,
    startEdit,
    createTopic,
    handleDeleteSelected,
    handleDuplicateTopic,
  });

  useGlobalShortcuts({
    hasWorkbook: Boolean(workbook),
    selectedTopic,
    allTopics,
    editing,
    selection,
    doUndoRedo,
    handleSave,
    handleSaveAs,
    handleOpenLocalFile,
    handleAddChild,
    handleCreateSummary,
    setSettingsOpen,
    setPrintModalOpen,
  });

  const resolveResource = useCallback((src: string) => controller.resourceBytes(src), [controller]);

  const menuItems = buildMenuItems(
    { workbook, selectedTopic, selectedTopicId, darkMode, layout: headerLayout },
    {
      onOpen: handleOpenLocalFile,
      onUndo: () => doUndoRedo('undo'),
      onRedo: () => doUndoRedo('redo'),
      onToggleTheme: toggleDarkMode,
      onSaveAs: handleSaveAs,
      onExport: () => setExportModalOpen(true),
      onPrint: () => setPrintModalOpen(true),
      onImport: () => setImportModalOpen(true),
      onExportEquation: handleExportEquation,
      onAttach: handleAttach,
      onMerge: handleMerge,
      onSplit: handleSplit,
      onDelete: handleDeleteSelected,
      onAbout: () => setAboutOpen(true),
    }
  );

  return (
    <div className="flex flex-col h-dvh w-screen overflow-hidden bg-background text-foreground select-none">
      <AppHeader
        headerRef={headerRef}
        layout={headerLayout}
        title={workbook ? controller.mapTitle() || workbook.fileName : 'XMap Studio'}
        workbook={workbook}
        busy={busy}
        darkMode={darkMode}
        settingsOpen={settingsOpen}
        isElectron={isElectron}
        isWindowMaximized={isWindowMaximized}
        menuItems={menuItems}
        onOpen={handleOpenLocalFile}
        onSave={handleSave}
        onUndo={() => doUndoRedo('undo')}
        onRedo={() => doUndoRedo('redo')}
        onToggleTheme={toggleDarkMode}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
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
            onDropFiles={openDroppedFile}
          />
        ) : (
          <>
            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              {connectingTopicId && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto px-4 w-full max-w-md animate-fade-in">
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
                onSelectTopic={selection.onSelectTopic}
                onClearSelection={() => selectSingle(undefined)}
                onAddSummary={handleCreateSummary}
                canAddSummary={canAddSummary}
                onOpenLatex={openLatex}
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
                canPaste={canPaste}
                isConnectingRelationship={Boolean(connectingTopicId)}
                onConnectRelationshipTarget={handleConnectRelationshipTarget}
              />

              <FloatingToolbar
                topic={selectedTopic}
                selectedTopicIds={selectedTopicIds}
                allTopics={allTopics}
                relationships={currentSheet?.relationships || []}
                isEditingText={Boolean(editing)}
                actions={topicActions}
                canAddSummary={canAddSummary}
                onAddSummaryForSelection={handleCreateSummary}
                onOpenLatex={openLatex}
                onStartConnectRelationship={(id) => setConnectingTopicId(id)}
                onInsertImage={(file) => void insertImage(file, 'picker')}
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
                        selectSingle(undefined);
                      }}
                    >
                      {sheet.title}
                    </Button>
                  ))}
                </div>
              )}
            </div>

          </>
        )}
      </main>

      <LatexEditorModal
        // Rimontato a ogni apertura: la bozza riparte dalla formula del blocco.
        key={latexTopic?.id ?? 'closed'}
        topic={latexTopic}
        onClose={() => setLatexTopicId(undefined)}
        controller={controller}
        darkMode={darkMode}
        onChanged={refreshState}
        onToast={addToast}
      />
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
