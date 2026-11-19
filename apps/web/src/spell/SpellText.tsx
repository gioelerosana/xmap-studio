import React from 'react';
import type { WordToken } from '@xmap/core';
import { useSpellContext } from './SpellContext.js';

interface SpellTextProps {
  text: string;
  /**
   * Errori già calcolati su un testo più lungo (titolo con più stili), con
   * `offset` = posizione di `text` in quel testo. Così una parola divisa fra
   * due stili ("**fun**zione") si controlla intera. Senza, si calcolano qui.
   */
  errors?: readonly WordToken[];
  offset?: number;
}

/**
 * Testo semplice con le parole sbagliate sottolineate (`.spell-error`).
 * La marcatura è solo a schermo: `data-spell` permette alle esportazioni
 * che copiano il DOM di toglierla (vedi `print/mapClone.ts`).
 */
export const SpellText: React.FC<SpellTextProps> = ({ text, errors, offset = 0 }) => {
  const spell = useSpellContext();
  if (!spell) return <>{text}</>;
  const found = errors ?? spell.findMisspellings(text);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const token of found) {
    const start = Math.max(token.start - offset, 0);
    const end = Math.min(token.end - offset, text.length);
    if (end <= start || start < pos) continue;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(
      <span key={start} data-spell="" className="spell-error">
        {text.slice(start, end)}
      </span>
    );
    pos = end;
  }
  if (parts.length === 0) return <>{text}</>;
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
};
