import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppController,
  GROUPS,
  RelationshipView,
  TaskData,
  TitleMode,
  TopicView,
  markerDisplayName,
} from '@xmap/core';
import {
  Plus,
  Trash2,
  Sigma,
  FileText,
  Tag,
  Flag,
  Link2,
  Palette,
  ListChecks,
  GitBranch,
  Boxes,
  ChevronDown,
  ChevronRight,
  X,
  AlertCircle,
} from 'lucide-react';
import { Button, IconButton, cn } from '@xmap/ui-kit';

const BRANCH_COLORS = ['#E65D5D', '#E9863F', '#C99A12', '#79A83B', '#1599B5', '#7953A9', '#4E5D6C'];
const INK_COLORS = ['#000000', '#ffffff', '#3b6cf6', '#e5484d', '#2f9e63', '#7953a9'];
const TEMPLATES = [
  { label: 'Frazione', latex: '\\frac{a}{b}' },
  { label: 'Integrale', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: 'Sommatoria', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Radice', latex: '\\sqrt{x^2+y^2}' },
  { label: 'Limite', latex: '\\lim_{x\\to\\infty}\\frac{1}{x}=0' },
  { label: 'Matrice', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
];

export interface InspectorProps {
  topic: TopicView | null;
  allTopics: TopicView[];
  relationships: RelationshipView[];
  controller: AppController;
  onChanged: () => void;
  onClose: () => void;
  darkMode: boolean;
  onToast: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, count, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--adw-hairline)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[var(--adw-fg-color)] hover:bg-[var(--adw-button-hover)]"
      >
        <span className="text-[var(--adw-muted-color)] flex items-center">{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)]">
            {count}
          </span>
        )}
        {open ? <ChevronDown className="w-3.5 h-3.5 opacity-50" /> : <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
      </button>
      {open && <div className="px-4 pb-4 pt-0.5 space-y-2.5">{children}</div>}
    </div>
  );
};

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[11px] font-medium text-[var(--adw-muted-color)] mb-1">{children}</label>
);

const inputClass =
  'w-full h-8 px-2.5 rounded-md border border-[var(--adw-card-border)] bg-[var(--adw-bg-color)] text-[13px] text-[var(--adw-fg-color)] placeholder:text-[var(--adw-muted-color)] focus:outline-none focus:border-[var(--adw-accent-color)]';

const textareaClass =
  'w-full px-2.5 py-2 rounded-md border border-[var(--adw-card-border)] bg-[var(--adw-bg-color)] text-[13px] text-[var(--adw-fg-color)] placeholder:text-[var(--adw-muted-color)] focus:outline-none focus:border-[var(--adw-accent-color)] resize-y';

