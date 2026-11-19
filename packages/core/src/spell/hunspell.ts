/*
 * Lettore minimo di dizionari Hunspell (.aff + .dic) per il solo controllo
 * ortografico: dice se una parola esiste, non propone correzioni.
 *
 * Perché non espandere le forme: il dizionario italiano genera milioni di
 * parole (coniugazioni, enclitiche). Qui si fa come Hunspell: si tolgono
 * prefissi e suffissi dalla parola e si cerca la radice con il flag giusto.
 * Memoria e tempo di caricamento restano quelli del .dic.
 *
 * Supportati: PFX/SFX (con prodotto incrociato e un livello di suffissi
 * di continuazione), FLAG (char, long, num, UTF-8), AF, NEEDAFFIX,
 * FORBIDDENWORD, ONLYINCOMPOUND, ICONV. Le parole composte (COMPOUND*)
 * non lo sono: nei dizionari it/en servono solo per numeri ordinali.
 */

type FlagMode = 'char' | 'long' | 'num' | 'utf8';

interface AffixRule {
  flag: string;
  strip: string;
  add: string;
  /** Flag di continuazione (suffissi che si possono aggiungere dopo questo). */
  cont: readonly string[];
  /** Condizione sulla radice (già con l'eventuale `strip`), o `null` se è "." */
  cond: RegExp | null;
  cross: boolean;
}

/** Converte una condizione Hunspell in espressione regolare ancorata. */
function conditionRegExp(cond: string, kind: 'PFX' | 'SFX'): RegExp | null {
  if (cond === '.' || cond === '') return null;
  let body = '';
  let inClass = false;
  for (const ch of cond) {
    if (ch === '[') {
      inClass = true;
      body += ch;
    } else if (ch === ']') {
      inClass = false;
      body += ch;
    } else if (ch === '^' && inClass && body.endsWith('[')) {
      body += ch;
    } else if (ch === '.' && !inClass) {
      body += '.';
    } else {
      body += ch.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
    }
  }
  try {
    return new RegExp(kind === 'SFX' ? `(?:${body})$` : `^(?:${body})`, 'u');
  } catch {
    // Condizione illeggibile: meglio accettare la regola che segnare errori falsi.
    return null;
  }
}

export class HunspellDictionary {
  private flagMode: FlagMode = 'char';
  private aliases: string[][] = [];
  private needAffix: string | null = null;
  private forbidden: string | null = null;
  private onlyInCompound: string | null = null;
  private iconv: Array<[string, string]> = [];
  /** Suffissi indicizzati per la parte aggiunta (`add`). */
  private suffixes = new Map<string, AffixRule[]>();
  private prefixes = new Map<string, AffixRule[]>();
  /** Flag dei suffissi che compaiono come continuazione di un altro suffisso. */
  private contSuffixFlags = new Set<string>();
  private maxSuffixLen = 0;
  private maxPrefixLen = 0;
  /** Radici: parola → insiemi di flag (una voce per omonimo). */
  private roots = new Map<string, Array<readonly string[]>>();

  /** Interpreta il file .aff; le radici si aggiungono poi con `addDicLines`. */
  static fromAff(aff: string): HunspellDictionary {
    const dict = new HunspellDictionary();
    dict.parseAff(aff);
    return dict;
  }

  /** Dizionario completo in un solo passo (test e file piccoli). */
  static parse(aff: string, dic: string): HunspellDictionary {
    const dict = HunspellDictionary.fromAff(aff);
    const lines = dic.split(/\r?\n/);
    // La prima riga del .dic è il numero (indicativo) di voci.
    dict.addDicLines(lines, /^\s*\d+\s*$/.test(lines[0] ?? '') ? 1 : 0, lines.length);
    return dict;
  }

  get size(): number {
    return this.roots.size;
  }

  private parseFlags(raw: string, useAliases = true): string[] {
    if (raw === '') return [];
    if (useAliases && this.aliases.length > 0 && /^\d+$/.test(raw)) {
      return this.aliases[Number(raw) - 1] ?? [];
    }
    switch (this.flagMode) {
      case 'long': {
        const out: string[] = [];
        for (let i = 0; i < raw.length; i += 2) out.push(raw.slice(i, i + 2));
        return out;
      }
      case 'num':
        return raw.split(',').filter((f) => f !== '');
      default:
        return Array.from(raw);
    }
  }

