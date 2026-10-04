import React, { useMemo } from 'react';
import { TopicView } from '@xmap/core';
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Sparkles,
  FileText,
  Tag,
  Flag,
  CheckCircle2,
  Plus,
  Image as ImageIcon,
  FolderTree,
} from 'lucide-react';

export type FilterKind = 'all' | 'equation' | 'text' | 'image';

export interface TopicTreeSidebarProps {
  topics: TopicView[];
  selectedTopicId?: string;
  onSelectTopic: (topicId: string) => void;
  onAddChild: (parentId: string) => void;
  collapsedIds: Set<string>;
  onToggleCollapse: (topicId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: FilterKind;
  onFilterChange: (filter: FilterKind) => void;
}

export const TopicTreeSidebar: React.FC<TopicTreeSidebarProps> = ({
  topics,
  selectedTopicId,
  onSelectTopic,
  onAddChild,
  collapsedIds,
  onToggleCollapse,
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
}) => {
  const query = searchQuery.trim().toLowerCase();

  // Statistiche per filtri
  const counts = useMemo(() => {
    let equations = 0;
    let images = 0;
    let texts = 0;
    for (const t of topics) {
      if (t.kind === 'equation' || t.latex) equations++;
      else if (t.kind === 'image') images++;
      else texts++;
    }
    return {
      all: topics.length,
      equation: equations,
      image: images,
      text: texts,
    };
  }, [topics]);

  // Filtro per tipo e per testo
  const matchesFilter = (t: TopicView): boolean => {
    if (activeFilter === 'equation') return Boolean(t.kind === 'equation' || t.latex);
    if (activeFilter === 'image') return t.kind === 'image';
    if (activeFilter === 'text') return t.kind === 'text' && !t.latex;
    return true;
  };

  const matchesSearch = (t: TopicView): boolean => {
    if (!query) return true;
    return (
      t.title.toLowerCase().includes(query) ||
      t.notes.toLowerCase().includes(query) ||
      (t.latex && t.latex.toLowerCase().includes(query)) ||
      t.labels.some((l) => l.toLowerCase().includes(query))
    );
  };

  // Visibilità tenendo conto dei nodi collassati e dei nodi antenati durante la ricerca
  const visibleTopicIds = useMemo(() => {
    const set = new Set<string>();
    if (query || activeFilter !== 'all') {
      for (const t of topics) {
        if (matchesFilter(t) && matchesSearch(t)) {
          set.add(t.id);
          // Espandi fino alla radice per garantire la navigabilità
          let curr: TopicView | undefined = t;
          while (curr && curr.parentId) {
            set.add(curr.parentId);
            curr = topics.find((p) => p.id === curr!.parentId);
          }
        }
      }
      return set;
    }

    // Modalità normale con rispetto dei rami collassati
    for (const t of topics) {
      let currParentId = t.parentId;
      let hidden = false;
      while (currParentId) {
        if (collapsedIds.has(currParentId)) {
          hidden = true;
          break;
        }
        const parentTopic = topics.find((p) => p.id === currParentId);
        currParentId = parentTopic?.parentId;
      }
      if (!hidden) {
        set.add(t.id);
      }
    }
    return set;
  }, [topics, query, activeFilter, collapsedIds]);

  const visibleTopics = useMemo(
    () => topics.filter((t) => visibleTopicIds.has(t.id)),
    [topics, visibleTopicIds]
  );

  return (
    <aside className="w-80 md:w-88 border-r border-adw-cardBorder bg-adw-sidebar flex flex-col h-full select-none shrink-0 transition-colors duration-150">
      {/* 1. Barra di Ricerca */}
      <div className="p-3 pb-2 space-y-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-3 text-adw-fg/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cerca blocchi o formule..."
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-adw-card border border-adw-cardBorder text-adw-fg placeholder:text-adw-fg/40 focus:outline-none focus:ring-2 focus:ring-adw-focusRing"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-adw-fg/50"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* 2. Filtri Tipo Blocco (Linked Buttons stile Adwaita) */}
        <div className="flex items-center w-full linked bg-adw-card/80 p-0.5 border border-adw-cardBorder rounded-lg text-[11px] font-medium">
          <button
            type="button"
            onClick={() => onFilterChange('all')}
            className={`flex-1 py-1 text-center transition-colors ${
              activeFilter === 'all'
                ? 'bg-adw-accent text-white font-semibold'
                : 'text-adw-fg/70 hover:text-adw-fg hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            Tutti ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('equation')}
            className={`flex-1 py-1 text-center transition-colors ${
              activeFilter === 'equation'
                ? 'bg-adw-accent text-white font-semibold'
                : 'text-adw-fg/70 hover:text-adw-fg hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Mostra solo blocchi con formule LaTeX"
          >
            Formule ({counts.equation})
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('text')}
            className={`flex-1 py-1 text-center transition-colors ${
              activeFilter === 'text'
                ? 'bg-adw-accent text-white font-semibold'
                : 'text-adw-fg/70 hover:text-adw-fg hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Mostra solo blocchi di testo"
          >
            Testo ({counts.text})
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('image')}
            className={`flex-1 py-1 text-center transition-colors ${
              activeFilter === 'image'
                ? 'bg-adw-accent text-white font-semibold'
                : 'text-adw-fg/70 hover:text-adw-fg hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Mostra solo blocchi con immagini"
          >
            Immagini ({counts.image})
          </button>
        </div>

        {/* 3. Didascalia di Riepilogo (dim-label caption) */}
        <div className="flex items-center justify-between px-1 text-[11px] text-adw-fg/60">
          <span>
            {visibleTopics.length} di {topics.length} blocchi visibili
          </span>
          {counts.equation > 0 && (
            <span className="flex items-center space-x-1 text-adw-accent font-medium">
              <Sparkles className="w-3 h-3" />
              <span>{counts.equation} formule</span>
            </span>
          )}
        </div>
      </div>

      {/* 4. Lista ad Albero Gerarchica */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {visibleTopics.length === 0 ? (
          <div className="p-6 text-center text-xs text-adw-fg/50 space-y-1">
            <FolderTree className="w-6 h-6 mx-auto opacity-40 mb-2" />
            <p>Nessun blocco trovato.</p>
            {query && <p className="opacity-70">Prova a modificare la ricerca.</p>}
          </div>
        ) : (
          visibleTopics.map((topic) => {
            const isSelected = topic.id === selectedTopicId;
            const isCollapsed = collapsedIds.has(topic.id);
            const hasChildren = topic.childCount > 0;
            const isEq = Boolean(topic.kind === 'equation' || topic.latex);
            const indent = Math.min(topic.depth, 8) * 16;

            return (
              <div
                key={topic.id}
                onClick={() => onSelectTopic(topic.id)}
                className={`group relative flex items-center h-8 pr-1.5 rounded-md cursor-pointer transition-colors text-xs ${
                  isSelected
                    ? 'bg-adw-accent text-white font-medium shadow-sm'
                    : 'text-adw-fg hover:bg-black/5 dark:hover:bg-white/5'
                }`}
                style={{ paddingLeft: `${8 + indent}px` }}
              >
                {/* Chevron collasso/espandi per rami */}
                <div className="w-4 h-4 flex items-center justify-center shrink-0 mr-1">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCollapse(topic.id);
                      }}
                      className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/20 transition-transform ${
                        isSelected ? 'text-white' : 'text-adw-fg/60'
                      }`}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-adw-fg/20" />
                  )}
                </div>

                {/* Badge Icona Tipo */}
                <div className="shrink-0 mr-1.5">
                  {isEq ? (
                    <span
                      className={`inline-flex items-center justify-center p-0.5 rounded text-[10px] ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-adw-accent/15 text-adw-accent'
                      }`}
                      title="Formula LaTeX"
                    >
                      <Sparkles className="w-3 h-3" />
                    </span>
                  ) : topic.kind === 'image' ? (
                    <ImageIcon
                      className={`w-3.5 h-3.5 ${
                        isSelected ? 'text-white' : 'text-adw-fg/50'
                      }`}
                    />
                  ) : null}
                </div>

                {/* Titolo / Formula */}
                <div className="flex-1 truncate">
                  {isEq && topic.latex ? (
                    <span className="font-mono text-[11px] truncate tracking-tight">
                      ${topic.latex}$
                    </span>
                  ) : (
                    <span className="truncate">
                      {topic.title || '(senza titolo)'}
                    </span>
                  )}
                </div>

                {/* Indicatori Note / Etichette / Marker */}
                <div className="flex items-center space-x-1 shrink-0 ml-1 opacity-70 group-hover:opacity-100">
                  {topic.notes && (
                    <span title="Ha note allegate">
                      <FileText
                        className={`w-3 h-3 ${isSelected ? 'text-white' : 'text-adw-fg/60'}`}
                      />
                    </span>
                  )}
                  {topic.labels.length > 0 && (
                    <span
                      className={`text-[9px] px-1 rounded-full font-medium ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-black/5 dark:bg-white/10 text-adw-fg/70'
                      }`}
                      title={`Etichette: ${topic.labels.join(', ')}`}
                    >
                      {topic.labels.length}
                    </span>
                  )}
                </div>

                {/* Pulsante rapido hover: Aggiungi sotto-blocco */}
                <div className="shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddChild(topic.id);
                    }}
                    className={`p-1 rounded hover:bg-black/10 dark:hover:bg-white/20 ${
                      isSelected ? 'text-white' : 'text-adw-fg/70 hover:text-adw-fg'
                    }`}
                    title="Aggiungi sotto-blocco"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