export const Inspector: React.FC<InspectorProps> = ({
  topic,
  allTopics,
  relationships,
  controller,
  onChanged,
  onClose,
  darkMode,
  onToast,
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
}) => {
  const t = topic as TopicView;

  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const [notesDisplay, setNotesDisplay] = useState<'icon' | 'block' | ''>(
    (t.notesDisplay as 'icon' | 'block') || ''
  );
  const [labelsStr, setLabelsStr] = useState(t.labels.join(', '));
  const [href, setHref] = useState(t.href || '');
  const [color, setColor] = useState<string | null>(t.fillColor || null);

  const [latex, setLatex] = useState(t.latex || '');
  const [titleMode, setTitleMode] = useState<'formula_only' | 'keep_title' | 'custom'>('formula_only');
  const [customTitle, setCustomTitle] = useState(t.title);
  const [inkColor, setInkColor] = useState('#000000');
  const [preview, setPreview] = useState<{ svg: string; error: string | null } | null>(null);
  const [applying, setApplying] = useState(false);

  const [relTarget, setRelTarget] = useState('');
  const [relTitle, setRelTitle] = useState('');

  const [task, setTask] = useState<TaskData>(t.task || {});

  // L'inchiostro salvato resta nero (compatibilità XMind); in tema scuro
  // l'anteprima usa il colore del testo solo per la visualizzazione.
  const previewInk = inkColor === '#000000' && darkMode ? '#ffffff' : inkColor;

  // Anteprima LaTeX con debounce.
  const previewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    const trimmed = latex.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    previewTimer.current = window.setTimeout(() => {
      try {
        const res = controller.preview(trimmed, 28);
        if (res.error) {
          setPreview({ svg: '', error: res.error });
        } else {
          setPreview({ svg: res.svg.replaceAll('currentColor', previewInk), error: null });
        }
      } catch (err: any) {
        setPreview({ svg: '', error: err?.message || 'Errore di sintassi' });
      }
    }, 220);
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [latex, inkColor, darkMode, controller]);

  const rels = useMemo(
    () => relationships.filter((r) => r.end1Id === t.id || r.end2Id === t.id),
    [relationships, t.id]
  );

  const otherTopics = useMemo(() => allTopics.filter((x) => x.id !== t.id), [allTopics, t.id]);
  const hasChildren = t.childCount > 0;

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

  const toggleMarker = (markerId: string) => {
    try {
      controller.toggleTopicMarker(t.id, markerId);
      onChanged();
    } catch (err: any) {
      onToast('error', err.message);
    }
  };

  const handleApplyEquation = async () => {
    if (!latex.trim() || preview?.error) return;
    setApplying(true);
    try {
      let mode: TitleMode;
      if (titleMode === 'keep_title') mode = { kind: 'keep_title' };
      else if (titleMode === 'custom') mode = { kind: 'custom', title: customTitle };
      else mode = { kind: 'formula_only' };
      await controller.apply(t.id, latex.trim(), { titleMode: mode, color: inkColor });
      onChanged();
      onToast('success', 'Equazione applicata');
    } catch (err: any) {
      onToast('error', `Errore: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveEquation = () => {
    try {
      controller.removeEquation(t.id);
      onChanged();
      onToast('info', 'Equazione rimossa');
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

  const addBoundary = () => {
    try {
      controller.addTopicBoundary(t.id);
      onChanged();
      onToast('success', 'Cornice aggiunta');
    } catch (err: any) {
      onToast('error', err.message);
    }
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

  const handleDelete = () => {
    if (t.depth === 0) return;
    if (!confirm(`Eliminare «${t.displayTitle}» e i suoi sotto-blocchi?`)) return;
    try {
      controller.removeTopic(t.id);
      onChanged();
      onClose();
      onToast('info', 'Blocco eliminato');
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
    <aside className="w-[340px] shrink-0 border-l border-[var(--adw-card-border)] bg-[var(--adw-bg-color)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--adw-card-border)]">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate">
              {t.displayTitle || '(senza titolo)'}
            </div>
            <div className="text-[11px] text-[var(--adw-muted-color)] truncate">
              {t.path.slice(0, -1).join(' › ') || 'Radice'}
            </div>
          </div>
          <IconButton size="sm" title="Aggiungi sotto-blocco" onClick={handleAddChild}>
            <Plus className="w-4 h-4" />
          </IconButton>
          {t.depth > 0 && (
            <IconButton size="sm" variant="destructive" title="Elimina blocco" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" />
            </IconButton>
          )}
          <IconButton size="sm" title="Chiudi pannello" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Testo del blocco */}
        <Section title="Testo" icon={<FileText className="w-3.5 h-3.5" />}>
          <div>
            <FieldLabel>Titolo del blocco</FieldLabel>
            <input
              className={inputClass}
              value={title}
              placeholder="Titolo…"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </Section>

        {/* Equazione */}
        <Section title="Equazione LaTeX" icon={<Sigma className="w-3.5 h-3.5" />} count={t.latex ? 1 : undefined}>
          <div className="rounded-lg border border-[var(--adw-card-border)] bg-[var(--adw-surface)] min-h-[64px] flex items-center justify-center p-3">
            {preview?.error ? (
              <div className="flex items-center gap-2 text-[var(--adw-destructive-color)] text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{preview.error}</span>
              </div>
            ) : preview?.svg ? (
              <div className="max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: preview.svg }} />
            ) : (
              <span className="text-[11px] text-[var(--adw-muted-color)] italic">Anteprima formula</span>
            )}
          </div>

          <textarea
            className={cn(textareaClass, 'font-mono text-xs')}
            rows={3}
            value={latex}
            placeholder="\\int_{0}^{1} x^2\\,dx"
            onChange={(e) => setLatex(e.target.value)}
          />

          <div className="flex flex-wrap gap-1">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() => setLatex((prev) => (prev ? `${prev} ${tpl.latex}` : tpl.latex))}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[var(--adw-muted-color)] bg-[var(--adw-surface)] border border-[var(--adw-card-border)] hover:text-[var(--adw-fg-color)]"
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ['formula_only', 'Solo formula'],
                ['keep_title', 'Mantieni titolo'],
                ['custom', 'Titolo custom'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTitleMode(mode)}
                className={cn(
                  'h-7 rounded-md text-[11px] border transition-colors',
                  titleMode === mode
                    ? 'border-[var(--adw-accent-color)] bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)] font-medium'
                    : 'border-[var(--adw-card-border)] text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {titleMode === 'custom' && (
            <input
              className={inputClass}
              value={customTitle}
              placeholder="Titolo mostrato"
              onChange={(e) => setCustomTitle(e.target.value)}
            />
          )}

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--adw-muted-color)]">Colore</span>
            <div className="flex items-center gap-1.5">
              {INK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setInkColor(c)}
                  className={cn(
                    'w-[18px] h-[18px] rounded-full border border-black/15 dark:border-white/20',
                    inkColor === c && 'ring-2 ring-[var(--adw-accent-color)] ring-offset-1 ring-offset-[var(--adw-bg-color)]'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="suggested"
              size="sm"
              className="flex-1"
              disabled={!latex.trim() || !!preview?.error || applying}
              onClick={handleApplyEquation}
            >
              {applying ? 'Rendering…' : t.latex ? 'Aggiorna equazione' : 'Applica equazione'}
            </Button>
            {t.latex && (
              <Button variant="flat" size="sm" onClick={handleRemoveEquation}>
                Rimuovi
              </Button>
            )}
          </div>
        </Section>

        {/* Note */}
        <Section title="Note" icon={<FileText className="w-3.5 h-3.5" />} defaultOpen={false} count={t.notes ? 1 : undefined}>
          <textarea
            className={textareaClass}
            rows={4}
            value={notes}
            placeholder="Appunti estesi del blocco…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={commitNotes}
          />
          <div>
            <FieldLabel>Visualizzazione in XMind</FieldLabel>
            <select
              className={inputClass}
              value={notesDisplay}
              onChange={(e) => commitNotesDisplay(e.target.value as 'icon' | 'block' | '')}
            >
              <option value="">Predefinita (icona)</option>
              <option value="icon">Icona</option>
              <option value="block">Riquadro espanso</option>
            </select>
          </div>
        </Section>

        {/* Etichette e link */}
        <Section title="Etichette e link" icon={<Tag className="w-3.5 h-3.5" />} defaultOpen={false} count={t.labels.length || (t.href ? 1 : 0)}>
          <div>
            <FieldLabel>Etichette (separate da virgola)</FieldLabel>
            <input
              className={inputClass}
              value={labelsStr}
              placeholder="Importante, Revisione"
              onChange={(e) => setLabelsStr(e.target.value)}
              onBlur={commitLabels}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <div>
            <FieldLabel>Link (URL, mailto:, file: o #id)</FieldLabel>
            <div className="flex items-center gap-1.5">
              <input
                className={inputClass}
                value={href}
                placeholder="https://…"
                onChange={(e) => setHref(e.target.value)}
                onBlur={commitHref}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </div>
          </div>
        </Section>

        {/* Marker */}
        <Section title="Marker" icon={<Flag className="w-3.5 h-3.5" />} defaultOpen={false} count={t.markers.length}>
          {t.markers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {t.markers.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMarker(m)}
                  title="Rimuovi marker"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)]"
                >
                  {markerDisplayName(m)}
                  <X className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {GROUPS.map((group) => (
              <div key={group.id}>
                <div className="text-[10px] uppercase tracking-wide text-[var(--adw-muted-color)] mb-1">
                  {group.label}
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.markers.map((m) => {
                    const active = t.markers.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMarker(m.id)}
                        title={m.name}
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] border transition-colors',
                          active
                            ? 'border-[var(--adw-accent-color)] bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)]'
                            : 'border-[var(--adw-card-border)] text-[var(--adw-muted-color)] hover:text-[var(--adw-fg-color)]'
                        )}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Colore ramo */}
        <Section title="Colore del ramo" icon={<Palette className="w-3.5 h-3.5" />} defaultOpen={false}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyColor(null)}
              className={cn(
                'px-2 h-6 rounded text-[11px] border',
                !color
                  ? 'border-[var(--adw-accent-color)] text-[var(--adw-accent-color)]'
                  : 'border-[var(--adw-card-border)] text-[var(--adw-muted-color)]'
              )}
            >
              Nessuno
            </button>
            {BRANCH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => applyColor(c)}
                className={cn(
                  'w-5 h-5 rounded-full border border-black/15 dark:border-white/20',
                  color === c && 'ring-2 ring-[var(--adw-accent-color)] ring-offset-1 ring-offset-[var(--adw-bg-color)]'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Section>

        {/* Task */}
        <Section title="Task" icon={<ListChecks className="w-3.5 h-3.5" />} defaultOpen={false} count={t.task ? 1 : undefined}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>Priorità</FieldLabel>
              <select
                className={inputClass}
                value={task.priority ?? ''}
                onChange={(e) =>
                  commitTask({ ...task, priority: e.target.value ? Number(e.target.value) : undefined })
                }
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Avanzamento %</FieldLabel>
              <input
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={task.progress ?? ''}
                onChange={(e) =>
                  commitTask({ ...task, progress: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </div>
            <div>
              <FieldLabel>Inizio</FieldLabel>
              <input
                type="date"
                className={inputClass}
                value={toDateInput(task.startDate)}
                onChange={(e) => commitTask({ ...task, startDate: fromDateInput(e.target.value) })}
              />
            </div>
            <div>
              <FieldLabel>Scadenza</FieldLabel>
              <input
                type="date"
                className={inputClass}
                value={toDateInput(task.dueDate)}
                onChange={(e) => commitTask({ ...task, dueDate: fromDateInput(e.target.value) })}
              />
            </div>
          </div>
          {(task.priority || task.progress || task.startDate || task.dueDate) && (
            <Button variant="flat" size="sm" onClick={() => commitTask({})}>
              Azzera task
            </Button>
          )}
        </Section>

        {/* Struttura */}
        <Section title="Struttura" icon={<GitBranch className="w-3.5 h-3.5" />} defaultOpen={false} count={rels.length || t.boundaries.length || t.summaries.length}>
          <div className="space-y-1.5">
            <FieldLabel>Relazioni</FieldLabel>
            {rels.length === 0 && <div className="text-[11px] text-[var(--adw-muted-color)]">Nessuna relazione.</div>}
            {rels.map((r) => {
              const otherId = r.end1Id === t.id ? r.end2Id : r.end1Id;
              const other = allTopics.find((x) => x.id === otherId);
              return (
                <div key={r.id} className="flex items-center gap-1.5 text-[11px]">
                  <GitBranch className="w-3 h-3 text-[var(--adw-muted-color)] shrink-0" />
                  <span className="flex-1 truncate">
                    {r.end1Id === t.id ? '→' : '←'} {other?.displayTitle || otherId}
                    {r.title ? ` · ${r.title}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      controller.removeTopicRelationship(r.id);
                      onChanged();
                    }}
                    className="text-[var(--adw-muted-color)] hover:text-[var(--adw-destructive-color)]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            <div className="flex items-center gap-1.5">
              <select className={inputClass} value={relTarget} onChange={(e) => setRelTarget(e.target.value)}>
                <option value="">Collega a…</option>
                {otherTopics.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayTitle || o.id}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="flat" disabled={!relTarget} onClick={addRelationship}>
                Aggiungi
              </Button>
            </div>
          </div>

          <div className="pt-1 space-y-1.5">
            <FieldLabel>Sotto-blocchi</FieldLabel>
            {!hasChildren && (
              <div className="text-[11px] text-[var(--adw-muted-color)]">
                Aggiungi almeno un sotto-blocco per cornice o sommario.
              </div>
            )}
            {hasChildren && (
              <div className="flex items-center gap-1.5">
                {t.boundaries.length === 0 ? (
                  <Button size="sm" variant="flat" icon={<Boxes className="w-3.5 h-3.5" />} onClick={addBoundary}>
                    Cornice
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="flat"
                    onClick={() => {
                      controller.removeTopicBoundary(t.id, t.boundaries[0].id);
                      onChanged();
                    }}
                  >
                    Rimuovi cornice
                  </Button>
                )}
                {t.summaries.length === 0 ? (
                  <Button size="sm" variant="flat" icon={<Boxes className="w-3.5 h-3.5" />} onClick={addSummary}>
                    Sommario
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="flat"
                    onClick={() => {
                      controller.removeTopicSummary(t.id, t.summaries[0].id);
                      onChanged();
                    }}
                  >
                    Rimuovi sommario
                  </Button>
                )}
              </div>
            )}
          </div>
        </Section>
      </div>
    </aside>
  );
};

function toDateInput(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}
