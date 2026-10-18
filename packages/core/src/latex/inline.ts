/**
 * Segmento di testo o formula matematica inline/display.
 */
export interface InlineMathSegment {
  kind: 'text' | 'math';
  value: string;
  display?: boolean;
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
  if (!text) return [];

  const segments: InlineMathSegment[] = [];
  let textBuf = '';

  const flushText = () => {
    if (textBuf.length > 0) {
      segments.push({ kind: 'text', value: textBuf });
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
        flushText();
        segments.push({
          kind: 'math',
          value: rawContent.trim(),
          display: true,
        });
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
        flushText();
        segments.push({
          kind: 'math',
          value: mathContent,
          display: false,
        });
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

  flushText();
  return segments;
}
