import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HunspellDictionary, SpellChecker, tokenizeWords } from '../src/spell/index.js';

const DICT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/dictionaries');

function load(lang: string): HunspellDictionary {
  return HunspellDictionary.parse(
    readFileSync(path.join(DICT_DIR, `${lang}.aff`), 'utf8'),
    readFileSync(path.join(DICT_DIR, `${lang}.dic`), 'utf8')
  );
}

describe('HunspellDictionary (mini dizionario)', () => {
  const aff = [
    'SET UTF-8',
    'NEEDAFFIX !',
    'FORBIDDENWORD *',
    'PFX R Y 1',
    'PFX R 0 ri .',
    'SFX S Y 2',
    'SFX S o i o',
    'SFX S a e a',
    'SFX D Y 1',
    'SFX D 0 ed/M [^e]',
    'SFX M Y 1',
    'SFX M 0 ly .',
  ].join('\n');
  const dic = ['5', 'gatto/S', 'casa/SR', 'radice/!S', 'cast/D', 'gatti/*'].join('\n');
  const d = HunspellDictionary.parse(aff, dic);

  it('riconosce radici e forme con prefissi e suffissi', () => {
    expect(d.check('gatto')).toBe(true);
    expect(d.check('case')).toBe(true);
    expect(d.check('ricasa')).toBe(true);
    expect(d.check('ricase')).toBe(true); // prodotto incrociato
    expect(d.check('gatte')).toBe(false);
  });

  it('rispetta NEEDAFFIX, FORBIDDENWORD e i suffissi di continuazione', () => {
    expect(d.check('radice')).toBe(false);
    expect(d.check('gatti')).toBe(false);
    expect(d.check('casted')).toBe(true);
    expect(d.check('castedly')).toBe(true);
  });

  it('accetta iniziale maiuscola e tutto maiuscolo di parole minuscole', () => {
    expect(d.check('Gatto')).toBe(true);
    expect(d.check('GATTO')).toBe(true);
  });
});

describe('tokenizeWords', () => {
  it('salta link, sigle, nomi con maiuscole interne e parole con cifre', () => {
    const words = tokenizeWords('Vedi https://xmap.it e mail@a.it: il DNA di XMind, H2O, nome_file, aᵢ, bⱼ, l’albero e po’ di più.').map(
      (t) => t.word
    );
    expect(words).toEqual(['Vedi', 'il', 'di', "l'albero", "po'", 'di', 'più']);
  });

  it('restituisce le posizioni nel testo originale', () => {
    const text = 'ciao  mondo';
    const [a, b] = tokenizeWords(text);
    expect(text.slice(a.start, a.end)).toBe('ciao');
    expect(text.slice(b.start, b.end)).toBe('mondo');
  });
});

describe.skipIf(!existsSync(path.join(DICT_DIR, 'it.dic')))('dizionari reali it + en', () => {
  const t0 = performance.now();
  const it_ = load('it');
  const en = load('en');
  const loadMs = performance.now() - t0;
  const checker = new SpellChecker([it_, en], ['Rosana']);

  it('si carica in tempi ragionevoli', () => {
    expect(loadMs).toBeLessThan(5000);
  });

  it('accetta testo italiano e inglese corretto', () => {
    const text =
      "L'albero delle derivate è una mappa: dell'anno scorso, quell'esercizio, c'è un po' di teoria. " +
      'Gli studenti avevano studiato le funzioni continue e derivabili, perché città andiamo mangiandolo. ' +
      "The quick brown fox jumps over the lazy dog's tail; it's running, we've studied, children's books.";
    expect(checker.findMisspellings(text).map((t) => t.word)).toEqual([]);
  });

  it('segnala gli errori', () => {
    const wrong = checker.findMisspellings('La funsione è derivabbile e il teorrema vale. Teh dgo.').map((t) => t.word);
    expect(wrong).toEqual(['funsione', 'derivabbile', 'teorrema', 'Teh', 'dgo']);
  });

  it('ignora le parole scelte dall’utente, senza distinguere maiuscole', () => {
    expect(checker.isCorrect('rosana')).toBe(true);
    expect(checker.isCorrect('ROSANA')).toBe(true);
  });

  it('controlla migliaia di parole in poco tempo', () => {
    const words = 'questa frase contiene parole abbastanza comuni della lingua italiana scritta oggi'.split(' ');
    const fresh = new SpellChecker([it_, en]);
    const t = performance.now();
    for (let i = 0; i < 5000; i++) fresh.isCorrect(words[i % words.length] + (i % 7 === 0 ? 'x' : ''));
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
