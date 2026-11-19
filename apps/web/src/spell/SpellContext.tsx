import { createContext, useContext } from 'react';
import type { SpellChecker } from '@xmap/core';

/**
 * Checker ortografico della mappa a schermo. Senza provider (stampa,
 * anteprime fuori schermo) vale `null` e non si segnala nulla.
 */
export const SpellContext = createContext<SpellChecker | null>(null);

export const useSpellContext = (): SpellChecker | null => useContext(SpellContext);
