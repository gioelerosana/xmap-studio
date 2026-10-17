import { CODE_MOVE, XmapError } from '../errors.js';
import {
  Boundary,
  CHILD_GROUPS,
  ChildGroup,
  Relationship,
  Sheet,
  Summary,
  Topic,
} from './types.js';
import {
  formatRange,
  newTopicId,
  parseRange,
  walkTopic,
} from './utils.js';

export function setTitle(topic: Topic, title: string): void {
  topic.title = title;
  delete topic.titleUnedited;
  // XMind mostra `attributedTitle` al posto di `title`: se il testo cambia i
  // frammenti diventano incoerenti, quindi vanno scartati.
  const runs = topic.attributedTitle;
  if (Array.isArray(runs)) {
    const joined = runs
      .map((r) => {
        const text = typeof r === 'object' && r !== null ? (r as { text?: unknown }).text : undefined;
        return typeof text === 'string' ? text : '';
      })
      .join('');
    if (joined !== title) delete topic.attributedTitle;
  }
}

export function addChild(parent: Topic, title: string): string {
  const id = newTopicId();
  const child: Topic = {
    id,
    title,
  };
  if (!parent.children) {
    parent.children = {};
  }
  if (!parent.children.attached) {
    parent.children.attached = [];
  }
  parent.children.attached.push(child);
  return id;
}

/** Aggiorna i range numerici di bordi e sommari dopo l'inserimento di un figlio `attached` in `index`. */
function shiftRangesOnInsert(parent: Topic, index: number): void {
  const shift = (range: string | undefined): string | undefined => {
    if (range === undefined) return undefined;
    const parsed = parseRange(range);
    if (!parsed) return range;
    const [start, end] = parsed;
    if (end < index) return range;
    if (start >= index) return formatRange(start + 1, end + 1);
    return formatRange(start, end + 1);
  };
  for (const b of parent.boundaries ?? []) {
    const next = shift(b.range);
    if (next !== undefined) b.range = next;
  }
  for (const s of parent.summaries ?? []) {
    const next = shift(s.range);
    if (next !== undefined) s.range = next;
  }
}

/**
 * Inserisce un nuovo fratello di `topicId` nello stesso gruppo `children.attached`
 * del genitore, subito dopo o prima. Restituisce l'id del nuovo blocco.
 * Errore per la radice (non ha fratelli) e per blocchi `detached`/`summary`:
 * il chiamante decide il ripiego (di norma un figlio).
 */
export function insertSibling(
  sheets: Sheet[],
  topicId: string,
  title: string,
  where: 'after' | 'before' = 'after'
): string {
  for (const sheet of sheets) {
    const root = sheet.rootTopic;
    if (!root) continue;
    if (root.id === topicId) {
      throw new XmapError(CODE_MOVE, 'La radice non ha fratelli.');
    }
    const path: PathItem[] = [];
    if (!findPath(root, topicId, path)) continue;
    const last = path[path.length - 1];
    if (last.group !== 'attached') {
      throw new XmapError(CODE_MOVE, 'Questo blocco non può avere fratelli (è staccato o è un sommario).');
    }
    const parent = descend(root, path.slice(0, -1));
    const list = parent.children?.attached;
    if (!list) break;
    const id = newTopicId();
    const index = where === 'after' ? last.index + 1 : last.index;
    list.splice(index, 0, { id, title });
    shiftRangesOnInsert(parent, index);
    return id;
  }
  throw new XmapError(CODE_MOVE, 'Blocco non trovato.');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function notesHtml(text: string): string {
  const lines = text.split('\n');
  let out = '';
  for (const line of lines) {
    if (line.length === 0) {
      out += '<p><br></p>';
    } else {
      out += `<p>${escapeHtml(line)}</p>`;
    }
  }
  return out;
}

export function setNotes(topic: Topic, text: string): void {
  if (text.trim().length === 0) {
    delete topic.notes;
    delete topic.notesDisplay;
    return;
  }
  topic.notes = {
    plain: { content: text },
    realHTML: { content: notesHtml(text) },
  };
}

export function setNotesDisplay(topic: Topic, display?: 'icon' | 'block' | null): void {
  if (!display) {
    delete topic.notesDisplay;
  } else {
    topic.notesDisplay = display;
  }
}

export function setLabels(topic: Topic, labels: string[]): void {
  const clean: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (trimmed.length > 0 && !clean.includes(trimmed)) {
      clean.push(trimmed);
    }
  }
  if (clean.length > 0) {
    topic.labels = clean;
  } else {
    delete topic.labels;
  }
}

