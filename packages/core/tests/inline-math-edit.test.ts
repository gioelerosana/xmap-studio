import { describe, expect, it } from 'vitest';
import {
  findInlineMathSegments,
  formatInlineMath,
  replaceInlineMathSegment,
  spliceTextRuns,
  splitInlineMath,
} from '../src/index.js';

describe('findInlineMathSegments', () => {
  it('restituisce posizione sorgente e LaTeX di una formula display', () => {
    const text = 'Somma $$x$$';
    expect(findInlineMathSegments(text)).toEqual([{ start: 6, end: 11, latex: 'x', display: true }]);
  });

  it('restituisce posizione sorgente di una formula in linea', () => {
    const text = 'Insieme $A$ dei';
    expect(findInlineMathSegments(text)).toEqual([{ start: 8, end: 11, latex: 'A', display: false }]);
  });

  it('ignora il dollaro sfuggito e trova la formula successiva', () => {
    const text = 'Costa 5\\$ e $x$';
    expect(findInlineMathSegments(text)).toEqual([{ start: 12, end: 15, latex: 'x', display: false }]);
  });

  it('restituisce array vuoto senza formule', () => {
    expect(findInlineMathSegments('Costa 5\\$ e basta')).toEqual([]);
  });
});

describe('replaceInlineMathSegment', () => {
  it('conserva il delimitatore $$ e il testo intorno', () => {
    expect(replaceInlineMathSegment('Somma $$x$$ finale', 0, 'y^2')).toBe('Somma $$y^2$$ finale');
  });

  it('conserva il delimitatore $ e il testo intorno', () => {
    expect(replaceInlineMathSegment('Prima $a$ dopo', 0, 'b')).toBe('Prima $b$ dopo');
  });

  it('sostituisce solo la prima di due formule', () => {
    expect(replaceInlineMathSegment('A $x$ e $y$ B', 0, 'z+1')).toBe('A $z+1$ e $y$ B');
  });

  it('sostituisce la seconda formula lasciando la prima', () => {
    expect(replaceInlineMathSegment('A $x$ e $y$ B', 1, 'w')).toBe('A $x$ e $w$ B');
  });

  it('rimuove gli spazi ai bordi della formula', () => {
    expect(replaceInlineMathSegment('$x$', 0, '  y  ')).toBe('$y$');
  });

  it('accetta il dollaro sfuggito dentro il LaTeX', () => {
    expect(replaceInlineMathSegment('$x$', 0, 'a\\$b')).toBe('$a\\$b$');
  });

  it('rifiuta un dollaro non sfuggito che chiuderebbe la formula', () => {
    expect(() => replaceInlineMathSegment('$x$', 0, 'a$b')).toThrow(/simboli \$/);
  });

  it('rifiuta una formula vuota', () => {
    expect(() => replaceInlineMathSegment('$x$', 0, '   ')).toThrow(/vuota/);
  });

  it('rifiuta un indice senza formula', () => {
    expect(() => replaceInlineMathSegment('solo testo', 0, 'x')).toThrow(/non trovata/);
  });

  it('round trip: dopo la scrittura la formula si rilegge com è stata scritta', () => {
    const written = replaceInlineMathSegment('Dati $a$ e $b$', 1, 'c \\cdot d');
    expect(splitInlineMath(written)).toEqual([
      { kind: 'text', value: 'Dati ' },
      { kind: 'math', value: 'a', display: false },
      { kind: 'text', value: ' e ' },
      { kind: 'math', value: 'c \\cdot d', display: false },
    ]);
  });

  it('si può riscrivere più volte di seguito', () => {
    const first = replaceInlineMathSegment('Somma $$x$$', 0, 'y');
    const second = replaceInlineMathSegment(first, 0, 'z');
    expect(findInlineMathSegments(second)).toEqual([{ start: 6, end: 11, latex: 'z', display: true }]);
  });
});

describe('formatInlineMath', () => {
  it('scrive i due tipi di delimitatore', () => {
    expect(formatInlineMath('x', false)).toBe('$x$');
    expect(formatInlineMath('x', true)).toBe('$$x$$');
  });
});

describe('spliceTextRuns', () => {
  it('sostituisce dentro un solo frammento mantenendo lo stile e i campi sconosciuti', () => {
    const runs = [
      { text: 'A $x$ ', bold: true, extra: 'k' },
      { text: 'fine', italic: true },
    ];
    expect(spliceTextRuns(runs, 2, 5, '$y$')).toEqual([
      { text: 'A $y$ ', bold: true, extra: 'k' },
      { text: 'fine', italic: true },
    ]);
  });

  it('se la formula attraversa due frammenti mette il testo nel primo e taglia il secondo', () => {
    const runs = [
      { text: 'A $x', k: 1 },
      { text: '$ B', k: 2 },
    ];
    expect(spliceTextRuns(runs, 2, 5, '$y$')).toEqual([
      { text: 'A $y$', k: 1 },
      { text: ' B', k: 2 },
    ]);
  });

  it('scarta i frammenti svuotati dalla sostituzione', () => {
    const runs = [
      { text: 'ab', k: 1 },
      { text: 'cd', k: 2 },
      { text: 'ef', k: 3 },
    ];
    expect(spliceTextRuns(runs, 0, 4, 'X')).toEqual([
      { text: 'X', k: 1 },
      { text: 'ef', k: 3 },
    ]);
  });

  it('non modifica l’array di partenza', () => {
    const runs = [{ text: 'ab' }];
    spliceTextRuns(runs, 0, 1, 'X');
    expect(runs).toEqual([{ text: 'ab' }]);
  });
});
