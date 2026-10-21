import type { Ref } from 'react';
import type { WorkbookDto } from '@xmap/core';
import { Button, HeaderBar, IconButton, Menu, Separator, cn, type MenuItem } from '@xmap/ui-kit';
import { FolderOpen, Save, Undo2, Redo2, Moon, Sun, MoreVertical, Settings } from 'lucide-react';
import type { HeaderLayout } from './useAdaptiveHeader.js';

interface AppHeaderProps {
  headerRef: Ref<HTMLElement>;
  layout: HeaderLayout;
  /** Titolo della mappa o nome dell'app, mostrato solo se il livello dell'header lo consente. */
  title: string;
  workbook: WorkbookDto | null;
  busy: boolean;
  darkMode: boolean;
  settingsOpen: boolean;
  isElectron: boolean;
  isWindowMaximized: boolean;
  menuItems: MenuItem[];
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleTheme: () => void;
  onToggleSettings: () => void;
}

export function AppHeader({
  headerRef,
  layout,
  title,
  workbook,
  busy,
  darkMode,
  settingsOpen,
  isElectron,
  isWindowMaximized,
  menuItems,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onToggleTheme,
  onToggleSettings,
}: AppHeaderProps) {
  return (
    <HeaderBar
      title={layout.showTitle ? title : undefined}
      subtitle={layout.showTitle && workbook?.dirty ? 'Modifiche non salvate' : undefined}
      headerRef={headerRef}
      leftContent={
        <>
          {layout.inlineOpen && (
            <Button variant="ghost" size="sm" icon={<FolderOpen className="size-4" />} onClick={onOpen} title="Apri (Ctrl+O)">
              <span className={cn(!layout.showLabels && 'sr-only')}>Apri</span>
            </Button>
          )}
          <Button
            variant={workbook?.dirty ? 'default' : 'ghost'}
            size="sm"
            icon={<Save className="size-4" />}
            disabled={!workbook || busy}
            onClick={onSave}
            title="Salva (Ctrl+S)"
          >
            <span className={cn(!layout.showLabels && 'sr-only')}>Salva</span>
          </Button>
          {workbook && (layout.inlineUndo || layout.inlineRedo) && <Separator orientation="vertical" className="mx-1 h-4" />}
          {workbook && layout.inlineUndo && (
            <IconButton size="sm" disabled={!workbook.canUndo} onClick={onUndo} label="Annulla (Ctrl+Z)">
              <Undo2 className="size-4" />
            </IconButton>
          )}
          {workbook && layout.inlineRedo && (
            <IconButton size="sm" disabled={!workbook.canRedo} onClick={onRedo} label="Ripeti (Ctrl+Shift+Z)">
              <Redo2 className="size-4" />
            </IconButton>
          )}
        </>
      }
      rightContent={
        <>
          {layout.inlineRedo && (
            <IconButton size="sm" onClick={onToggleTheme} label="Cambia tema">
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconButton>
          )}
          <IconButton
            size="sm"
            active={settingsOpen}
            onClick={onToggleSettings}
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
  );
}
