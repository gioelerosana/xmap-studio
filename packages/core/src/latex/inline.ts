/**
 * Segmento di testo o formula matematica inline/display.
 */
export interface InlineMathSegment {
  kind: 'text' | 'math';
  value: string;
  display?: boolean;
}

/**
 * Posizione di una formula nel testo sorgente, delimitatori inclusi.
 * `end` è escluso: `text.slice(start, end)` è la formula com'è scritta.
 */
export interface InlineMathLocation {
  start: number;
  end: number;
  latex: string;
  display: boolean;
}

/** Segmento con la sua posizione nel testo sorgente (`end` escluso). */
interface LocatedSegment {
  segment: InlineMathSegment;
  start: number;
  end: number;
}

/**
 * Suddivide una stringa in segmenti di testo e formule matematiche LaTeX.
 *
 * Supporta la sintassi stile Markdown:
 * - `$...$` per formule matematiche in linea (`display: false`).
 * - `$$...$$` per formule matematiche a blocco / display (`display: true`).
 * - `\\$` rappresenta un carattere dollaro letterale (non apre/chiude formule).
 * - Un dollaro seguito da spazio o a capo (`$ `) non apre una formula (es. "costa 5$ e 6$").
 * - Un dollaro non chiuso rimane testo semplice.
 * - Le formule in linea non attraversano ritorni a capo.
 */
export function splitInlineMath(text: string): InlineMathSegment[] {
  return locateInlineMath(text).map(({ segment }) => segment);
}

/** Elenca le formule del testo con la loro posizione, nell'ordine in cui compaiono. */
export function findInlineMathSegments(text: string): InlineMathLocation[] {
  return locateInlineMath(text).flatMap(({ segment, start, end }) =>
    segment.kind === 'math' ? [{ start, end, latex: segment.value, display: segment.display === true }] : [],
  );
}

/** Scrive una formula con i delimitatori scelti: `$...$` oppure `$$...$$`. */
export function formatInlineMath(latex: string, display: boolean): string {
  return display ? `$$${latex}$$` : `$${latex}$`;
}

/**
 * Sostituisce la formula di indice `index` (come in `findInlineMathSegments`) con `latex`,
 * mantenendo il tipo di delimitatore e il resto del testo.
 * Lancia un errore se la formula non si rilegge uguale (es. un `$` non sfuggito nel LaTeX).
 */
export function replaceInlineMathSegment(text: string, index: number, latex: string): string {
  const target = findInlineMathSegments(text)[index];
  if (!target) throw new Error('Formula non trovata nel testo del blocco.');
  const formula = latex.trim();
  if (!formula) throw new Error('La formula non può essere vuota.');

  const next = text.slice(0, target.start) + formatInlineMath(formula, target.display) + text.slice(target.end);
  const written = findInlineMathSegments(next)[index];
  if (!written || written.start !== target.start || written.latex !== formula || written.display !== target.display) {
    throw new Error('La formula non può essere scritta nel testo del blocco: controlla i simboli $ e le barre finali.');
  }
  return next;
}

/**
 * Sostituisce il testo tra `start` e `end` (indici sul testo complessivo dei frammenti) con
 * `replacement`. Il nuovo testo finisce nel frammento che contiene `start`; gli altri frammenti
 * perdono solo la parte coperta. Ogni frammento è ricopiato con lo spread, così stile e campi
 * sconosciuti sopravvivono; i frammenti rimasti vuoti vengono scartati.
 */
