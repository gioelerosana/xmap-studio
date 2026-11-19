import type { SheetDto } from '../state/types.js';

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
  void sheets;
  throw new Error('buildReviewPath: non implementato');
}

/** Riflettore del passo: `lit` = passo + antenati + figli, `path` = antenati + passo. */
export function reviewFocus(step: ReviewStep): ReviewFocus {
  void step;
  throw new Error('reviewFocus: non implementato');
}

/**
 * Rami da tenere chiusi nel layout del modo "Mettiti alla prova": ogni topic del foglio che ha
 * figli e non è in `opened`. I topic senza figli non compaiono mai nel risultato.
 */
export function reviewCollapsed(sheet: SheetDto, opened: ReadonlySet<string>): Set<string> {
  void sheet;
  void opened;
  throw new Error('reviewCollapsed: non implementato');
}

/** Indice del passo per `topicId` nel foglio `sheetIndex`; -1 se non c'è. */
export function stepIndexOf(path: ReviewPath, sheetIndex: number, topicId: string): number {
  void path;
  void sheetIndex;
  void topicId;
  throw new Error('stepIndexOf: non implementato');
}