export function toggleMarker(topic: Topic, markerId: string): boolean {
  const id = markerId.trim();
  if (id.length === 0) return false;
  if (!topic.markers) {
    topic.markers = [];
  }
  const idx = topic.markers.findIndex((m) => m.markerId === id);
  if (idx >= 0) {
    topic.markers.splice(idx, 1);
    if (topic.markers.length === 0) {
      delete topic.markers;
    }
    return false;
  } else {
    topic.markers.push({ markerId: id });
    return true;
  }
}

export function setHref(topic: Topic, href?: string | null): void {
  const clean = href?.trim();
  if (!clean) {
    delete topic.href;
    return;
  }
  if (clean.startsWith('#')) {
    topic.href = `xmind:${clean}`;
  } else {
    topic.href = clean;
  }
}

interface PathItem {
  group: ChildGroup;
  index: number;
}

function findPath(topic: Topic, targetId: string, path: PathItem[]): boolean {
  if (topic.id === targetId) return true;
  if (!topic.children) return false;

  for (const group of CHILD_GROUPS) {
    const list = topic.children[group];
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        path.push({ group, index: i });
        if (findPath(list[i], targetId, path)) {
          return true;
        }
        path.pop();
      }
    }
  }
  return false;
}

function descend(topic: Topic, path: PathItem[]): Topic {
  let curr = topic;
  for (const item of path) {
    const list = curr.children?.[item.group];
    if (!list || !list[item.index]) {
      throw new XmapError(CODE_MOVE, 'Percorso non valido nell\'albero dei blocchi.');
    }
    curr = list[item.index];
  }
  return curr;
}

/**
 * Ricalcola un range `(start,end)` dopo la rimozione del figlio `removed`.
 * Restituisce `false` se il range copriva solo quel figlio e va eliminato;
 * un range assente resta assente, uno non numerico ('master') invariato.
 */
function shiftRange(rangeStr: string | undefined, removed: number): string | undefined | false {
  if (rangeStr === undefined) return undefined;
  const parsed = parseRange(rangeStr);
  if (!parsed) return rangeStr;
  const [start, end] = parsed;
  if (removed > end) {
    return rangeStr;
  }
  if (removed < start) {
    return formatRange(start - 1, end - 1);
  }
  if (start === end) {
    return false;
  }
  return formatRange(start, end - 1);
}

function adjustParentRanges(parent: Topic, group: ChildGroup, childIndex: number): void {
  if (group === 'summary') {
    const removedTopicId = parent.children?.summary?.[childIndex]?.id;
    if (removedTopicId && parent.summaries) {
      parent.summaries = parent.summaries.filter((s) => s.topicId !== removedTopicId);
      if (parent.summaries.length === 0) delete parent.summaries;
    }
    return;
  }
  if (group !== 'attached') return;

  if (parent.boundaries) {
    const nextBoundaries: Boundary[] = [];
    for (const b of parent.boundaries) {
      const shifted = shiftRange(b.range, childIndex);
      if (shifted !== false) {
        if (shifted !== undefined) b.range = shifted;
        nextBoundaries.push(b);
      }
    }
    if (nextBoundaries.length > 0) {
      parent.boundaries = nextBoundaries;
    } else {
      delete parent.boundaries;
    }
  }

  if (parent.summaries) {
    const nextSummaries: Summary[] = [];
    const droppedIds: string[] = [];
    for (const s of parent.summaries) {
      const shifted = shiftRange(s.range, childIndex);
      if (shifted !== false) {
        if (shifted !== undefined) s.range = shifted;
        nextSummaries.push(s);
      } else if (s.topicId) {
        droppedIds.push(s.topicId);
      }
    }
    if (nextSummaries.length > 0) {
      parent.summaries = nextSummaries;
    } else {
      delete parent.summaries;
    }
    if (droppedIds.length > 0 && parent.children?.summary) {
      parent.children.summary = parent.children.summary.filter(
        (t) => !t.id || !droppedIds.includes(t.id)
      );
      if (parent.children.summary.length === 0) {
        delete parent.children.summary;
      }
    }
  }
}

function removeOrphanSummaryRefs(topic: Topic, removedIds: Set<string>): void {
  if (topic.summaries) {
    topic.summaries = topic.summaries.filter(
      (s) => !s.topicId || !removedIds.has(s.topicId)
    );
    if (topic.summaries.length === 0) {
      delete topic.summaries;
    }
  }
  if (!topic.children) return;
  for (const group of CHILD_GROUPS) {
    const list = topic.children[group];
    if (Array.isArray(list)) {
      for (const child of list) {
        removeOrphanSummaryRefs(child, removedIds);
      }
    }
  }
}

