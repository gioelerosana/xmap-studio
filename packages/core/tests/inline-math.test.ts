import { describe, expect, it } from 'vitest';
import { splitInlineMath, renderLatexToSvg, EstimatedMetrics, MapNode } from '../src/index.js';

describe('splitInlineMath', () => {
  describe('Testo semplice ed edge cases', () => {
    it('restituisce array vuoto per stringa vuota o nulla', () => {
      expect(splitInlineMath('')).toEqual([]);
    });

    it('restituisce un singolo segmento text per testo senza formule', () => {
      expect(splitInlineMath('Solo testo senza formule')).toEqual([
        { kind: 'text', value: 'Solo testo senza formule' },
      ]);
    });
  });

  describe('Formule in linea ($...$)', () => {
    it('riconosce una formula isolata', () => {
      expect(splitInlineMath('$\\mathcal A$')).toEqual([
        { kind: 'math', value: '\\mathcal A', display: false },
      ]);
    });

    it('riconosce formule mescolate a testo (esempio del brief)', () => {
      expect(splitInlineMath('Insieme $\\mathcal A$ dei punti')).toEqual([
        { kind: 'text', value: 'Insieme ' },
        { kind: 'math', value: '\\mathcal A', display: false },
        { kind: 'text', value: ' dei punti' },
      ]);
    });

    it('riconosce formule a inizio e fine testo', () => {
      expect(splitInlineMath('$x$ alla partenza')).toEqual([
        { kind: 'math', value: 'x', display: false },
        { kind: 'text', value: ' alla partenza' },
      ]);

      expect(splitInlineMath('in arrivo $y$')).toEqual([
        { kind: 'text', value: 'in arrivo ' },
        { kind: 'math', value: 'y', display: false },
      ]);
    });

    it('supporta spazi interni alla formula', () => {
      expect(splitInlineMath('Dati $a + b = c$ con certezza')).toEqual([
        { kind: 'text', value: 'Dati ' },
        { kind: 'math', value: 'a + b = c', display: false },
        { kind: 'text', value: ' con certezza' },
      ]);
    });
  });

  describe('Formule a blocco / display ($$...$$)', () => {
    it('riconosce display math singolo', () => {
      expect(splitInlineMath('$$\\sum_{i=1}^n i$$')).toEqual([
        { kind: 'math', value: '\\sum_{i=1}^n i', display: true },
      ]);
    });

    it('riconosce display math mescolato al testo', () => {
      expect(splitInlineMath('Formula: $$E = mc^2$$ fine')).toEqual([
        { kind: 'text', value: 'Formula: ' },
        { kind: 'math', value: 'E = mc^2', display: true },
        { kind: 'text', value: ' fine' },
      ]);
    });

    it('supporta display math multilinea con ritorni a capo', () => {
      const input = 'Calcolo:\n$$\n\\begin{matrix}\n1 & 2 \\\\\n3 & 4\n\\end{matrix}\n$$\nFine';
      expect(splitInlineMath(input)).toEqual([
        { kind: 'text', value: 'Calcolo:\n' },
        {
          kind: 'math',
          value: '\\begin{matrix}\n1 & 2 \\\\\n3 & 4\n\\end{matrix}',
          display: true,
        },
        { kind: 'text', value: '\nFine' },
      ]);
    });
  });

  describe('Escape del dollaro (\\$)', () => {
    it('rende \\$ come dollaro letterale nel testo', () => {
      expect(splitInlineMath('Costa \\$5 e \\$10')).toEqual([
        { kind: 'text', value: 'Costa $5 e $10' },
      ]);
    });

    it("gestisce \\$ all'interno di una formula LaTeX senza chiuderla prematuramente", () => {
      expect(splitInlineMath('Valore: $\\text{prezzo: }\\$5$ euro')).toEqual([
        { kind: 'text', value: 'Valore: ' },
        { kind: 'math', value: '\\text{prezzo: }\\$5', display: false },
        { kind: 'text', value: ' euro' },
      ]);
    });

    it('gestisce backslash appaiati seguiti da dollaro (\\\\$)', () => {
      // '\\\\$' = un backslash letterale + dollaro non sfuggito
      expect(splitInlineMath('\\\\$x$')).toEqual([
        { kind: 'text', value: '\\' },
        { kind: 'math', value: 'x', display: false },
      ]);
    });
  });

  describe('Dollari non chiusi e regole anti-falsi positivi (Markdown)', () => {
    it('un dollaro seguito da spazio non apre una formula (es. "costa 5$ e 6$")', () => {
      expect(splitInlineMath('costa 5$ e 6$')).toEqual([
        { kind: 'text', value: 'costa 5$ e 6$' },
      ]);
    });

    it('non apre formule con "$ "', () => {
      expect(splitInlineMath('$ x$ non è math')).toEqual([
        { kind: 'text', value: '$ x$ non è math' },
      ]);
    });

    it('non chiude formule con " $" (spazio prima del dollaro di chiusura)', () => {
      expect(splitInlineMath('$x $ non chiude')).toEqual([
        { kind: 'text', value: '$x $ non chiude' },
      ]);
    });

    it('evita falsi positivi con importi tipo "$5 e $6"', () => {
      expect(splitInlineMath('prezzo $5 e $6')).toEqual([
        { kind: 'text', value: 'prezzo $5 e $6' },
      ]);
    });

    it('lascia come testo i singoli dollari isolati o non chiusi', () => {
      expect(splitInlineMath('Solo $ dollaro')).toEqual([
        { kind: 'text', value: 'Solo $ dollaro' },
      ]);
      expect(splitInlineMath('Incompleto $formula')).toEqual([
        { kind: 'text', value: 'Incompleto $formula' },
      ]);
    });

    it('lascia come testo i $$ non chiusi', () => {
      expect(splitInlineMath('Testo con $$ non chiuso')).toEqual([
        { kind: 'text', value: 'Testo con $$ non chiuso' },
      ]);
    });
  });

  describe('Più formule nello stesso testo', () => {
    it('separa correttamente formule consecutive e alternate', () => {
      expect(splitInlineMath('Dati $a$ e $b$, allora $$a + b = c$$ con $c > 0$.')).toEqual([
        { kind: 'text', value: 'Dati ' },
        { kind: 'math', value: 'a', display: false },
        { kind: 'text', value: ' e ' },
        { kind: 'math', value: 'b', display: false },
        { kind: 'text', value: ', allora ' },
        { kind: 'math', value: 'a + b = c', display: true },
        { kind: 'text', value: ' con ' },
        { kind: 'math', value: 'c > 0', display: false },
        { kind: 'text', value: '.' },
      ]);
    });
  });

  describe('Testo con ritorni a capo (multilinea)', () => {
    it('mantiene i ritorni a capo nel testo con formule su righe separate', () => {
      const input = 'Riga 1 con $x$\nRiga 2 con $y$';
      expect(splitInlineMath(input)).toEqual([
        { kind: 'text', value: 'Riga 1 con ' },
        { kind: 'math', value: 'x', display: false },
        { kind: 'text', value: '\nRiga 2 con ' },
        { kind: 'math', value: 'y', display: false },
      ]);
    });

    it('non fa attraversare i ritorni a capo a una formula in linea $...$', () => {
      const input = 'Prezzo $10\nSconto $20';
      expect(splitInlineMath(input)).toEqual([
        { kind: 'text', value: 'Prezzo $10\nSconto $20' },
      ]);
    });
  });

  describe('renderLatexToSvg con supporto inline e memoizzazione', () => {
    it('preserva vertical-align in modalità inline (display: false)', () => {
      const inlineRes = renderLatexToSvg('\\mathcal A', 14, false);
      expect(inlineRes.error).toBeNull();
      expect(inlineRes.svg).toContain('style="vertical-align:');
      expect(inlineRes.svg).toContain('fill="currentColor"');
      expect(inlineRes.width).toBeGreaterThan(0);
      expect(inlineRes.height).toBeGreaterThan(0);
    });

    it('rimuove vertical-align in modalità display (display: true)', () => {
      const displayRes = renderLatexToSvg('\\mathcal A', 14, true);
      expect(displayRes.error).toBeNull();
      expect(displayRes.svg).not.toContain('style="vertical-align:');
    });

    it('usa la cache per chiamate ripetute', () => {
      const r1 = renderLatexToSvg('\\alpha + \\beta', 16, false);
      const r2 = renderLatexToSvg('\\alpha + \\beta', 16, false);
      expect(r1).toBe(r2); // stessa istanza per riferimento
    });
  });

  describe('EstimatedMetrics: layout con formule matematiche nel titolo', () => {
    const makeNode = (title: string, over: Partial<MapNode> = {}): MapNode => ({
      id: 'test-node',
      title,
      displayTitle: title,
      kind: 'text',
      labels: [],
      markers: [],
      hasNotes: false,
      notes: '',
      childCount: 0,
      group: 'attached',
      depth: 1,
      sheetIndex: 0,
      children: [],
      summaries: [],
      ...over,
    });

    it('misura un nodo con formula in linea "Insieme $\\mathcal A$ dei punti"', () => {
      const metrics = new EstimatedMetrics();
      const node = makeNode('Insieme $\\mathcal A$ dei punti');
      const size = metrics.measure(node);
      expect(size.w).toBeGreaterThanOrEqual(96);
      expect(size.h).toBeGreaterThanOrEqual(36);
    });

    it("aumenta l'altezza del blocco per formule matematiche verticali (es. frazioni alte)", () => {
      const metrics = new EstimatedMetrics();
      const plainNode = makeNode('Testo semplice basso');
      const tallMathNode = makeNode('$\\frac{\\sum_{i=1}^n x_i}{\\prod_{j=1}^m y_j}$');

      const plainSize = metrics.measure(plainNode);
      const mathSize = metrics.measure(tallMathNode);

      expect(plainSize.h).toBe(36);
      // La frazione complessa richiede altezza maggiore di 36px
      expect(mathSize.h).toBeGreaterThan(plainSize.h);
    });

    it('gestisce errori LaTeX senza lanciare eccezioni nella misura', () => {
      const metrics = new EstimatedMetrics();
      const node = makeNode('Formula non valida $\\nonexistentCommand{$ fine');
      expect(() => metrics.measure(node)).not.toThrow();
      const size = metrics.measure(node);
      expect(size.w).toBeGreaterThanOrEqual(96);
      expect(size.h).toBeGreaterThanOrEqual(36);
    });

    it('misura nodi con titleRuns formattati contenenti formule', () => {
      const metrics = new EstimatedMetrics();
      const node = makeNode('Test $x$', {
        titleRuns: [
          { text: 'Test ', bold: true },
          { text: '$x$', italic: true },
        ],
      });
      const size = metrics.measure(node);
      expect(size.w).toBeGreaterThanOrEqual(96);
      expect(size.h).toBeGreaterThanOrEqual(36);
    });
  });
});
