import React, { useEffect, useState } from 'react';
import {
  AppController,
  RelationshipShape,
  RelationshipView,
  TaskData,
  TextStyle,
  TopicView,
} from '@xmap/core';
import { Plus, Trash2, X } from 'lucide-react';
import { IconButton } from '@xmap/ui-kit';

import { ResizeHandle } from './ResizeHandle.js';
import { INSPECTOR_PANEL, panelStyle } from './usePanelWidth.js';
import { BranchColorSection } from './inspector/BranchColorSection.js';
import { EquationSection } from './inspector/EquationSection.js';
import { LabelsSection } from './inspector/LabelsSection.js';
import { MarkersSection } from './inspector/MarkersSection.js';
import { NotesSection } from './inspector/NotesSection.js';
import { StructureSection } from './inspector/StructureSection.js';
import { TaskSection } from './inspector/TaskSection.js';
import { TextSection, type TextStylePatch } from './inspector/TextSection.js';
import { useEquationDraft } from './inspector/useEquationDraft.js';

export interface InspectorProps {
  topic: TopicView | null;
  allTopics: TopicView[];
  relationships: RelationshipView[];
  controller: AppController;
  onChanged: () => void;
  onClose: () => void;
  darkMode: boolean;
  onToast: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
  /** Larghezza da `lg` in su (px) e setter: la maniglia sul bordo sinistro la modifica. */
  width: number;
  onWidthChange: (width: number) => void;
  /** Elenco degli ID dei blocchi selezionati nella mappa (selezione multipla). */
  selectedTopicIds?: string[];
  /** Callback per creare un sommario sui blocchi fratelli selezionati. */
  onAddSummaryForSiblings?: () => void;
  /** Indica se i blocchi selezionati sono fratelli validi. */
  canAddSummary?: boolean;
}

export const Inspector: React.FC<InspectorProps> = ({
  topic,
  allTopics,
  relationships,
  controller,
  onChanged,
  onClose,
  darkMode,
  onToast,
  width,
  onWidthChange,
  selectedTopicIds,
  onAddSummaryForSiblings,
  canAddSummary,
}) => {
  if (!topic) return null;
  return (
    <InspectorBody
      key={topic.id}
      topic={topic}
      allTopics={allTopics}
      relationships={relationships}
      controller={controller}
      onChanged={onChanged}
      onClose={onClose}
      darkMode={darkMode}
      onToast={onToast}
      width={width}
      onWidthChange={onWidthChange}
      selectedTopicIds={selectedTopicIds}
      onAddSummaryForSiblings={onAddSummaryForSiblings}
      canAddSummary={canAddSummary}
    />
  );
};

