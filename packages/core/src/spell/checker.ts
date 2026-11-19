import type { HunspellDictionary } from './hunspell.js';

/** Una parola nel testo: posizioni in unità UTF-16, `end` esclusa. */
export interface WordToken {
  word: string;
  start: number;
  end: number;
}

/** Spazi e punteggiatura che separano i "pezzi" di testo (URL, mail, parole). */
const CHUNK_RE = /[^\s()[\]{}<>«»"“”,;!?]+/gu;
/** Parola: lettere con apostrofi interni o finali ("l'albero", "po'"). */
const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?/gu;
const LOOKS_LIKE_LINK = /:\/\/|^www\.|@|[\\/]/iu;
const DIGIT_OR_UNDERSCORE = /[\p{N}_]/u;
/** Lettere modificatrici (pedici e apici come "aᵢ", "xⁿ"): notazione, non parole. */
const MODIFIER_LETTER = /\p{Lm}/u;

/**
 * Parole da controllare in un testo semplice (senza formule: chi chiama
 * passa solo i tratti di testo). Si saltano link, indirizzi mail e percorsi,
 * parole attaccate a cifre o trattini bassi ("H2O", "nome_file"),
 * sigle tutte maiuscole e nomi con maiuscole interne ("XMind", "iPhone"),
 * notazioni con pedici o apici ("aᵢ", "xⁿ"),
 * e le lettere singole.
 */
export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const chunk of text.matchAll(CHUNK_RE)) {
    const value = chunk[0];
    const base = chunk.index ?? 0;
    if (LOOKS_LIKE_LINK.test(value)) continue;
    for (const m of value.matchAll(WORD_RE)) {
      let word = m[0];
      const start = base + (m.index ?? 0);
      const before = value[(m.index ?? 0) - 1] ?? '';
      const after = value[(m.index ?? 0) + word.length] ?? '';
      if (DIGIT_OR_UNDERSCORE.test(before) || DIGIT_OR_UNDERSCORE.test(after)) continue;
      if (MODIFIER_LETTER.test(word) || MODIFIER_LETTER.test(before) || MODIFIER_LETTER.test(after)) continue;
      // Un apostrofo finale è parte della parola solo in casi come "po'": lo decide il controllo.
      if (Array.from(word.replace(/['’]/g, '')).length < 2) continue;
      if (isAcronymOrMixedCase(word)) continue;
      word = word.replace(/’/g, "'");
      out.push({ word, start, end: start + m[0].length });
    }
  }
  return out;
}

function isAcronymOrMixedCase(word: string): boolean {
  const letters = word.replace(/['’]/g, '');
  const upper = letters.toLocaleUpperCase();
  if (letters === upper && letters !== letters.toLocaleLowerCase()) return true;
  // Maiuscole dopo la prima lettera di ogni parte (gli apostrofi separano "l'Italia").
  return letters
    .split(/['’]/)
    .some((part) => part.slice(1) !== part.slice(1).toLocaleLowerCase());
}

/** Forma con cui una parola si conserva fra quelle ignorate: minuscola, apostrofo dritto. */
export function normalizeIgnoredWord(word: string): string {
  return word.trim().replace(/’/g, "'").toLocaleLowerCase();
}

/**
 * Controllo ortografico su più lingue: una parola è corretta se lo è in
 * almeno un dizionario o se l'utente ha scelto di ignorarla.
 */
export class SpellChecker {
  private readonly ignored: ReadonlySet<string>;
  private readonly cache = new Map<string, boolean>();

  constructor(
    private readonly dictionaries: readonly HunspellDictionary[],
    ignored: Iterable<string> = []
  ) {
    this.ignored = new Set(Array.from(ignored, normalizeIgnoredWord));
  }

  isCorrect(rawWord: string): boolean {
    const word = rawWord.replace(/’/g, "'");
    if (this.dictionaries.length === 0) return true;
    if (this.ignored.has(normalizeIgnoredWord(word))) return true;
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;
    const result = this.computeCorrect(word);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(word, result);
    return result;
  }

  private inAny(word: string): boolean {
    return this.dictionaries.some((d) => d.check(word));
  }

  private computeCorrect(word: string): boolean {
    if (this.inAny(word)) return true;
    if (!word.includes("'")) return false;
    // Apostrofo finale di citazione o possessivo plurale inglese ("users'").
    if (word.endsWith("'") && this.inAny(word.slice(0, -1))) return true;
    // Possessivo inglese ("John's", "map's").
    if (/'s$/i.test(word) && this.inAny(word.slice(0, -2))) return true;
    // Elisione con più apostrofi o non prevista dal dizionario: "quell'anno", "c'è".
    const cut = word.indexOf("'");
    const head = word.slice(0, cut + 1);
    const tail = word.slice(cut + 1);
    if (tail === '') return false;
    const headOk = this.inAny(head) || ELISIONS.has(head.toLocaleLowerCase());
    return headOk && this.isCorrect(tail);
  }

  /** Parole sbagliate di un testo semplice, nell'ordine in cui compaiono. */
  findMisspellings(text: string): WordToken[] {
    return tokenizeWords(text).filter((t) => !this.isCorrect(t.word));
  }
}

/**
 * Forme elise italiane comuni: il dizionario le prevede come prefissi solo
 * davanti a certe parole, ma l'elisione davanti a una parola corretta è
 * sempre accettabile per un controllo che si limita a segnalare.
 */
const ELISIONS = new Set([
  "l'", "un'", "dell'", "all'", "dall'", "nell'", "sull'", "coll'", "quell'", "quest'",
  "bell'", "sant'", "grand'", "buon'", "nessun'", "qualcun'", "ciascun'", "alcun'",
  "tutt'", "d'", "c'", "m'", "t'", "s'", "v'", "n'", "com'", "dov'", "cos'", "anch'",
  "senz'", "mezz'", "quand'", "ch'", "lo'", "gl'",
]);
