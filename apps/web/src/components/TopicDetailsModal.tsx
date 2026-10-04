import React, { useState, useEffect } from 'react';
import { Modal, Button } from '@xmap/ui-kit';
import { TopicView } from '@xmap/core';
import { GROUPS } from '@xmap/core';
import {
  Tag,
  Link,
  FileText,
  Palette,
  CheckSquare,
  Sparkles,
  Flag,
  Trash2,
} from 'lucide-react';

export interface TopicDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  topic: TopicView | null;
  onSave: (updates: {
    title: string;
    notes: string;
    notesDisplay?: 'icon' | 'block' | null;
    labels: string[];
    href?: string;
    color?: string | null;
    markerToggle?: string;
  }) => void;
  onOpenLatex: (topicId: string) => void;
  onDeleteTopic: (topicId: string) => void;
}

export const TopicDetailsModal: React.FC<TopicDetailsModalProps> = ({
  isOpen,
  onClose,
  topic,
  onSave,
  onOpenLatex,
  onDeleteTopic,
}) => {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [notesDisplay, setNotesDisplay] = useState<'icon' | 'block' | null>(null);
  const [labelsStr, setLabelsStr] = useState('');
  const [href, setHref] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'generale' | 'marker' | 'task'>('generale');

  useEffect(() => {
    if (topic) {
      setTitle(topic.title);
      setNotes(topic.notes);
      setNotesDisplay((topic.notesDisplay as 'icon' | 'block' | null) ?? null);
      setLabelsStr(topic.labels.join(', '));
      setHref(topic.href ?? '');
      setColor(topic.fillColor ?? null);
    }
  }, [topic, isOpen]);

  if (!topic) return null;

  const handleSave = () => {
    const labels = labelsStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onSave({
      title,
      notes,
      notesDisplay,
      labels,
      href: href.trim() || undefined,
      color,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Dettagli & Proprietà Blocco"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {topic.depth > 0 && (
              <Button
                variant="destructive"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  if (confirm('Eliminare questo blocco e i suoi sotto-rami?')) {
                    onDeleteTopic(topic.id);
                    onClose();
                  }
                }}
              >
                Elimina Blocco
              </Button>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="flat" size="sm" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="suggested" size="sm" onClick={handleSave}>
              Salva Modifiche
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Navigazione Schede */}
        <div className="flex border-b border-adw-cardBorder space-x-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('generale')}
            className={`pb-2 transition-colors border-b-2 ${
              activeTab === 'generale'
                ? 'border-adw-accent text-adw-accent font-semibold'
                : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            Generale & Note
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('marker')}
            className={`pb-2 transition-colors border-b-2 ${
              activeTab === 'marker'
                ? 'border-adw-accent text-adw-accent font-semibold'
                : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            Marker & Icone ({topic.markers.length})
          </button>
        </div>

        {activeTab === 'generale' && (
          <div className="space-y-3.5 text-xs">
            {/* Titolo */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold opacity-80">Titolo Blocco:</label>
                {topic.latex ? (
                  <Button
                    variant="flat"
                    size="sm"
                    icon={<Sparkles className="w-3.5 h-3.5 text-adw-accent" />}
                    onClick={() => {
                      onClose();
                      onOpenLatex(topic.id);
                    }}
                  >
                    Modifica Formula LaTeX
                  </Button>
                ) : (
                  <Button
                    variant="flat"
                    size="sm"
                    icon={<Sparkles className="w-3.5 h-3.5 text-adw-accent" />}
                    onClick={() => {
                      onClose();
                      onOpenLatex(topic.id);
                    }}
                  >
                    Inserisci LaTeX
                  </Button>
                )}
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titolo dell'argomento..."
                className="w-full px-3 py-1.5 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]"
              />
            </div>

            {/* Note */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold opacity-80 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Note del Blocco:
                </label>
                <div className="flex items-center space-x-1.5 text-[11px]">
                  <span className="opacity-60">Visualizzazione:</span>
                  <select
                    value={notesDisplay || 'default'}
                    onChange={(e) =>
                      setNotesDisplay(
                        e.target.value === 'default'
                          ? null
                          : (e.target.value as 'icon' | 'block')
                      )
                    }
                    className="px-2 py-0.5 rounded border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg"
                  >
                    <option value="default">Predefinita</option>
                    <option value="icon">Icona a lato</option>
                    <option value="block">Riquadro espanso</option>
                  </select>
                </div>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note dettagliate o citazioni..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)] resize-none"
              />
            </div>

            {/* Etichette e Link */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold opacity-80 mb-1 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Etichette (separate da virgola):
                </label>
                <input
                  type="text"
                  value={labelsStr}
                  onChange={(e) => setLabelsStr(e.target.value)}
                  placeholder="es. Importante, Revisione, Studio"
                  className="w-full px-3 py-1.5 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]"
                />
              </div>

              <div>
                <label className="font-semibold opacity-80 mb-1 flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5" /> Collegamento Href / Web URL:
                </label>
                <input
                  type="text"
                  value={href}
                  onChange={(e) => setHref(e.target.value)}
                  placeholder="https://... o #topic-id"
                  className="w-full px-3 py-1.5 rounded-lg border border-adw-cardBorder bg-white dark:bg-[#2b2b2b] text-adw-fg focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)]"
                />
              </div>
            </div>

            {/* Colore Ramo */}
            <div>
              <label className="font-semibold opacity-80 mb-1.5 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5" /> Colore Sfondo / Ramo (svg:fill):
              </label>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setColor(null)}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    !color ? 'border-adw-accent font-semibold text-adw-accent' : 'opacity-60'
                  }`}
                >
                  Predefinito
                </button>
                {['#E65D5D', '#E9863F', '#C99A12', '#79A83B', '#1599B5', '#7953A9', '#4E5D6C'].map(
                  (c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-5 h-5 rounded-full border border-black/20 dark:border-white/20 transition-transform ${
                        color === c ? 'scale-125 ring-2 ring-adw-accent' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'marker' && (
          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
            {GROUPS.map((group) => (
              <div key={group.id} className="space-y-1.5">
                <div className="text-xs font-semibold opacity-70 flex items-center gap-1">
                  <Flag className="w-3 h-3 text-adw-accent" /> {group.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.markers.map((m) => {
                    const isSelected = topic.markers.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          onSave({
                            title,
                            notes,
                            notesDisplay,
                            labels: topic.labels,
                            markerToggle: m.id,
                          })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs border transition-all flex items-center space-x-1.5 ${
                          isSelected
                            ? 'bg-adw-accent text-white border-adw-accent font-medium shadow-sm'
                            : 'bg-white dark:bg-[#2b2b2b] border-adw-cardBorder hover:border-adw-accent opacity-80'
                        }`}
                      >
                        <span>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