/**
 * Stacca e restituisce il topic specificato (insieme ai suoi discendenti).
 * La radice di una sheet non è eliminabile (restituisce undefined).
 */
export function removeTopic(sheets: Sheet[], id: string): Topic | undefined {
  for (const sheet of sheets) {
    if (!sheet.rootTopic || sheet.rootTopic.id === id) {
      continue;
    }
    const path: PathItem[] = [];
    if (!findPath(sheet.rootTopic, id, path)) {
      continue;
    }
    const last = path[path.length - 1];
    const parent = descend(sheet.rootTopic, path.slice(0, -1));

    adjustParentRanges(parent, last.group, last.index);
    const list = parent.children?.[last.group];
    if (!list || last.index >= list.length) {
      return undefined;
    }
    const [removed] = list.splice(last.index, 1);
    if (list.length === 0) {
      delete parent.children?.[last.group];
    }

    // Raccoglie tutti gli ID rimossi
    const removedIds = new Set<string>();
    walkTopic(removed, (t) => {
      if (t.id) removedIds.add(t.id);
    });

    // Rimuove relazioni collegate a uno dei nodi eliminati
    if (sheet.relationships) {
      sheet.relationships = sheet.relationships.filter(
        (r) =>
          (!r.end1Id || !removedIds.has(r.end1Id)) &&
          (!r.end2Id || !removedIds.has(r.end2Id))
      );
      if (sheet.relationships.length === 0) {
        delete sheet.relationships;
      }
    }

    if (sheet.rootTopic) {
      removeOrphanSummaryRefs(sheet.rootTopic, removedIds);
    }
    return removed;
  }
  return undefined;
}

export type MovePlacement = 'before' | 'after' | 'into';

export class MoveError extends XmapError {
  constructor(
    public readonly reason: 'not_found' | 'immovable' | 'cycle' | 'no_siblings',
    message: string
  ) {
    super(CODE_MOVE, message);
    this.name = 'MoveError';
  }
}

export function moveTopic(
  sheets: Sheet[],
  id: string,
  targetId: string,
  placement: MovePlacement
): void {
  if (id === targetId) {
    throw new MoveError('cycle', 'Un blocco non può essere spostato dentro sé stesso.');
  }

  // Verifica se id è rootTopic
  for (const sheet of sheets) {
    if (sheet.rootTopic?.id === id) {
      throw new MoveError('immovable', 'La radice della mappa non si può spostare.');
    }
  }

  // Verifica se target è discendente di source (ciclo)
  let sourceTopic: Topic | undefined;
  for (const sheet of sheets) {
    if (sheet.rootTopic) {
      walkTopic(sheet.rootTopic, (t) => {
        if (t.id === id) sourceTopic = t;
      });
    }
  }
  if (!sourceTopic) {
    throw new MoveError('not_found', 'Blocco da spostare non trovato.');
  }
  let isDescendant = false;
  walkTopic(sourceTopic, (t) => {
    if (t.id === targetId) isDescendant = true;
  });
  if (isDescendant) {
    throw new MoveError('cycle', 'Un blocco non può essere spostato dentro sé stesso.');
  }

  // Verifica target esistente e no_siblings su rootTopic
  let isTargetRoot = false;
  let targetExists = false;
  for (const sheet of sheets) {
    if (sheet.rootTopic?.id === targetId) {
      isTargetRoot = true;
      targetExists = true;
    } else if (sheet.rootTopic) {
      walkTopic(sheet.rootTopic, (t) => {
        if (t.id === targetId) targetExists = true;
      });
    }
  }
  if (!targetExists) {
    throw new MoveError('not_found', 'Blocco bersaglio non trovato.');
  }
  if (isTargetRoot && (placement === 'before' || placement === 'after')) {
    throw new MoveError('no_siblings', 'La radice non ha fratelli con cui riordinarsi.');
  }

  // Stacca il topic sorgente
  const detached = removeTopic(sheets, id);
  if (!detached) {
    throw new MoveError('not_found', 'Impossibile staccare il blocco da spostare.');
  }

  if (placement === 'into') {
    for (const sheet of sheets) {
      if (sheet.rootTopic) {
        let target: Topic | undefined;
        walkTopic(sheet.rootTopic, (t) => {
          if (t.id === targetId) target = t;
        });
        if (target) {
          if (!target.children) target.children = {};
          if (!target.children.attached) target.children.attached = [];
          target.children.attached.push(detached);
          return;
        }
      }
    }
  } else {
    // Inserisci prima o dopo target
    for (const sheet of sheets) {
      if (!sheet.rootTopic) continue;
      const path: PathItem[] = [];
      if (findPath(sheet.rootTopic, targetId, path)) {
        const last = path[path.length - 1];
        const parent = descend(sheet.rootTopic, path.slice(0, -1));
        const list = parent.children?.[last.group];
        if (list) {
          const insertIdx = placement === 'after' ? last.index + 1 : last.index;
          list.splice(insertIdx, 0, detached);
          return;
        }
      }
    }
  }
}