const InspectorBody: React.FC<InspectorProps> = ({
  topic,
  allTopics,
  relationships,
  controller,
  onChanged,
  onClose,
  darkMode,
  onToast,
  width,
  onWidthChange,
  selectedTopicIds,
  onAddSummaryForSiblings,
  canAddSummary,
}) => {
  const t = topic as TopicView;
  const ts: TextStyle = t.textStyle ?? {};

  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const [notesDisplay, setNotesDisplay] = useState<'icon' | 'block' | ''>(
    (t.notesDisplay as 'icon' | 'block') || ''
  );
  const [labelsStr, setLabelsStr] = useState(t.labels.join(', '));
  const [href, setHref] = useState(t.href || '');
  const [color, setColor] = useState<string | null>(t.fillColor || null);

  const equation = useEquationDraft({ topic: t, controller, darkMode, onChanged, onToast });

  const [relTarget, setRelTarget] = useState('');
  const [relTitle, setRelTitle] = useState('');

  const [task, setTask] = useState<TaskData>(t.task || {});

  // Undo/redo (o modifiche da altre viste) cambiano il topic mentre il pannello è aperto:
  // i campi locali si riallineano al valore del modello.
  const labelsKey = t.labels.join(', ');
  const taskKey = JSON.stringify(t.task ?? null);
  useEffect(() => setTitle(t.title), [t.title]);
  useEffect(() => setNotes(t.notes), [t.notes]);
  useEffect(() => setNotesDisplay((t.notesDisplay as 'icon' | 'block') || ''), [t.notesDisplay]);
  useEffect(() => setLabelsStr(labelsKey), [labelsKey]);
  useEffect(() => setHref(t.href || ''), [t.href]);
  useEffect(() => setColor(t.fillColor || null), [t.fillColor]);
  useEffect(() => setTask(t.task || {}), [taskKey]);

  // Ctrl/Cmd+B e Ctrl/Cmd+I: attivi solo con questo ispettore montato (blocco selezionato)
  // e fuori da campi di testo, così non interferiscono con la digitazione.
  useEffect(() => {
    if (t.kind !== 'text') return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        applyTextStyle({ bold: !ts.bold });
      } else if (key === 'i') {
        e.preventDefault();
        applyTextStyle({ italic: !ts.italic });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t.kind, t.id, ts.bold, ts.italic, controller]);

  const commitTitle = () => {
    if (title === t.title) return;
    try {
      controller.setTopicTitle(t.id, title);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const commitNotes = () => {
    if (notes === t.notes) return;
    try {
      controller.setTopicNotes(t.id, notes);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const commitNotesDisplay = (value: 'icon' | 'block' | '') => {
    setNotesDisplay(value);
    try {
      controller.setTopicNotesDisplay(t.id, value === '' ? null : value);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const commitLabels = () => {
    const labels = labelsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (labels.join(',') === t.labels.join(',')) return;
    try {
      controller.setTopicLabels(t.id, labels);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const commitHref = () => {
    if ((t.href || '') === href.trim()) return;
    try {
      controller.setTopicHref(t.id, href.trim() || null);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const applyColor = (value: string | null) => {
    setColor(value);
    try {
      controller.setTopicColor(t.id, value);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const applyTextStyle = (patch: TextStylePatch) => {
    try {
      controller.setTopicTextStyle(t.id, patch);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const applyRelationshipShape = (relationshipId: string, shape: RelationshipShape) => {
    try {
      controller.setRelationshipShape(relationshipId, shape);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const toggleMarker = (markerId: string) => {
    try {
      controller.toggleTopicMarker(t.id, markerId);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const commitTask = (next: TaskData) => {
    setTask(next);
    try {
      if (!next.priority && !next.progress && !next.startDate && !next.dueDate) {
        controller.clearTopicTask(t.id);
      } else {
        controller.setTopicTask(t.id, next);
      }
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const addRelationship = () => {
    if (!relTarget) return;
    try {
      controller.addTopicRelationship(t.id, relTarget, relTitle.trim() || undefined);
      setRelTarget('');
      setRelTitle('');
      onChanged();
      onToast('success', 'Relazione aggiunta');
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const removeRelationship = (relationshipId: string) => {
    controller.removeTopicRelationship(relationshipId);
    onChanged();
  };

  const addBoundary = () => {
    try {
      controller.addTopicBoundary(t.id);
      onChanged();
      onToast('success', 'Cornice aggiunta');
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const removeBoundary = () => {
    controller.removeTopicBoundary(t.id, t.boundaries[0].id);
    onChanged();
  };

  const addSummary = () => {
    try {
      controller.addTopicSummary(t.id);
      onChanged();
      onToast('success', 'Sommario aggiunto');
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const removeSummary = () => {
    controller.removeTopicSummary(t.id, t.summaries[0].id);
    onChanged();
  };

  const handleDelete = () => {
    if (t.depth === 0) return;
    try {
      controller.removeTopic(t.id);
      onChanged();
      onClose();
      onToast('info', 'Blocco eliminato — Ctrl+Z per annullare');
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const handleAddChild = () => {
    controller.addTopic(t.id, 'Nuovo blocco');
    onChanged();
    onToast('success', 'Sotto-blocco aggiunto');
  };

  return (
    <aside
      style={panelStyle(width)}
      className={[
        'flex w-inspector shrink-0 animate-slide-in-right flex-col overflow-hidden border-l bg-background pb-[env(safe-area-inset-bottom)]',
        'lg:relative lg:w-[var(--panel-w)]',
        // Sotto lg: pannello sovrapposto a destra; sotto sm: bottom sheet a larghezza piena.
        'max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:max-w-full max-lg:shadow-dialog',
        'max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[60dvh] max-sm:w-full max-sm:rounded-t-xl max-sm:border-l-0 max-sm:border-t',
      ].join(' ')}
    >
      <ResizeHandle
        side="left"
        label="Ridimensiona pannello dettagli"
        width={width}
        min={INSPECTOR_PANEL.min}
        max={INSPECTOR_PANEL.max}
        defaultWidth={INSPECTOR_PANEL.defaultWidth}
        onChange={onWidthChange}
      />
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold leading-4">{t.displayTitle || '(senza titolo)'}</div>
          <div className="truncate text-2xs leading-3 text-muted-foreground">
            {t.path.slice(0, -1).join(' › ') || 'Radice'}
          </div>
        </div>
        <IconButton size="sm" variant="ghost" label="Aggiungi sotto-blocco" onClick={handleAddChild}>
          <Plus className="size-4" />
        </IconButton>
        {t.depth > 0 && (
          <IconButton size="sm" variant="ghost-destructive" label="Elimina blocco" onClick={handleDelete}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
        <IconButton size="sm" variant="ghost" label="Chiudi pannello" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <TextSection
          topic={t}
          title={title}
          onTitleChange={setTitle}
          onTitleCommit={commitTitle}
          textStyle={ts}
          onTextStyle={applyTextStyle}
        />
        <EquationSection hasEquation={!!t.latex} draft={equation} />
        <NotesSection
          notes={notes}
          hasNotes={!!t.notes}
          onNotesChange={setNotes}
          onNotesCommit={commitNotes}
          notesDisplay={notesDisplay}
          onNotesDisplayChange={commitNotesDisplay}
        />
        <LabelsSection
          labelCount={t.labels.length}
          labelsStr={labelsStr}
          onLabelsChange={setLabelsStr}
          onLabelsCommit={commitLabels}
          hasHref={!!t.href}
          href={href}
          onHrefChange={setHref}
          onHrefCommit={commitHref}
        />
        <MarkersSection markers={t.markers} onToggle={toggleMarker} />
        <BranchColorSection color={color} onColorChange={applyColor} />
        <TaskSection task={task} onTaskChange={commitTask} />
        <StructureSection
          topic={t}
          allTopics={allTopics}
          relationships={relationships}
          relTarget={relTarget}
          onRelTargetChange={setRelTarget}
          onAddRelationship={addRelationship}
          onRemoveRelationship={removeRelationship}
          onRelationshipShapeChange={applyRelationshipShape}
          onAddBoundary={addBoundary}
          onRemoveBoundary={removeBoundary}
          onAddSummary={addSummary}
          onRemoveSummary={removeSummary}
          selectedTopicIds={selectedTopicIds}
          onAddSummaryForSiblings={onAddSummaryForSiblings}
          canAddSummary={canAddSummary}
        />
      </div>
    </aside>
  );
};