export function spliceTextRuns<T extends { text: string }>(
  runs: readonly T[],
  start: number,
  end: number,
  replacement: string,
): T[] {
  return runs
    .map((run, index) => {
      const runStart = runs.slice(0, index).reduce((sum, previous) => sum + previous.text.length, 0);
      const runEnd = runStart + run.text.length;
      const holdsStart = runStart <= start && start < runEnd;
      const head = run.text.slice(0, clamp(start - runStart, run.text.length));
      const tail = run.text.slice(clamp(end - runStart, run.text.length));
      return { ...run, text: head + (holdsStart ? replacement : '') + tail };
    })
    .filter((run) => run.text.length > 0);
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

// Scansione unica dei segmenti, con le posizioni sorgente: serve sia alla suddivisione sia alla riscrittura.
function locateInlineMath(text: string): LocatedSegment[] {
  if (!text) return [];

  const segments: LocatedSegment[] = [];
  let textBuf = '';
  // Inizio del testo accumulato: dopo ogni formula riparte dalla sua fine.
  let textStart = 0;

  const flushText = (end: number) => {
    if (textBuf.length > 0) {
      segments.push({ segment: { kind: 'text', value: textBuf }, start: textStart, end });
      textBuf = '';
    }
  };

  const n = text.length;
  let i = 0;

  while (i < n) {
    // Gestione backslash di escape
    if (text[i] === '\\') {
      let count = 0;
      while (i + count < n && text[i + count] === '\\') {
        count++;
      }

      // Se seguito da '$', verifichiamo se il dollaro è sfuggito
      if (i + count < n && text[i + count] === '$') {
        if (count % 2 === 1) {
          // Numero dispari: l'ultimo backslash fa l'escape di '$'
          textBuf += '\\'.repeat((count - 1) / 2) + '$';
          i += count + 1;
          continue;
        } else {
          // Numero pari: backslash appaiati, il '$' successivo NON è sfuggito
          textBuf += '\\'.repeat(count / 2);
          i += count;
          // Continua sotto per processare text[i] come dollaro
        }
      } else {
        // Sequenza ordinaria di backslash nel testo
        textBuf += text.slice(i, i + count);
        i += count;
        continue;
      }
    }

    // Caso 1: Formula display '$$...$$'
    if (text[i] === '$' && i + 1 < n && text[i + 1] === '$') {
      // Cerca la chiusura '$$' non preceduta da escape dispari
      let foundClose = -1;
      let j = i + 2;

      while (j < n - 1) {
        if (text[j] === '$' && text[j + 1] === '$') {
          // Controlla quanti backslash precedono text[j]
          let bs = 0;
          let k = j - 1;
          while (k >= i + 2 && text[k] === '\\') {
            bs++;
            k--;
          }
          if (bs % 2 === 0) {
            foundClose = j;
            break;
          }
        }
        j++;
      }

      if (foundClose !== -1) {
        const rawContent = text.slice(i + 2, foundClose);
        flushText(i);
        segments.push({
          segment: { kind: 'math', value: rawContent.trim(), display: true },
          start: i,
          end: foundClose + 2,
        });
        textStart = foundClose + 2;
        i = foundClose + 2;
        continue;
      } else {
        // Nessuna chiusura: resta testo
        textBuf += '$$';
        i += 2;
        continue;
      }
    }

    // Caso 2: Possibile formula in linea '$...$'
    if (text[i] === '$') {
      // '$ ' seguito da spazio, a capo o fine stringa non apre una formula
      const nextChar = text[i + 1];
      if (!nextChar || /\s/.test(nextChar) || nextChar === '$') {
        textBuf += '$';
        i++;
        continue;
      }

      // Cerca il dollaro di chiusura sulla stessa riga
      let foundClose = -1;
      let j = i + 1;

      while (j < n) {
        // Le formule in linea non attraversano ritorni a capo
        if (text[j] === '\n' || text[j] === '\r') {
          break;
        }

        if (text[j] === '$') {
          // Deve essere un singolo dollaro (non '$$')
          const isDouble = (j + 1 < n && text[j + 1] === '$') || (j > i + 1 && text[j - 1] === '$');
          if (!isDouble) {
            // Controlla escape
            let bs = 0;
            let k = j - 1;
            while (k >= i + 1 && text[k] === '\\') {
              bs++;
              k--;
            }
            if (bs % 2 === 0) {
              // Regola Markdown: il dollaro di chiusura non deve essere preceduto da spazio
              const prevChar = text[j - 1];
              if (prevChar && !/\s/.test(prevChar)) {
                foundClose = j;
                break;
              }
            }
          }
        }
        j++;
      }

      if (foundClose !== -1) {
        const mathContent = text.slice(i + 1, foundClose);
        flushText(i);
        segments.push({
          segment: { kind: 'math', value: mathContent, display: false },
          start: i,
          end: foundClose + 1,
        });
        textStart = foundClose + 1;
        i = foundClose + 1;
        continue;
      } else {
        // Nessuna chiusura valida: resta testo
        textBuf += '$';
        i++;
        continue;
      }
    }

    textBuf += text[i];
    i++;
  }

  flushText(n);
  return segments;
}
