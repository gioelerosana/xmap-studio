import React, { useState, useEffect } from 'react';
import { TopicView, GROUPS, renderLatexToSvg } from '@xmap/core';
import { Button } from '@xmap/ui-kit';
import {
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Tag,
  Link as LinkIcon,
  FileText,
  Palette,
  Share2,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';

export interface TopicEditorProps {
  topic: TopicView | null;
  allTopics: TopicView[];
  onApplyLatex: (
    topicId: string,
    latex: string,
    options: { titleMode: any; color?: string }
  ) => void;
  onRemoveLatex?: (topicId: string) => void;
  onSaveTopicDetails: (updates: {
    title: string;
    notes: string;
    notesDisplay?: 'icon' | 'block' | null;
    labels: string[];
    href?: string;
    color?: string | null;
    markerToggle?: string;
  }) => void;
  onAddChild: (parentId: string) => void;
  onDeleteTopic: (topicId: string) => void;
  onAddRelationship?: (fromId: string, toId: string, title?: string) => void;
  darkMode?: boolean;
}

const TEMPLATES = [
  { label: 'Frazione', latex: '\\frac{a}{b}' },
  { label: 'Radice', latex: '\\sqrt{x^2 + y^2}' },
  { label: 'Integrale', latex: '\\int_{a}^{b} f(x) \\, dx' },
  { label: 'Sommatoria', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Matrice', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Limiti', latex: '\\lim_{x \\to \\infty} \\frac{1}{x} = 0' },
];

const BRANCH_PALETTE = [
  { label: 'Predefinito', color: null },
  { label: 'Blu Adwaita', color: '#3584e4' },
  { label: 'Verde', color: '#33d17a' },
  { label: 'Giallo', color: '#e5a50a' },
  { label: 'Arancione', color: '#ff7800' },
  { label: 'Rosso', color: '#e01b24' },
  { label: 'Viola', color: '#9141ac' },
  { label: 'Turchese', color: '#26a269' },
  { label: 'Grigio', color: '#77767b' },
];

export const TopicEditor: React.FC<TopicEditorProps> = ({
  topic,
  allTopics,
  onApplyLatex,
  onRemoveLatex,
  onSaveTopicDetails,
  onAddChild,
  onDeleteTopic,
  onAddRelationship,
  darkMode = true,
}) => {
  // Stati locali per l'editing
  const [latexInput, setLatexInput] = useState('');
  const [svgPreview, setSvgPreview] = useState<string>('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [titleMode, setTitleMode] = useState<'formula_only' | 'keep_title' | 'custom'>('formula_only');
  const [customTitle, setCustomTitle] = useState('');

  // Stati per altri attributi
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [notesDisplay, setNotesDisplay] = useState<'icon' | 'block' | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [href, setHref] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string>('');
  const [relTargetId, setRelTargetId] = useState<string>('');
  const [relTitle, setRelTitle] = useState<string>('');

  // Espansione delle sezioni
  const [expandTitle, setExpandTitle] = useState(false);
  const [expandNotes, setExpandNotes] = useState(false);
  const [expandLabels, setExpandLabels] = useState(false);
  const [expandMarkers, setExpandMarkers] = useState(false);
  const [expandHref, setExpandHref] = useState(false);
  const [expandStyle, setExpandStyle] = useState(false);
  const [expandStructure, setExpandStructure] = useState(false);

  // Sincronizza lo stato quando cambia il topic selezionato
  useEffect(() => {
    if (topic) {
      setTitle(topic.title);
      setLatexInput(topic.latex || '');
      setCustomTitle(topic.title);
      setTitleMode('formula_only');
      setNotes(topic.notes || '');
      setNotesDisplay((topic.notesDisplay as 'icon' | 'block' | null) ?? null);
      setLabels([...topic.labels]);
      setHref(topic.href || '');
      setSelectedColor(topic.fillColor || null);
    }
  }, [topic?.id]);

  // Anteprima Live MathJax con debounce ~180ms
  useEffect(() => {
    if (!latexInput.trim()) {
      setSvgPreview('');
      setPreviewError(null);
      return;
    }

    const timer = setTimeout(() => {
      try {
        const res = renderLatexToSvg(latexInput.trim(), 24);
        if (res.error) {
          setPreviewError(res.error);
          setSvgPreview('');
        } else {
          setPreviewError(null);
          setSvgPreview(res.svg);
        }
      } catch (err: any) {
        setPreviewError(err.message || 'Errore di sintassi');
        setSvgPreview('');
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [latexInput]);

  if (!topic) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none bg-adw-bg">
        <div className="max-w-md space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-adw-card border border-adw-cardBorder flex items-center justify-center mx-auto text-adw-accent shadow-sm">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="title-2 text-adw-fg">Nessun blocco selezionato</h3>
          <p className="text-xs text-adw-fg/60 leading-relaxed">
            Seleziona un blocco dall'albero a sinistra o dalla mappa per inserire
            o modificare una formula LaTeX, note ed attributi.
          </p>
          <p className="caption dim-label pt-2">
            La formula viene scritta nel formato nativo di XMind: resta
            modificabile cliccandoci sopra dentro XMind.
          </p>
        </div>
      </div>
    );
  }

  const handleApplyFormula = () => {
    if (!topic || !latexInput.trim() || previewError) return;
    let modeObj: any = { kind: titleMode };
    if (titleMode === 'custom') {
      modeObj = { kind: 'custom', title: customTitle.trim() || title };
    }
    onApplyLatex(topic.id, latexInput.trim(), {
      titleMode: modeObj,
      color: darkMode ? '#ffffff' : '#000000',
    });
  };

  const handleInsertTemplate = (tpl: string) => {
    setLatexInput((prev) => (prev ? `${prev} ${tpl}` : tpl));
  };

  const handleAddLabel = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newLabel.trim()) {
      e.preventDefault();
      const val = newLabel.trim();
      if (!labels.includes(val)) {
        const next = [...labels, val];
        setLabels(next);
        onSaveTopicDetails({
          title,
          notes,
          notesDisplay,
          labels: next,
          href: href || undefined,
          color: selectedColor,
        });
      }
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    const next = labels.filter((l) => l !== labelToRemove);
    setLabels(next);
    onSaveTopicDetails({
      title,
      notes,
      notesDisplay,
      labels: next,
      href: href || undefined,
      color: selectedColor,
    });
  };

  const handleAddMarker = (markerId: string) => {
    if (!markerId) return;
    onSaveTopicDetails({
      title,
      notes,
      notesDisplay,
      labels,
      href: href || undefined,
      color: selectedColor,
      markerToggle: markerId,
    });
    setSelectedMarkerId('');
  };

  const handleSaveNotes = () => {
    onSaveTopicDetails({
      title,
      notes,
      notesDisplay,
      labels,
      href: href || undefined,
      color: selectedColor,
    });
  };

  const handleSaveTitleAndText = () => {
    onSaveTopicDetails({
      title: titleMode === 'custom' && customTitle.trim() ? customTitle.trim() : title,
      notes,
      notesDisplay,
      labels,
      href: href || undefined,
      color: selectedColor,
    });
  };

  const handleSaveHref = () => {
    onSaveTopicDetails({
      title,
      notes,
      notesDisplay,
      labels,
      href: href.trim() || undefined,
      color: selectedColor,
    });
  };

  const handleColorChange = (color: string | null) => {
    setSelectedColor(color);
    onSaveTopicDetails({
      title,
      notes,
      notesDisplay,
      labels,
      href: href || undefined,
      color,
    });
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-adw-bg p-4 md:p-6 lg:p-8 select-none transition-colors duration-150">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* 1. Intestazione del Blocco e Breadcrumb */}
        <div className="flex items-start justify-between border-b border-adw-cardBorder pb-4">
          <div className="space-y-1">
            <div className="text-[11px] dim-label font-medium truncate max-w-lg">
              {topic.path.join(' › ')}
            </div>
            <div className="flex items-center space-x-2.5">
              <h2 className="title-2 text-adw-fg">
                {topic.displayTitle || topic.title || '(senza titolo)'}
              </h2>
              <span className="kind-badge">
                {topic.kind === 'equation' || topic.latex
                  ? 'Formula LaTeX'
                  : topic.kind === 'image'
                  ? 'Immagine'
                  : 'Testo'}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <Button
              variant="flat"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => onAddChild(topic.id)}
              title="Aggiungi sotto-blocco (Ctrl+Shift+N)"
            >
              Sotto-blocco
            </Button>
            {topic.depth > 0 && (
              <Button
                variant="destructive"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  if (confirm('Eliminare questo blocco e i suoi sotto-blocchi?')) {
                    onDeleteTopic(topic.id);
                  }
                }}
                title="Elimina il blocco e i suoi sotto-blocchi"
              >
                Elimina
              </Button>
            )}
          </div>
        </div>

        {/* 2. CARD FORMULA LATEX (Il core di XMap Studio) */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-adw-accent" />
              <label className="text-xs font-semibold text-adw-fg uppercase tracking-wider">
                Formula LaTeX (MathJax)
              </label>
            </div>
            {topic.latex && onRemoveLatex && (
              <button
                type="button"
                onClick={() => onRemoveLatex(topic.id)}
                className="text-xs text-adw-destructive hover:underline"
              >
                Rimuovi equazione
              </button>
            )}
          </div>

          {/* Chips Modelli Rapidi */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() => handleInsertTemplate(tpl.latex)}
                className="px-2 py-0.5 text-[11px] rounded-md bg-adw-bg border border-adw-cardBorder hover:bg-black/5 dark:hover:bg-white/5 text-adw-fg font-mono transition-colors"
                title={`Inserisci ${tpl.latex}`}
              >
                {tpl.label}
              </button>
            ))}
          </div>

          {/* Editor Testuale Monospace */}
          <textarea
            value={latexInput}
            onChange={(e) => setLatexInput(e.target.value)}
            rows={3}
            placeholder="Es. \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
            className="w-full font-mono text-xs p-3 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg placeholder:text-adw-fg/30 focus:outline-none focus:ring-2 focus:ring-adw-focusRing resize-y min-h-[72px]"
          />

          {/* Striscia di Anteprima Live MathJax */}
          {(svgPreview || previewError) && (
            <div
              className={`eq-preview ${
                darkMode ? 'eq-preview-dark' : 'eq-preview-light'
              }`}
            >
              {previewError ? (
                <div className="flex items-center space-x-2 text-xs text-adw-destructive font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Errore formula: {previewError}</span>
                </div>
              ) : svgPreview ? (
                <div
                  className="flex items-center justify-center max-w-full overflow-x-auto py-1"
                  dangerouslySetInnerHTML={{ __html: svgPreview }}
                />
              ) : null}
            </div>
          )}

          {/* Azioni Formula */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="suggested"
              size="sm"
              disabled={!latexInput.trim() || Boolean(previewError)}
              onClick={handleApplyFormula}
            >
              Applica Formula
            </Button>
            <span className="caption dim-label">
              «Applica» modifica solo in memoria: usa Salva (Ctrl+S) per scrivere il file.
            </span>
          </div>
        </div>

        {/* 3. SEZIONE: Testo e Titolo del Blocco */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandTitle(!expandTitle)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <span>Testo e Titolo del Blocco</span>
            {expandTitle ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandTitle && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              <div>
                <label className="caption dim-label block mb-1">Testo del blocco</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg focus:outline-none focus:ring-2 focus:ring-adw-focusRing"
                  />
                  <Button variant="flat" size="sm" onClick={handleSaveTitleAndText}>
                    Applica
                  </Button>
                </div>
              </div>

              <div>
                <label className="caption dim-label block mb-1">Modalità titolo</label>
                <select
                  value={titleMode}
                  onChange={(e) => setTitleMode(e.target.value as any)}
                  className="w-full px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg focus:outline-none"
                >
                  <option value="formula_only">Solo formula (nasconde il testo)</option>
                  <option value="keep_title">Mantieni il titolo attuale</option>
                  <option value="custom">Titolo personalizzato</option>
                </select>
              </div>

              {titleMode === 'custom' && (
                <div>
                  <label className="caption dim-label block mb-1">Titolo personalizzato</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Titolo visualizzato"
                    className="w-full px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg focus:outline-none focus:ring-2 focus:ring-adw-focusRing"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. SEZIONE: Note */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandNotes(!expandNotes)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <FileText className="w-3.5 h-3.5 opacity-60" />
              <span>Note {notes ? `(${notes.length} car)` : ''}</span>
            </div>
            {expandNotes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandNotes && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Appunti estesi del blocco, visibili e modificabili in XMind..."
                className="w-full p-3 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg placeholder:text-adw-fg/30 focus:outline-none focus:ring-2 focus:ring-adw-focusRing"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notesDisplay === 'block'}
                    onChange={(e) => setNotesDisplay(e.target.checked ? 'block' : 'icon')}
                    className="rounded text-adw-accent focus:ring-adw-focusRing"
                  />
                  <span className="caption">Mostra le note come blocco espanso</span>
                </label>
                <Button variant="flat" size="sm" onClick={handleSaveNotes}>
                  Salva note
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 5. SEZIONE: Etichette (Labels) */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandLabels(!expandLabels)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Tag className="w-3.5 h-3.5 opacity-60" />
              <span>Etichette ({labels.length})</span>
            </div>
            {expandLabels ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandLabels && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {labels.map((lbl) => (
                  <span
                    key={lbl}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-adw-accent/15 text-adw-accent text-xs font-medium"
                  >
                    <span>{lbl}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveLabel(lbl)}
                      className="hover:opacity-70 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={handleAddLabel}
                placeholder="Aggiungi etichetta (premi Invio)..."
                className="w-full px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg focus:outline-none focus:ring-2 focus:ring-adw-focusRing text-xs"
              />
            </div>
          )}
        </div>

        {/* 6. SEZIONE: Marker (Icone XMind) */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandMarkers(!expandMarkers)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 opacity-60" />
              <span>Marker ({topic.markers.length})</span>
            </div>
            {expandMarkers ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandMarkers && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              {/* Marker attivi */}
              {topic.markers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-2 border-b border-adw-cardBorder">
                  {topic.markers.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleAddMarker(m)}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-adw-bg border border-adw-cardBorder hover:border-adw-destructive text-xs"
                      title="Clicca per rimuovere"
                    >
                      <span className="font-mono text-[11px]">{m}</span>
                      <X className="w-3 h-3 text-adw-destructive" />
                    </button>
                  ))}
                </div>
              )}

              {/* Selettore dal catalogo */}
              <div className="flex space-x-2">
                <select
                  value={selectedMarkerId}
                  onChange={(e) => setSelectedMarkerId(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg text-xs focus:outline-none"
                >
                  <option value="">Seleziona un marker dal catalogo XMind...</option>
                  {GROUPS.map((grp) => (
                    <optgroup key={grp.id} label={grp.label}>
                      {grp.markers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {grp.label} — {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button
                  variant="flat"
                  size="sm"
                  disabled={!selectedMarkerId}
                  onClick={() => handleAddMarker(selectedMarkerId)}
                >
                  Aggiungi
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 7. SEZIONE: Link (Href) */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandHref(!expandHref)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <LinkIcon className="w-3.5 h-3.5 opacity-60" />
              <span>Link / Collegamento {href ? '(attivo)' : ''}</span>
            </div>
            {expandHref ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandHref && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={href}
                  onChange={(e) => setHref(e.target.value)}
                  placeholder="https://... , file:... o #id-blocco"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg focus:outline-none focus:ring-2 focus:ring-adw-focusRing"
                />
                <Button variant="flat" size="sm" onClick={handleSaveHref}>
                  Applica
                </Button>
              </div>
              <p className="caption dim-label">
                Supporta collegamenti web (http/https), percorsi file o collegamenti interni alla mappa (#id).
              </p>
            </div>
          )}
        </div>

        {/* 8. SEZIONE: Aspetto e Colore del Ramo */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandStyle(!expandStyle)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Palette className="w-3.5 h-3.5 opacity-60" />
              <span>Aspetto e Colore Ramo</span>
            </div>
            {expandStyle ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandStyle && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              <div className="flex items-center space-x-2">
                {BRANCH_PALETTE.map((pal) => (
                  <button
                    key={pal.label}
                    type="button"
                    onClick={() => handleColorChange(pal.color)}
                    className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center ${
                      selectedColor === pal.color
                        ? 'border-adw-fg ring-2 ring-adw-focusRing'
                        : 'border-adw-cardBorder'
                    }`}
                    style={{ backgroundColor: pal.color || 'transparent' }}
                    title={pal.label}
                  >
                    {!pal.color && <span className="text-[10px] text-adw-fg/50">auto</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 9. SEZIONE: Struttura & Relazioni */}
        <div className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandStructure(!expandStructure)}
            className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-adw-fg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Share2 className="w-3.5 h-3.5 opacity-60" />
              <span>Relazioni con altri blocchi</span>
            </div>
            {expandStructure ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expandStructure && (
            <div className="p-4 pt-1 border-t border-adw-cardBorder space-y-3 text-xs">
              <div className="space-y-2">
                <label className="caption dim-label block">Collega con freccia a un altro blocco:</label>
                <select
                  value={relTargetId}
                  onChange={(e) => setRelTargetId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg text-xs focus:outline-none"
                >
                  <option value="">Seleziona blocco di destinazione...</option>
                  {allTopics
                    .filter((t) => t.id !== topic.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title || t.displayTitle || t.id}
                      </option>
                    ))}
                </select>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={relTitle}
                    onChange={(e) => setRelTitle(e.target.value)}
                    placeholder="Descrizione relazione (opzionale)"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-adw-bg border border-adw-cardBorder text-adw-fg focus:outline-none"
                  />
                  <Button
                    variant="flat"
                    size="sm"
                    disabled={!relTargetId || !onAddRelationship}
                    onClick={() => {
                      if (onAddRelationship && relTargetId) {
                        onAddRelationship(topic.id, relTargetId, relTitle.trim() || undefined);
                        setRelTargetId('');
                        setRelTitle('');
                      }
                    }}
                  >
                    Collega
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
