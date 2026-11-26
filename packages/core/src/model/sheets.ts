import { Sheet } from './types.js';
import { newTopicId, remapIds } from './utils.js';

/** Titolo del blocco centrale di un foglio nuovo. */
export const NEW_SHEET_ROOT_TITLE = 'Argomento Centrale';

/** Foglio vuoto: solo il blocco centrale, con id nuovi. Il titolo è quello della linguetta. */
export function createSheet(title: string): Sheet {
  return {
    id: newTopicId(),
    class: 'sheet',
    title,
    rootTopic: { id: newTopicId(), class: 'topic', title: NEW_SHEET_ROOT_TITLE },
  };
}

/** Primo titolo "Foglio N" non ancora usato dai fogli esistenti. */
export function nextSheetTitle(sheets: Sheet[]): string {
  const used = new Set(sheets.map((s) => s.title));
  let n = sheets.length + 1;
  while (used.has(`Foglio ${n}`)) n++;
  return `Foglio ${n}`;
}

/** Titolo della linguetta assegnato da `nextSheetTitle` ("Foglio N"). */
const AUTO_SHEET_TITLE = /^Foglio \d+$/;

/**
 * Prima rinomina del blocco centrale di un foglio nuovo: la linguetta prende lo
 * stesso titolo. Vale solo finché foglio e blocco centrale hanno ancora i nomi
 * predefiniti (`prevRootTitle` è il titolo del blocco prima della modifica): se
 * l'utente ha già rinominato l'uno o l'altro, i due nomi restano indipendenti.
 * Restituisce true se ha cambiato il titolo del foglio.
 */
export function syncNewSheetTitle(sheet: Sheet, prevRootTitle: string | undefined): boolean {
  const root = sheet.rootTopic;
  if (!root || prevRootTitle !== NEW_SHEET_ROOT_TITLE) return false;
  if (!AUTO_SHEET_TITLE.test(sheet.title ?? '')) return false;
  const next = (root.title ?? '').replace(/\s+/g, ' ').trim();
  if (!next || next === NEW_SHEET_ROOT_TITLE) return false;
  sheet.title = next;
  return true;
}

/**
 * Copia profonda di un foglio con tutti gli id rigenerati (blocchi, relazioni,
 * riepiloghi, link `xmind:#`): i campi sconosciuti sopravvivono. Le risorse
 * (immagini, equazioni) restano condivise con l'originale, nello stesso file.
 */
export function cloneSheet(sheet: Sheet, title: string): Sheet {
  const copy = JSON.parse(JSON.stringify(sheet)) as Sheet;
  remapIds([copy]);
  copy.title = title;
  if ('revisionId' in copy) copy.revisionId = newTopicId();
  return copy;
}
