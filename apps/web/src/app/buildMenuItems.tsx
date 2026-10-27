import type { TopicView, WorkbookDto } from '@xmap/core';
import type { MenuItem } from '@xmap/ui-kit';
import {
  FilePlus,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Moon,
  Sun,
  FileDown,
  FileUp,
  Sigma,
  Paperclip,
  Merge,
  Split,
  Trash2,
  Info,
  Printer,
  Image as ImageIcon,
  Palette,
  Maximize2,
} from 'lucide-react';
import type { HeaderLayout } from './useAdaptiveHeader.js';

export interface MenuContext {
  workbook: WorkbookDto | null;
  selectedTopic: TopicView | null;
  selectedTopicId: string | undefined;
  darkMode: boolean;
  layout: HeaderLayout;
}

export interface MenuActions {
  onNewMap: () => void;
  onOpen: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleTheme: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onPrint: () => void;
  onExportImage: () => void;
  onEditTheme: () => void;
  onZen: () => void;
  onImport: () => void;
  onExportEquation: (format: 'svg' | 'png') => void;
  onAttach: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onAbout: () => void;
}

/** Voci del menu ⋮: le azioni che non entrano nell'header e tutte quelle del documento. */
export function buildMenuItems(ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const { workbook, selectedTopic, selectedTopicId, darkMode, layout } = ctx;

  // Azioni dell'header che non ci stanno: in testa al menu ⋮.
  const overflowItems: MenuItem[] = [
    ...(workbook && !layout.inlineOpen
      ? [{ id: 'new-map', label: 'Nuova mappa', icon: <FilePlus className="size-4" />, onSelect: actions.onNewMap }]
      : []),
    ...(!layout.inlineOpen ? [{ id: 'open', label: 'Apri…', icon: <FolderOpen className="size-4" />, onSelect: actions.onOpen }] : []),
    ...(workbook && !layout.inlineUndo
      ? [{ id: 'undo', label: 'Annulla', icon: <Undo2 className="size-4" />, disabled: !workbook.canUndo, onSelect: actions.onUndo }]
      : []),
    ...(workbook && !layout.inlineRedo
      ? [{ id: 'redo', label: 'Ripeti', icon: <Redo2 className="size-4" />, disabled: !workbook.canRedo, onSelect: actions.onRedo }]
      : []),
  ];

  // Con il pulsante tema già in header la voce nel menu ⋮ sarebbe un doppione.
  const themeItem = (separatorBefore: boolean): MenuItem[] =>
    layout.inlineRedo
      ? []
      : [{ id: 'theme', label: darkMode ? 'Tema chiaro' : 'Tema scuro', icon: darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />, separatorBefore, onSelect: actions.onToggleTheme }];

  if (!workbook) {
    return [
      ...overflowItems,
      ...themeItem(overflowItems.length > 0),
      { id: 'about', label: 'Informazioni', icon: <Info className="size-4" />, onSelect: actions.onAbout },
    ];
  }

  return [
    ...overflowItems,
    { id: 'save-as', label: 'Salva con nome…', icon: <Save className="size-4" />, shortcut: 'Ctrl+Shift+S', separatorBefore: overflowItems.length > 0, onSelect: actions.onSaveAs },
    { id: 'export', label: 'Esporta Markdown / OPML…', icon: <FileDown className="size-4" />, separatorBefore: true, onSelect: actions.onExport },
    { id: 'export-image', label: 'Esporta immagine PNG / SVG…', icon: <ImageIcon className="size-4" />, onSelect: actions.onExportImage },
    { id: 'zen', label: 'Modalità Zen', icon: <Maximize2 className="size-4" />, shortcut: 'Ctrl+Alt+Z', onSelect: actions.onZen },
    { id: 'print', label: 'Stampa…', icon: <Printer className="size-4" />, shortcut: 'Ctrl+P', onSelect: actions.onPrint },
    { id: 'sheet-theme', label: 'Tema del foglio…', icon: <Palette className="size-4" />, onSelect: actions.onEditTheme },
    { id: 'import', label: 'Importa Markdown / OPML…', icon: <FileUp className="size-4" />, onSelect: actions.onImport },
    {
      id: 'export-svg',
      label: 'Esporta equazione SVG',
      icon: <Sigma className="size-4" />,
      separatorBefore: true,
      disabled: selectedTopic?.kind !== 'equation',
      onSelect: () => actions.onExportEquation('svg'),
    },
    {
      id: 'export-png',
      label: 'Esporta equazione PNG',
      icon: <Sigma className="size-4" />,
      disabled: selectedTopic?.kind !== 'equation',
      onSelect: () => actions.onExportEquation('png'),
    },
    { id: 'attach', label: 'Allega file…', icon: <Paperclip className="size-4" />, separatorBefore: true, disabled: !selectedTopic, onSelect: actions.onAttach },
    { id: 'merge', label: 'Unisci una mappa…', icon: <Merge className="size-4" />, onSelect: actions.onMerge },
    { id: 'split', label: 'Estrai ramo come mappa…', icon: <Split className="size-4" />, disabled: !selectedTopic || selectedTopic.depth === 0, onSelect: actions.onSplit },
    {
      id: 'delete',
      label: 'Elimina blocco',
      icon: <Trash2 className="size-4" />,
      danger: true,
      separatorBefore: true,
      disabled: !selectedTopic || selectedTopic.depth === 0,
      onSelect: actions.onDelete,
    },
    ...themeItem(true),
    { id: 'about', label: 'Informazioni', icon: <Info className="size-4" />, onSelect: actions.onAbout },
  ];
}