export function addRelationship(
  sheet: Sheet,
  end1Id: string,
  end2Id: string,
  title?: string
): string {
  const id = newTopicId();
  const rel: Relationship = {
    id,
    class: 'relationship',
    end1Id,
    end2Id,
    title: title?.trim() || undefined,
  };
  if (!sheet.relationships) {
    sheet.relationships = [];
  }
  sheet.relationships.push(rel);
  return id;
}

export function removeRelationship(sheet: Sheet, relationshipId: string): boolean {
  if (!sheet.relationships) return false;
  const before = sheet.relationships.length;
  sheet.relationships = sheet.relationships.filter((r) => r.id !== relationshipId);
  const removed = sheet.relationships.length !== before;
  if (sheet.relationships.length === 0) {
    delete sheet.relationships;
  }
  return removed;
}

export function addBoundary(
  parent: Topic,
  start: number,
  end: number,
  title?: string
): string {
  const id = newTopicId();
  const boundary: Boundary = {
    id,
    class: 'boundary',
    range: formatRange(start, end),
    title: title?.trim() || undefined,
  };
  if (!parent.boundaries) {
    parent.boundaries = [];
  }
  parent.boundaries.push(boundary);
  return id;
}

export function removeBoundary(parent: Topic, boundaryId: string): boolean {
  if (!parent.boundaries) return false;
  const before = parent.boundaries.length;
  parent.boundaries = parent.boundaries.filter((b) => b.id !== boundaryId);
  const removed = parent.boundaries.length !== before;
  if (parent.boundaries.length === 0) {
    delete parent.boundaries;
  }
  return removed;
}

export function addSummary(
  parent: Topic,
  start: number,
  end: number,
  title: string
): string {
  const topicId = newTopicId();
  const summaryTopic: Topic = {
    id: topicId,
    title,
  };
  if (!parent.children) parent.children = {};
  if (!parent.children.summary) parent.children.summary = [];
  parent.children.summary.push(summaryTopic);

  const descriptor: Summary = {
    id: newTopicId(),
    class: 'summary',
    range: formatRange(start, end),
    topicId,
  };
  if (!parent.summaries) parent.summaries = [];
  parent.summaries.push(descriptor);
  return topicId;
}

export function removeSummary(parent: Topic, summaryTopicId: string): boolean {
  let removed = false;
  if (parent.summaries) {
    const before = parent.summaries.length;
    parent.summaries = parent.summaries.filter((s) => s.topicId !== summaryTopicId);
    if (parent.summaries.length !== before) removed = true;
    if (parent.summaries.length === 0) delete parent.summaries;
  }
  if (parent.children?.summary) {
    const before = parent.children.summary.length;
    parent.children.summary = parent.children.summary.filter((t) => t.id !== summaryTopicId);
    if (parent.children.summary.length !== before) removed = true;
    if (parent.children.summary.length === 0) delete parent.children.summary;
  }
  return removed;
}

/** Vero se il topic sta nel gruppo `detached` di un altro topic (topic libero). */
export function isDetachedTopic(sheets: Sheet[], id: string): boolean {
  let found = false;
  for (const sheet of sheets) {
    if (!sheet.rootTopic) continue;
    walkTopic(sheet.rootTopic, (t) => {
      if (t.children?.detached?.some((d) => d.id === id)) found = true;
    });
    if (found) return true;
  }
  return false;
}

/**
 * Imposta `position` (centro del topic libero rispetto al centro della radice,
 * come in XMind). Tocca solo quel campo e lo arrotonda a interi.
 */
export function setTopicPosition(topic: Topic, pos: { x: number; y: number }): void {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    throw new XmapError(CODE_MOVE, 'Posizione non valida.');
  }
  topic['position'] = { x: Math.round(pos.x), y: Math.round(pos.y) };
}
