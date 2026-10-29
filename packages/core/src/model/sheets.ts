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
