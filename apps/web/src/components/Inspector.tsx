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
import {
  Badge,
  Banner,
  Button,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  cn,
} from '@xmap/ui-kit';

// I valori di colore sono dati salvati nel file XMind (compatibilità col formato), non stile.
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
const TITLE_MODE_ITEMS: { id: 'formula_only' | 'keep_title' | 'custom'; label: string }[] = [
  { id: 'formula_only', label: 'Solo formula' },
  { id: 'keep_title', label: 'Mantieni titolo' },
  { id: 'custom', label: 'Titolo custom' },
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

// Anello di focus dei bottoni ui-kit, riusato dai controlli che non sono `Button`.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

const chipClass = (active: boolean) =>
  cn(
    'rounded-sm border px-1.5 py-0.5 text-2xs transition-colors',
    FOCUS_RING,
    active
      ? 'border-primary bg-primary/8 text-primary dark:bg-primary/16'
      : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  );

// Il bordo hairline tiene visibili bianco e nero in entrambi i temi; il selezionato usa l'anello primario.
const swatchHairline = 'ring-1 ring-inset ring-foreground/10';
const swatchSelected = 'ring-2 ring-primary ring-offset-2 ring-offset-background';

// Sezione richiudibile: il disclosure è comportamento locale, quindi non usa `Section` di ui-kit.
const InspectorSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, count, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex items-center text-muted-foreground">{icon}</span>
        <span className="flex-1">{title}</span>
        {typeof count === 'number' && count > 0 && <Badge variant="secondary" size="sm">{count}</Badge>}
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>}
    </section>
  );
};

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium">{children}</div>
);

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
    <aside
      className={[
        'flex w-inspector shrink-0 animate-slide-in-right flex-col overflow-hidden border-l bg-background pb-[env(safe-area-inset-bottom)]',
        // Sotto lg: pannello sovrapposto a destra; sotto sm: bottom sheet a larghezza piena.
        'max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:max-w-full max-lg:shadow-dialog',
        'max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[60dvh] max-sm:w-full max-sm:rounded-t-xl max-sm:border-l-0 max-sm:border-t',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{t.displayTitle || '(senza titolo)'}</div>
          <div className="truncate text-2xs text-muted-foreground">
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
        {/* Testo del blocco */}
        <InspectorSection title="Testo" icon={<FileText className="size-3.5" />}>
          <Field label="Titolo del blocco">
            <Input
              value={title}
              placeholder="Titolo…"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        </InspectorSection>

        {/* Equazione */}
        <InspectorSection
          title="Equazione LaTeX"
          icon={<Sigma className="size-3.5" />}
          count={t.latex ? 1 : undefined}
        >
          <div className="eq-preview">
            {preview?.error ? (
              <Banner variant="error" className="w-full" icon={<AlertCircle className="size-4" />}>
                {preview.error}
              </Banner>
            ) : preview?.svg ? (
              <div className="max-w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: preview.svg }} />
            ) : (
              <span className="text-2xs italic text-muted-foreground">Anteprima formula</span>
            )}
          </div>

          <Textarea
            mono
            rows={3}
            value={latex}
            placeholder="\\int_{0}^{1} x^2\\,dx"
            onChange={(e) => setLatex(e.target.value)}
          />

          <div className="flex flex-wrap gap-1">
            {TEMPLATES.map((tpl) => (
              <Button
                key={tpl.label}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setLatex((prev) => (prev ? `${prev} ${tpl.latex}` : tpl.latex))}
              >
                {tpl.label}
              </Button>
            ))}
          </div>

          <SegmentedControl
            size="sm"
            className="grid w-full grid-cols-3"
            items={TITLE_MODE_ITEMS}
            activeId={titleMode}
            onChange={(id) => setTitleMode(id)}
          />

          {titleMode === 'custom' && (
            <Input
              value={customTitle}
              placeholder="Titolo mostrato"
              onChange={(e) => setCustomTitle(e.target.value)}
            />
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Colore</span>
            <div className="flex items-center gap-1.5">
              {INK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Inchiostro ${c}`}
                  aria-pressed={inkColor === c}
                  onClick={() => setInkColor(c)}
                  className={cn(
                    'size-[18px] rounded-full',
                    FOCUS_RING,
                    inkColor === c ? swatchSelected : swatchHairline
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              disabled={!latex.trim() || !!preview?.error || applying}
              onClick={handleApplyEquation}
            >
              {applying ? 'Rendering…' : t.latex ? 'Aggiorna equazione' : 'Applica equazione'}
            </Button>
            {t.latex && (
              <Button variant="ghost" size="sm" onClick={handleRemoveEquation}>
                Rimuovi
              </Button>
            )}
          </div>
        </InspectorSection>

        {/* Note */}
        <InspectorSection
          title="Note"
          icon={<FileText className="size-3.5" />}
          defaultOpen={false}
          count={t.notes ? 1 : undefined}
        >
          <Textarea
            rows={4}
            value={notes}
            placeholder="Appunti estesi del blocco…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={commitNotes}
          />
          <Field label="Visualizzazione in XMind">
            <Select
              value={notesDisplay}
              onChange={(e) => commitNotesDisplay(e.target.value as 'icon' | 'block' | '')}
            >
              <option value="">Predefinita (icona)</option>
              <option value="icon">Icona</option>
              <option value="block">Riquadro espanso</option>
            </Select>
          </Field>
        </InspectorSection>

        {/* Etichette e link */}
        <InspectorSection
          title="Etichette e link"
          icon={<Tag className="size-3.5" />}
          defaultOpen={false}
          count={t.labels.length || (t.href ? 1 : 0)}
        >
          <Field label="Etichette (separate da virgola)">
            <Input
              value={labelsStr}
              placeholder="Importante, Revisione"
              onChange={(e) => setLabelsStr(e.target.value)}
              onBlur={commitLabels}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </Field>
          <Field label="Link (URL, mailto:, file: o #id)">
            <Input
              value={href}
              placeholder="https://…"
              onChange={(e) => setHref(e.target.value)}
              onBlur={commitHref}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        </InspectorSection>

        {/* Marker */}
        <InspectorSection
          title="Marker"
          icon={<Flag className="size-3.5" />}
          defaultOpen={false}
          count={t.markers.length}
        >
          {t.markers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {t.markers.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMarker(m)}
                  title="Rimuovi marker"
                  className={cn(
                    'flex items-center gap-1 rounded-sm bg-primary/8 px-1.5 py-0.5 text-2xs text-primary dark:bg-primary/16',
                    FOCUS_RING
                  )}
                >
                  {markerDisplayName(m)}
                  <X className="size-3.5" />
                </button>
              ))}
            </div>
          )}
          <div className="flex max-h-52 flex-col gap-2 overflow-y-auto pr-1">
            {GROUPS.map((group) => (
              <div key={group.id}>
                <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
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
                        aria-pressed={active}
                        title={m.name}
                        className={chipClass(active)}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </InspectorSection>

        {/* Colore ramo */}
        <InspectorSection title="Colore del ramo" icon={<Palette className="size-3.5" />} defaultOpen={false}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={!color}
              onClick={() => applyColor(null)}
              className={cn(chipClass(!color), 'flex h-6 items-center px-2')}
            >
              Nessuno
            </button>
            {BRANCH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colore ${c}`}
                aria-pressed={color === c}
                onClick={() => applyColor(c)}
                className={cn(
                  'size-5 rounded-full',
                  FOCUS_RING,
                  color === c ? swatchSelected : swatchHairline
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </InspectorSection>

        {/* Task */}
        <InspectorSection
          title="Task"
          icon={<ListChecks className="size-3.5" />}
          defaultOpen={false}
          count={t.task ? 1 : undefined}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Priorità">
              <Select
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
              </Select>
            </Field>
            <Field label="Avanzamento %">
              <Input
                type="number"
                min={0}
                max={100}
                value={task.progress ?? ''}
                onChange={(e) =>
                  commitTask({ ...task, progress: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </Field>
            <Field label="Inizio">
              <Input
                type="date"
                value={toDateInput(task.startDate)}
                onChange={(e) => commitTask({ ...task, startDate: fromDateInput(e.target.value) })}
              />
            </Field>
            <Field label="Scadenza">
              <Input
                type="date"
                value={toDateInput(task.dueDate)}
                onChange={(e) => commitTask({ ...task, dueDate: fromDateInput(e.target.value) })}
              />
            </Field>
          </div>
          {(task.priority || task.progress || task.startDate || task.dueDate) && (
            <Button variant="ghost" size="sm" onClick={() => commitTask({})}>
              Azzera task
            </Button>
          )}
        </InspectorSection>

        {/* Struttura */}
        <InspectorSection
          title="Struttura"
          icon={<GitBranch className="size-3.5" />}
          defaultOpen={false}
          count={rels.length || t.boundaries.length || t.summaries.length}
        >
          <div className="flex flex-col gap-1.5">
            <GroupLabel>Relazioni</GroupLabel>
            {rels.length === 0 && <div className="text-2xs text-muted-foreground">Nessuna relazione.</div>}
            {rels.map((r) => {
              const otherId = r.end1Id === t.id ? r.end2Id : r.end1Id;
              const other = allTopics.find((x) => x.id === otherId);
              return (
                <div key={r.id} className="flex items-center gap-1.5 text-2xs">
                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">
                    {r.end1Id === t.id ? '→' : '←'} {other?.displayTitle || otherId}
                    {r.title ? ` · ${r.title}` : ''}
                  </span>
                  <button
                    type="button"
                    aria-label="Rimuovi relazione"
                    onClick={() => {
                      controller.removeTopicRelationship(r.id);
                      onChanged();
                    }}
                    className={cn('rounded-sm text-muted-foreground hover:text-error-foreground', FOCUS_RING)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
            <div className="flex items-center gap-1.5">
              <Select value={relTarget} onChange={(e) => setRelTarget(e.target.value)}>
                <option value="">Collega a…</option>
                {otherTopics.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayTitle || o.id}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" disabled={!relTarget} onClick={addRelationship}>
                Aggiungi
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <GroupLabel>Sotto-blocchi</GroupLabel>
            {!hasChildren && (
              <div className="text-2xs text-muted-foreground">
                Aggiungi almeno un sotto-blocco per cornice o sommario.
              </div>
            )}
            {hasChildren && (
              <div className="flex items-center gap-1.5">
                {t.boundaries.length === 0 ? (
                  <Button size="sm" variant="ghost" icon={<Boxes className="size-4" />} onClick={addBoundary}>
                    Cornice
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      controller.removeTopicBoundary(t.id, t.boundaries[0].id);
                      onChanged();
                    }}
                  >
                    Rimuovi cornice
                  </Button>
                )}
                {t.summaries.length === 0 ? (
                  <Button size="sm" variant="ghost" icon={<Boxes className="size-4" />} onClick={addSummary}>
                    Sommario
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
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
        </InspectorSection>
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
