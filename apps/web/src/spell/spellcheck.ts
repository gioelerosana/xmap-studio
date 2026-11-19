/*
 * Controllo ortografico della mappa: carica i dizionari Hunspell inclusi
 * nell'app (`public/dictionaries/`) e fornisce un `SpellChecker` ai componenti.
 *
 * Il caricamento è asincrono e a pezzi (il dizionario italiano ha ~95 000
 * radici): l'interfaccia non si blocca, e finché i dizionari non sono pronti
 * semplicemente non si segnala nulla. Un dizionario si scarica una volta per
 * sessione; offline arriva dalla cache della PWA come il resto della build.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { HunspellDictionary, SpellChecker, normalizeIgnoredWord, splitInlineMath } from '@xmap/core';
import { getSettingsSnapshot, updateSettings, useSettings, type SpellLanguage } from '../settings.js';

/** Righe del .dic elaborate prima di restituire il controllo al browser. */
const DIC_LINES_PER_SLICE = 4000;

const loaded = new Map<SpellLanguage, HunspellDictionary>();
const loading = new Map<SpellLanguage, Promise<void>>();
const failed = new Set<SpellLanguage>();

let checker: SpellChecker | null = null;
let checkerKey = '';
const listeners = new Set<() => void>();
/** Cambia a ogni dizionario caricato (o fallito): fa ridisegnare chi usa il checker. */
let loadedVersion = 0;

function emit(): void {
  loadedVersion++;
  for (const listener of listeners) listener();
}

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dizionario non disponibile (${response.status}): ${url}`);
  return response.text();
}

async function loadDictionary(lang: SpellLanguage): Promise<void> {
  const [aff, dic] = await Promise.all([
    fetchText(`dictionaries/${lang}.aff`),
    fetchText(`dictionaries/${lang}.dic`),
  ]);
  const dict = HunspellDictionary.fromAff(aff);
  await yieldToBrowser();
  const lines = dic.split(/\r?\n/);
  const first = /^\s*\d+\s*$/.test(lines[0] ?? '') ? 1 : 0;
  for (let from = first; from < lines.length; from += DIC_LINES_PER_SLICE) {
    dict.addDicLines(lines, from, Math.min(from + DIC_LINES_PER_SLICE, lines.length));
    await yieldToBrowser();
  }
  loaded.set(lang, dict);
}

function ensureLoaded(lang: SpellLanguage): void {
  if (loaded.has(lang) || loading.has(lang) || failed.has(lang)) return;
  const task = loadDictionary(lang)
    .catch((err: unknown) => {
      // Senza dizionario non si segnala nulla: meglio che sottolineare tutto.
      failed.add(lang);
      console.warn(`Controllo ortografico: impossibile caricare il dizionario "${lang}".`, err);
    })
    .finally(() => {
      loading.delete(lang);
      emit();
    });
  loading.set(lang, task);
}

/** Ricrea il checker quando cambiano lingue, parole ignorate o dizionari pronti. */
function currentChecker(enabled: boolean, languages: readonly SpellLanguage[], ignored: readonly string[]): SpellChecker | null {
  if (!enabled) return null;
  const ready = languages.filter((lang) => loaded.has(lang));
  if (ready.length === 0) return null;
  const key = `${ready.join(',')}|${ignored.join('\n')}`;
  if (key !== checkerKey || !checker) {
    checkerKey = key;
    checker = new SpellChecker(
      ready.map((lang) => loaded.get(lang) as HunspellDictionary),
      ignored
    );
  }
  return checker;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getLoadedVersion = (): number => loadedVersion;

/**
 * Il checker attivo, o `null` se il controllo è spento o i dizionari non sono
 * ancora pronti. Avvia il caricamento dei dizionari scelti nelle impostazioni.
 */
export function useSpellChecker(): SpellChecker | null {
  const { settings } = useSettings();
  useSyncExternalStore(subscribe, getLoadedVersion, getLoadedVersion);
  const { spellcheck, spellLanguages, spellIgnored } = settings;
  useEffect(() => {
    if (!spellcheck) return;
    for (const lang of spellLanguages) ensureLoaded(lang);
  }, [spellcheck, spellLanguages]);
  return currentChecker(spellcheck, spellLanguages, spellIgnored);
}

/** Aggiunge una parola a quelle ignorate (vale per tutte le mappe). */
export function ignoreWord(word: string): void {
  const normalized = normalizeIgnoredWord(word);
  if (normalized === '') return;
  const current = getSettingsSnapshot().spellIgnored;
  if (current.includes(normalized)) return;
  updateSettings({ spellIgnored: [...current, normalized].sort((a, b) => a.localeCompare(b)) });
}

/** Toglie una parola da quelle ignorate: torna a essere segnalata. */
export function unignoreWord(word: string): void {
  const normalized = normalizeIgnoredWord(word);
  const current = getSettingsSnapshot().spellIgnored;
  if (!current.includes(normalized)) return;
  updateSettings({ spellIgnored: current.filter((w) => w !== normalized) });
}

/**
 * Parole sbagliate di un testo che può contenere formule `$…$`: le formule
 * non si controllano. Ogni parola compare una volta, nell'ordine del testo.
 */
export function misspelledWords(spell: SpellChecker | null, text: string): string[] {
  if (!spell || text === '') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const segment of splitInlineMath(text)) {
    if (segment.kind !== 'text') continue;
    for (const token of spell.findMisspellings(segment.value)) {
      const key = normalizeIgnoredWord(token.word);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token.word);
    }
  }
  return out;
}
