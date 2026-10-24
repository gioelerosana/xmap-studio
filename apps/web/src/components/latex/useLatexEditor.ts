import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, SyntheticEvent } from 'react';
import { parseSnippet, searchCommands, type LatexCommand } from './latexCatalog.js';

const INDENT = '  ';
/** Gruppi vuoti degli snippet in cui saltare dopo aver chiuso il precedente con `}`. */
const EMPTY_GROUPS = ['{}', '^{}', '_{}'];
/** Due barre rovesciate consecutive sono un "a capo", non l'inizio di un comando. */
const PAIR = 2;

interface LatexEditorOptions {
  value: string;
  onValueChange: (next: string) => void;
  /** Invio senza suggerimenti aperti: applica la formula (Maiusc+Invio va a capo). */
  onSubmit: () => void;
}

interface CommandToken {
  /** Posizione della barra rovesciata che apre il comando. */
  start: number;
  prefix: string;
}

// Comando in corso di digitazione subito prima del cursore: `\` dispari + lettere.
function commandBeforeCaret(value: string, caret: number): CommandToken | null {
  // Accetta "x+\fra" (barre + lettere in coda al testo); scarta "\fra2" (non finisce con lettere).
  // Le barre pari ("\\fra", un a capo) le scarta il controllo sotto.
  // https://regex101.com/?regex=(%5C%5C%2B)(%5BA-Za-z%5D%2B)%24&testString=x%2B%5Cfra
  const match = /(\\+)([A-Za-z]+)$/.exec(value.slice(0, caret));
  if (!match || (match[1]?.length ?? 0) % PAIR !== 1) return null;
  const prefix = match[2] ?? '';
  return { start: caret - prefix.length - 1, prefix };
}

// Modifica il testo con `execCommand` quando possibile: così Ctrl+Z annulla anche gli
// inserimenti fatti da suggerimenti e tavolozza. Se il browser lo rifiuta, ripiega sullo stato.
function replaceInTextarea(el: HTMLTextAreaElement, start: number, end: number, text: string): boolean {
  el.focus();
  el.setSelectionRange(start, end);
  try {
    return text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
  } catch {
    return false;
  }
}

// Logica del campo LaTeX: inserimento di frammenti, rientro, graffe automatiche e suggerimenti.
export function useLatexEditor({ value, onValueChange, onSubmit }: LatexEditorOptions) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const listId = useId();

  // Ripiego senza execCommand: il cursore si sposta dopo che React ha scritto il nuovo valore.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const replaceRange = useCallback(
    (start: number, end: number, text: string, caretOffset: number) => {
      const el = textareaRef.current;
      if (!el) return;
      const target = start + caretOffset;
      if (replaceInTextarea(el, start, end, text)) {
        el.setSelectionRange(target, target);
      } else {
        pendingCaret.current = target;
        onValueChange(el.value.slice(0, start) + text + el.value.slice(end));
      }
      setCaret(target);
      setActiveIndex(0);
    },
    [onValueChange],
  );

  const insertSnippet = useCallback(
    (snippet: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const { text, caret: offset } = parseSnippet(snippet);
      replaceRange(el.selectionStart, el.selectionEnd, text, offset);
    },
    [replaceRange],
  );

  // Inserisce testo così com'è, lasciando il cursore alla fine.
  const insertText = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      if (el) replaceRange(el.selectionStart, el.selectionEnd, text, text.length);
    },
    [replaceRange],
  );

  const token = useMemo(() => commandBeforeCaret(value, caret), [value, caret]);
  const tokenKey = token ? `${token.start}:${token.prefix}` : null;

  const suggestions = useMemo<LatexCommand[]>(() => {
    if (!token || !focused || tokenKey === dismissedKey) return [];
    const found = searchCommands(token.prefix);
    // Comando già scritto per intero e senza argomenti: niente lista, Invio resta a capo.
    const [only] = found;
    if (found.length === 1 && only && only.snippet === `\\${token.prefix}`) return [];
    return found;
  }, [token, tokenKey, focused, dismissedKey]);

  const open = suggestions.length > 0;
  const current = Math.min(activeIndex, Math.max(suggestions.length - 1, 0));

  const accept = useCallback(
    (index: number) => {
      const command = suggestions[index];
      if (!command || !token) return;
      const { text, caret: offset } = parseSnippet(command.snippet);
      replaceRange(token.start, token.start + 1 + token.prefix.length, text, offset);
    },
    [suggestions, token, replaceRange],
  );

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onValueChange(event.target.value);
    setCaret(event.target.selectionStart);
    setActiveIndex(0);
  };

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(event.currentTarget.selectionStart);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((current + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && plain) {
        event.preventDefault();
        accept(current);
        return;
      }
      if (event.key === 'Escape') {
        // Chiude solo la lista: il dialog ignora gli Esc già gestiti.
        event.preventDefault();
        setDismissedKey(tokenKey);
        return;
      }
    }

    // Invio applica anche con il campo vuoto o in errore: in quel caso `onSubmit` non fa nulla.
    if (event.key === 'Enter' && plain) {
      event.preventDefault();
      onSubmit();
      return;
    }

    if (event.key === 'Tab' && plain) {
      event.preventDefault();
      replaceRange(start, end, INDENT, INDENT.length);
      return;
    }

    if (start !== end) return;
    if (event.key === '{') {
      event.preventDefault();
      replaceRange(start, end, '{}', 1);
    } else if (event.key === '}' && value[start] === '}') {
      // Sovrascrive la graffa chiusa inserita in automatico; se segue un altro gruppo
      // vuoto (`\frac{}{}`, `_{}^{}`) il cursore entra direttamente in quello.
      event.preventDefault();
      const next = EMPTY_GROUPS.find((group) => value.startsWith(group, start + 1));
      const target = next ? start + next.length : start + 1;
      el.setSelectionRange(target, target);
      setCaret(target);
    } else if (event.key === 'Backspace' && value[start - 1] === '{' && value[start] === '}') {
      event.preventDefault();
      replaceRange(start - 1, start + 1, '', 0);
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

  return {
    textareaRef,
    insertSnippet,
    insertText,
    suggestions,
    activeIndex: current,
    setActiveIndex,
    acceptSuggestion: accept,
    listId,
    optionId,
    textareaProps: {
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onSelect: handleSelect,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      role: 'combobox' as const,
      'aria-autocomplete': 'list' as const,
      'aria-expanded': open,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? optionId(current) : undefined,
    },
  };
}