  private parseAff(aff: string): void {
    const lines = aff.split(/\r?\n/);
    let afHeaderSeen = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/^﻿/, '');
      if (line === '' || line.startsWith('#')) continue;
      const parts = line.trim().split(/\s+/);
      const key = parts[0];
      switch (key) {
        case 'FLAG':
          if (parts[1] === 'long') this.flagMode = 'long';
          else if (parts[1] === 'num') this.flagMode = 'num';
          else if (parts[1] === 'UTF-8') this.flagMode = 'utf8';
          break;
        case 'AF':
          // "AF n" è l'intestazione del blocco; le righe seguenti sono gli alias 1..n.
          if (afHeaderSeen) this.aliases.push(this.parseFlags(parts[1] ?? '', false));
          else afHeaderSeen = true;
          break;
        case 'NEEDAFFIX':
          this.needAffix = this.parseFlags(parts[1] ?? '')[0] ?? null;
          break;
        case 'FORBIDDENWORD':
          this.forbidden = this.parseFlags(parts[1] ?? '')[0] ?? null;
          break;
        case 'ONLYINCOMPOUND':
          this.onlyInCompound = this.parseFlags(parts[1] ?? '')[0] ?? null;
          break;
        case 'ICONV':
          if (parts.length >= 3) this.iconv.push([parts[1], parts[2]]);
          break;
        case 'PFX':
        case 'SFX': {
          const count = Number(parts[3]);
          const cross = parts[2] === 'Y';
          if (parts.length !== 4 || !Number.isFinite(count)) break;
          const flag = parts[1];
          for (let n = 0; n < count && i + 1 < lines.length; n++) {
            i++;
            const rule = lines[i].trim().split(/\s+/);
            if (rule[0] !== key || rule.length < 4) continue;
            const strip = rule[2] === '0' ? '' : rule[2];
            const [addRaw, contRaw = ''] = rule[3].split('/');
            const add = addRaw === '0' ? '' : addRaw;
            const entry: AffixRule = {
              flag,
              strip,
              add,
              cont: this.parseFlags(contRaw),
              cond: conditionRegExp(rule[4] ?? '.', key),
              cross,
            };
            const index = key === 'SFX' ? this.suffixes : this.prefixes;
            const list = index.get(add);
            if (list) list.push(entry);
            else index.set(add, [entry]);
            if (key === 'SFX') {
              this.maxSuffixLen = Math.max(this.maxSuffixLen, add.length);
              for (const c of entry.cont) this.contSuffixFlags.add(c);
            } else {
              this.maxPrefixLen = Math.max(this.maxPrefixLen, add.length);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Aggiunge le righe `[from, to)` del .dic. Separato dal parsing dell'.aff così chi
   * carica un dizionario grande può farlo a pezzi senza bloccare l'interfaccia.
   */
  addDicLines(lines: readonly string[], from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const line = lines[i];
      if (!line) continue;
      // Il resto della riga dopo uno spazio o una tabulazione sono dati morfologici.
      const entry = line.split(/[\t ]/, 1)[0];
      let slash = -1;
      for (let k = 0; k < entry.length; k++) {
        if (entry[k] === '\\') {
          k++;
          continue;
        }
        if (entry[k] === '/') {
          slash = k;
          break;
        }
      }
      const word = (slash === -1 ? entry : entry.slice(0, slash)).replace(/\\\//g, '/');
      if (word === '') continue;
      const flags = slash === -1 ? [] : this.parseFlags(entry.slice(slash + 1));
      const list = this.roots.get(word);
      if (list) list.push(flags);
      else this.roots.set(word, [flags]);
    }
  }

  private normalize(word: string): string {
    let out = word;
    for (const [from, to] of this.iconv) out = out.split(from).join(to);
    return out;
  }

  /** La parola (con la grafia esatta) è corretta. Le maiuscole le gestisce `check`. */
  private checkExact(word: string): boolean {
    const direct = this.roots.get(word);
    if (direct) {
      if (direct.some((flags) => this.forbidden !== null && flags.includes(this.forbidden))) return false;
      if (direct.some((flags) => this.isStandalone(flags))) return true;
    }
    return this.checkSuffixed(word, null, false) || this.checkPrefixed(word);
  }

  private isStandalone(flags: readonly string[]): boolean {
    return !(
      (this.needAffix !== null && flags.includes(this.needAffix)) ||
      (this.onlyInCompound !== null && flags.includes(this.onlyInCompound)) ||
      (this.forbidden !== null && flags.includes(this.forbidden))
    );
  }

  private rootHas(stem: string, needed: readonly string[]): boolean {
    const list = this.roots.get(stem);
    if (!list) return false;
    return list.some(
      (flags) =>
        needed.every((f) => flags.includes(f)) &&
        !(this.forbidden !== null && flags.includes(this.forbidden)) &&
        !(this.onlyInCompound !== null && flags.includes(this.onlyInCompound))
    );
  }

  /**
   * Prova a togliere un suffisso. `prefix` è il prefisso già tolto (prodotto
   * incrociato); `inner` vuol dire che si cerca un secondo suffisso interno
   * di cui quello già tolto è continuazione.
   */
  private checkSuffixed(word: string, prefix: AffixRule | null, inner: false): boolean;
  private checkSuffixed(word: string, prefix: AffixRule | null, inner: true, outerFlag: string): boolean;
  private checkSuffixed(word: string, prefix: AffixRule | null, inner: boolean, outerFlag?: string): boolean {
    const maxLen = Math.min(this.maxSuffixLen, word.length);
    for (let len = 0; len <= maxLen; len++) {
      const rules = this.suffixes.get(word.slice(word.length - len));
      if (!rules) continue;
      const base = word.slice(0, word.length - len);
      for (const rule of rules) {
        if (base.length + rule.strip.length === 0) continue;
        if (prefix && !(rule.cross && prefix.cross)) continue;
        if (inner && !(outerFlag !== undefined && rule.cont.includes(outerFlag))) continue;
        const stem = base + rule.strip;
        if (rule.cond && !rule.cond.test(stem)) continue;
        const needed = prefix ? [rule.flag, prefix.flag] : [rule.flag];
        if (this.rootHas(stem, needed)) return true;
        // Suffisso doppio: questo suffisso è continuazione di un altro, più interno.
        if (!inner && !prefix && this.contSuffixFlags.has(rule.flag)) {
          if (this.checkSuffixed(stem, null, true, rule.flag)) return true;
        }
      }
    }
    return false;
  }

  private checkPrefixed(word: string): boolean {
    const maxLen = Math.min(this.maxPrefixLen, word.length);
    for (let len = 1; len <= maxLen; len++) {
      const rules = this.prefixes.get(word.slice(0, len));
      if (!rules) continue;
      const rest = word.slice(len);
      for (const rule of rules) {
        const stem = rule.strip + rest;
        if (stem === '') continue;
        if (rule.cond && !rule.cond.test(stem)) continue;
        if (this.rootHas(stem, [rule.flag])) return true;
        if (rule.cross && this.checkSuffixed(stem, rule, false)) return true;
      }
    }
    return false;
  }

  /**
   * La parola è nel dizionario. Come Hunspell accetta anche l'iniziale
   * maiuscola e il tutto maiuscolo di una parola minuscola (non il contrario:
   * "roma" è un errore se il dizionario ha solo "Roma").
   */
  check(rawWord: string): boolean {
    const word = this.normalize(rawWord);
    if (word === '') return true;
    if (this.checkExact(word)) return true;
    const lower = word.toLocaleLowerCase();
    if (lower === word) return false;
    const rest = word.slice(1);
    const capitalized = word[0] + rest.toLocaleLowerCase();
    const isCapitalized = word === capitalized;
    const isUpper = word === word.toLocaleUpperCase();
    if (isCapitalized || isUpper) {
      if (this.checkExact(lower)) return true;
    }
    if (isUpper && word.length > 1) {
      if (this.checkExact(capitalized)) return true;
    }
    return false;
  }
}
