import type { SheetDto, TopicView } from '../state/types.js';

/**
 * Modalità Ripasso: percorso di lettura di tutto il file, foglio dopo foglio.
 * Modulo puro (niente UI, niente I/O): la vista lo usa in sola lettura, il file non cambia mai.
 */

/** Un passo del ripasso: un blocco a fuoco. */
export interface ReviewStep {
  /** Indice del foglio (`SheetDto.index`). */
  sheetIndex: number;
  topicId: string;
  /** Titolo mostrato (`displayTitle`, o `title` se vuoto). */
  title: string;
  /** Antenati dalla radice dell'albero al genitore (vuoto per la radice e per un blocco libero). */
  ancestorIds: string[];
  /** Figli diretti nell'ordine del percorso: prima i figli in colonna, poi i sommari. */
  childIds: string[];
  /** Numero di antenati: 0 per la radice del foglio e per i blocchi liberi. */
  depth: number;
  /** Vero per il primo passo di ciascun foglio. */
  isSheetStart: boolean;
}

export interface ReviewPath {
  steps: ReviewStep[];
  /** Per ogni foglio non vuoto, nell'ordine dei fogli: indice del suo primo passo in `steps`. */
  sheetStarts: { sheetIndex: number; title: string; firstStep: number; stepCount: number }[];
}

/** Blocchi da mettere in luce e catena dalla radice al passo corrente. */
export interface ReviewFocus {
  /** Passo corrente, antenati e figli diretti. */
  lit: Set<string>;
  /** Antenati e passo corrente: i connettori fra questi si evidenziano. */
  path: Set<string>;
}

/**
 * Percorso di tutti i fogli, in ordine. Dentro un foglio: visita anticipata (prima il blocco,
 * poi i figli, ricorsivamente) dell'albero principale, poi, nell'ordine in cui compaiono in
 * `sheet.topics`, gli alberi dei blocchi liberi (gruppo `detached`).
 *
 * Regole:
 * - figli di un blocco = topic con `parentId` uguale al suo id, nell'ordine di `sheet.topics`;
 *   quelli con `group === 'summary'` vanno dopo tutti gli altri;
 * - radice principale = primo topic senza `parentId` e non `detached`; se non c'è, il primo topic;
 *   eventuali altri topic senza genitore (non `detached`) seguono come alberi a sé dopo la principale;
 * - i rami chiusi nel file (`folded`) si percorrono comunque: il ripasso li apre;
 * - un foglio senza topic non produce passi né voce in `sheetStarts`;
 * - nessun topic compare due volte, anche con dati incoerenti (cicli di `parentId`).
 */
export function buildReviewPath(sheets: readonly SheetDto[]): ReviewPath {
  const steps: ReviewStep[] = [];
  const sheetStarts: ReviewPath['sheetStarts'] = [];
  for (const sheet of sheets) {
    if (sheet.topics.length === 0) continue;
    const firstStep = steps.length;
    appendSheetSteps(sheet, steps);
    sheetStarts.push({
      sheetIndex: sheet.index,
      title: sheet.title,
      firstStep,
      stepCount: steps.length - firstStep,
    });
  }
  return { steps, sheetStarts };
}

/** Accoda al percorso i passi di un foglio non vuoto, nell'ordine descritto in `buildReviewPath`. */
function appendSheetSteps(sheet: SheetDto, steps: ReviewStep[]): void {
  const topics = sheet.topics;
  const firstStep = steps.length;
  const byId = new Map<string, TopicView>();
  for (const topic of topics) {
    if (!byId.has(topic.id)) byId.set(topic.id, topic);
  }

  // Un topic con `parentId` uguale al proprio id non è figlio di nessuno: il controllo evita
  // che compaia come figlio di sé stesso.
  const childrenOf = new Map<string, TopicView[]>();
  for (const topic of topics) {
    if (topic.group === 'detached' || !topic.parentId || topic.parentId === topic.id) continue;
    const siblings = childrenOf.get(topic.parentId) ?? [];
    siblings.push(topic);
    childrenOf.set(topic.parentId, siblings);
  }
  for (const [parentId, list] of childrenOf) {
    childrenOf.set(parentId, [
      ...list.filter((child) => child.group !== 'summary'),
      ...list.filter((child) => child.group === 'summary'),
    ]);
  }

  const visited = new Set<string>();

  // Visita anticipata: il blocco prima, poi i figli. Ogni topic entra in `visited` prima di
  // calcolare i figli, così i cicli di `parentId` non ripassano sugli antenati.
  const visit = (topic: TopicView, ancestorIds: string[]): void => {
    visited.add(topic.id);
    const kids = (childrenOf.get(topic.id) ?? []).filter((child) => !visited.has(child.id));
    steps.push({
      sheetIndex: sheet.index,
      topicId: topic.id,
      title: topic.displayTitle || topic.title,
      ancestorIds,
      childIds: kids.map((child) => child.id),
      depth: ancestorIds.length,
      isSheetStart: steps.length === firstStep,
    });
    const childAncestors = [...ancestorIds, topic.id];
    for (const kid of kids) {
      if (visited.has(kid.id)) continue;
      visit(kid, childAncestors);
    }
  };

  // Radice principale: primo topic senza genitore e non libero; se non c'è, il primo topic.
  const main = topics.find((topic) => topic.group !== 'detached' && !topic.parentId) ?? topics[0];
  visit(main, []);

  const visitRoots = (accept: (topic: TopicView) => boolean): void => {
    for (const topic of topics) {
      if (!visited.has(topic.id) && accept(topic)) visit(topic, []);
    }
  };
  // Topic senza genitore (o con genitore assente dal foglio) come alberi a sé, poi i blocchi liberi,
  // infine i topic rimasti fuori: sono in un ciclo di `parentId` non raggiungibile da una radice.
  visitRoots((topic) => topic.group !== 'detached' && (!topic.parentId || !byId.has(topic.parentId)));
  visitRoots((topic) => topic.group === 'detached');
  visitRoots(() => true);
}

/** Riflettore del passo: `lit` = passo + antenati + figli, `path` = antenati + passo. */
export function reviewFocus(step: ReviewStep): ReviewFocus {
  return {
    lit: new Set([step.topicId, ...step.ancestorIds, ...step.childIds]),
    path: new Set([...step.ancestorIds, step.topicId]),
  };
}

/**
 * Rami da tenere chiusi nel layout del modo "Mettiti alla prova": ogni topic del foglio che ha
 * figli e non è in `opened`. I topic senza figli non compaiono mai nel risultato.
 */
export function reviewCollapsed(sheet: SheetDto, opened: ReadonlySet<string>): Set<string> {
  const parentIds = new Set<string>();
  for (const topic of sheet.topics) {
    if (topic.group !== 'detached' && topic.parentId && topic.parentId !== topic.id) {
      parentIds.add(topic.parentId);
    }
  }
  const collapsed = new Set<string>();
  for (const topic of sheet.topics) {
    if (parentIds.has(topic.id) && !opened.has(topic.id)) collapsed.add(topic.id);
  }
  return collapsed;
}

/** Indice del passo per `topicId` nel foglio `sheetIndex`; -1 se non c'è. */
export function stepIndexOf(path: ReviewPath, sheetIndex: number, topicId: string): number {
  return path.steps.findIndex((step) => step.sheetIndex === sheetIndex && step.topicId === topicId);
}
