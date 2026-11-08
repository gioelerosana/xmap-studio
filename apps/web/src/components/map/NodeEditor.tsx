import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@xmap/ui-kit';
import type { TextStyle, TitleRun } from '@xmap/core';
import { clampFontSizePx, registerInlineEditor, type InlineToggleStyle } from './editorBridge.js';

export type EditExit = 'enter' | 'tab' | 'blur';

export interface NodeEditorProps {
  /** Posizione e misura del blocco in coordinate mondo (il contenitore applica pan/zoom). */
  x: number;
  y: number;
  w: number;
  h: number;
  isRoot: boolean;
  /** Dimensione base del testo del blocco in px, la stessa del blocco disegnato (`titleBaseFontPx`). */
  fontPx: number;
  initialText: string;
  initialRuns?: TitleRun[];
  /** Seleziona tutto il testo all'apertura; altrimenti il cursore va in fondo. */
  selectAll: boolean;
  onCommit: (text: string, exit: EditExit, runs?: TitleRun[]) => void;
  onCancel: () => void;
  /** Blocco in modifica: si fissa all'apertura e non segue i cambi successivi della prop. */
  topicId: string;
  /**
   * Smontaggio senza conferma né annullamento (il blocco sparisce dal layout per collasso, undo,
   * eliminazione, cambio di foglio…) con il testo cambiato: `topicId` è quello dell'apertura.
   * Chi la riceve decide se il blocco esiste ancora; altrimenti il testo si scarta.
   */
  onUnmountCommit?: (topicId: string, text: string, runs?: TitleRun[]) => void;
}

interface StyledChar {
  char: string;
  style: TextStyle & Record<string, unknown>;
}

function resolveStyle(startEl: HTMLElement | null, root: HTMLElement): TextStyle & Record<string, unknown> {
  const result: TextStyle & Record<string, unknown> = {};
  let cur: HTMLElement | null = startEl;
  while (cur && cur !== root) {
    const tag = cur.tagName;
    if (tag === 'B' || tag === 'STRONG') result.bold = true;
    const fw = cur.style.fontWeight;
    if (fw) {
      if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) result.bold = true;
      else if (fw === 'normal' || fw === 'lighter' || (Number(fw) > 0 && Number(fw) < 600)) result.bold = false;
    }
    if (cur.dataset.bold === 'true') result.bold = true;
    if (cur.dataset.bold === 'false') result.bold = false;

    if (tag === 'I' || tag === 'EM') result.italic = true;
    const fs = cur.style.fontStyle;
    if (fs) {
      if (fs === 'italic' || fs === 'oblique') result.italic = true;
      else if (fs === 'normal') result.italic = false;
    }
    if (cur.dataset.italic === 'true') result.italic = true;
    if (cur.dataset.italic === 'false') result.italic = false;

    if (tag === 'U') result.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') result.strikethrough = true;
    const td = cur.style.textDecoration;
    if (td) {
      if (td.includes('underline')) result.underline = true;
      if (td.includes('line-through')) result.strikethrough = true;
      if (td === 'none') {
        result.underline = false;
        result.strikethrough = false;
      }
    }
    if (cur.dataset.underline === 'true') result.underline = true;
    if (cur.dataset.underline === 'false') result.underline = false;
    if (cur.dataset.strikethrough === 'true') result.strikethrough = true;

    if (!result.color) {
      if (cur.dataset.color) result.color = cur.dataset.color;
      else if (cur.style.color) result.color = cur.style.color;
    }

    if (result.fontSizePx === undefined) {
      if (cur.dataset.fontSizePx) {
        const n = Number(cur.dataset.fontSizePx);
        if (n > 0) result.fontSizePx = n;
      }
    }

    if (cur.dataset.extra) {
      try {
        const extra = JSON.parse(cur.dataset.extra);
        Object.assign(result, extra);
      } catch {
        // ignore
      }
    }

    cur = cur.parentElement;
  }
  return result;
}

/**
 * Ultimo nodo del contenuto, ignorando i testi vuoti: un `<br>` in coda è quello che il browser
 * aggiunge a un contenteditable svuotato (o il segnaposto di `renderRunsToElement`), non un a capo.
 */
function trailingNode(root: Node): Node | null {
  let cur: Node | null = root.lastChild;
  while (cur) {
    if (cur.nodeType === Node.TEXT_NODE && (cur.textContent ?? '') === '') {
      cur = cur.previousSibling;
    } else if (cur.nodeType === Node.ELEMENT_NODE && cur.nodeName !== 'BR' && cur.lastChild) {
      cur = cur.lastChild;
    } else {
      return cur;
    }
  }
  return null;
}

// Un elemento per unità UTF-16: gli indici coincidono con gli offset della selezione DOM
// (emoji e simboli fuori dal BMP occupano due unità); i run riuniscono le due metà.
function getStyledChars(root: HTMLElement): StyledChar[] {
  const chars: StyledChar[] = [];
  const trailing = trailingNode(root);

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        const style = resolveStyle(node.parentElement, root);
        for (let i = 0; i < text.length; i++) {
          chars.push({ char: text[i], style: { ...style } });
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'BR') {
        if (el === trailing) return;
        const style = resolveStyle(el.parentElement, root);
        chars.push({ char: '\n', style: { ...style } });
      } else {
        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i]);
        }
      }
    }
  }

  for (let i = 0; i < root.childNodes.length; i++) {
    walk(root.childNodes[i]);
  }
  return chars;
}

function charsToRuns(chars: StyledChar[]): TitleRun[] {
  if (chars.length === 0) return [];
  const runs: TitleRun[] = [];
  let currentRun: TitleRun | null = null;

  for (const item of chars) {
    const style = item.style;
    if (
      currentRun &&
      Boolean(currentRun.bold) === Boolean(style.bold) &&
      Boolean(currentRun.italic) === Boolean(style.italic) &&
      Boolean(currentRun.underline) === Boolean(style.underline) &&
      Boolean(currentRun.strikethrough) === Boolean(style.strikethrough) &&
      currentRun.color === style.color &&
      currentRun.fontSizePx === style.fontSizePx
    ) {
      currentRun.text += item.char;
    } else {
      const newRun: TitleRun = {
        text: item.char,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italic ? { italic: true } : {}),
        ...(style.underline ? { underline: true } : {}),
        ...(style.strikethrough ? { strikethrough: true } : {}),
        ...(style.color ? { color: style.color } : {}),
        ...(style.fontSizePx ? { fontSizePx: style.fontSizePx } : {}),
      };
      for (const [k, v] of Object.entries(style)) {
        if (!['bold', 'italic', 'underline', 'strikethrough', 'color', 'fontSizePx'].includes(k)) {
          (newRun as unknown as Record<string, unknown>)[k] = v;
        }
      }
      runs.push(newRun);
      currentRun = newRun;
    }
  }
  return runs;
}

function renderRunsToElement(root: HTMLElement, runs: TitleRun[]) {
  root.innerHTML = '';
  if (runs.length === 0) return;

  const hasAnyStyle = runs.some(
    (r) =>
      r.bold ||
      r.italic ||
      r.underline ||
      r.strikethrough ||
      r.color ||
      r.fontSizePx ||
      Object.keys(r).some(
        (k) =>
          !['text', 'bold', 'italic', 'underline', 'strikethrough', 'color', 'fontSizePx'].includes(k)
      )
  );

  // Un a capo in coda non crea una riga visibile: senza un `<br>` dopo, il cursore resterebbe
  // sulla riga precedente. Il `<br>` finale non entra nel titolo (vedi `getStyledChars`).
  const endsWithNewline = runs[runs.length - 1]?.text.endsWith('\n') ?? false;

  if (!hasAnyStyle) {
    root.textContent = runs.map((r) => r.text).join('');
    if (endsWithNewline) root.appendChild(document.createElement('br'));
    return;
  }

  for (const run of runs) {
    if (!run.text) continue;
    const span = document.createElement('span');
    span.textContent = run.text;
    if (run.bold) {
      span.style.fontWeight = '700';
      span.dataset.bold = 'true';
    }
    if (run.italic) {
      span.style.fontStyle = 'italic';
      span.dataset.italic = 'true';
    }
    if (run.underline && run.strikethrough) {
      span.style.textDecoration = 'underline line-through';
      span.dataset.underline = 'true';
      span.dataset.strikethrough = 'true';
    } else if (run.underline) {
      span.style.textDecoration = 'underline';
      span.dataset.underline = 'true';
    } else if (run.strikethrough) {
      span.style.textDecoration = 'line-through';
      span.dataset.strikethrough = 'true';
    }
    if (run.color) {
      span.style.color = run.color;
      span.dataset.color = run.color;
    }
    if (run.fontSizePx) {
      span.style.fontSize = `${run.fontSizePx}px`;
      span.dataset.fontSizePx = String(run.fontSizePx);
    }
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(run)) {
      if (
        !['text', 'bold', 'italic', 'underline', 'strikethrough', 'color', 'fontSizePx'].includes(k)
      ) {
        extra[k] = v;
      }
    }
    if (Object.keys(extra).length > 0) {
      span.dataset.extra = JSON.stringify(extra);
    }
    root.appendChild(span);
  }
  if (endsWithNewline) root.appendChild(document.createElement('br'));
}

function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const preStartRange = document.createRange();
  preStartRange.selectNodeContents(root);
  preStartRange.setEnd(range.startContainer, range.startOffset);
  const start = preStartRange.toString().length;

  const preEndRange = document.createRange();
  preEndRange.selectNodeContents(root);
  preEndRange.setEnd(range.endContainer, range.endOffset);
  const end = preEndRange.toString().length;

  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function setSelectionOffsets(root: HTMLElement, start: number, end: number) {
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  let currentOffset = 0;
  let startNode: Node | null = null;
  let startOffsetInNode = 0;
  let endNode: Node | null = null;
  let endOffsetInNode = 0;

  function traverse(node: Node) {
    if (startNode && endNode) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (!startNode && start <= currentOffset + len) {
        startNode = node;
        startOffsetInNode = Math.max(0, start - currentOffset);
      }
      if (!endNode && end <= currentOffset + len) {
        endNode = node;
        endOffsetInNode = Math.max(0, end - currentOffset);
      }
      currentOffset += len;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        traverse(node.childNodes[i]);
        if (startNode && endNode) return;
      }
    }
  }

  traverse(root);

  if (startNode && endNode) {
    range.setStart(startNode, startOffsetInNode);
    range.setEnd(endNode, endOffsetInNode);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    range.selectNodeContents(root);
    if (start === end && start === 0) {
      range.collapse(true);
    } else if (start === end) {
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

const PLAIN_RUN_KEYS = ['text', 'bold', 'italic', 'underline', 'strikethrough', 'color', 'fontSizePx'];

/** Titolo dell'editor: testo e, solo se c'è formattazione, i run. */
function readContent(root: HTMLElement): { text: string; runs?: TitleRun[] } {
  const runs = charsToRuns(getStyledChars(root));
  const text = runs.map((r) => r.text).join('');
  const hasStyle = runs.some(
    (r) =>
      r.bold ||
      r.italic ||
      r.underline ||
      r.strikethrough ||
      r.color ||
      r.fontSizePx ||
      Object.keys(r).some((k) => !PLAIN_RUN_KEYS.includes(k))
  );
  return { text, runs: hasStyle ? runs : undefined };
}

const contentKey = (c: { text: string; runs?: TitleRun[] }): string => JSON.stringify([c.text, c.runs ?? null]);

/**
 * Editor in place del titolo di un blocco con supporto alla formattazione parziale (attributedTitle):
 * Invio conferma, Maiusc+Invio va a capo, Tab conferma, Esc annulla, incolla solo testo semplice,
 * Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+U formattano la selezione corrente.
 */
export const NodeEditor: React.FC<NodeEditorProps> = ({
  x,
  y,
  w,
  h,
  isRoot,
  fontPx,
  initialText,
  initialRuns,
  selectAll,
  onCommit,
  onCancel,
  topicId,
  onUnmountCommit,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const startTopicId = useRef(topicId);
  // Allo smontaggio servono le callback più recenti, non quelle del primo render.
  const onUnmountCommitRef = useRef(onUnmountCommit);
  onUnmountCommitRef.current = onUnmountCommit;

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, h)}px`;
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (initialRuns && initialRuns.length > 0) {
      renderRunsToElement(el, initialRuns);
    } else {
      el.textContent = initialText;
    }
    el.focus({ preventScroll: true });
    if (selectAll) {
      const totalLen = (el.textContent ?? '').length;
      setSelectionOffsets(el, 0, totalLen);
    } else {
      const totalLen = (el.textContent ?? '').length;
      setSelectionOffsets(el, totalLen, totalLen);
    }
    fit();
    // Contenuto di partenza così come lo rilegge `readContent`: allo smontaggio si conferma solo
    // se è cambiato (niente passi di annullamento vuoti). Lo smontaggio simulato di StrictMode
    // arriva prima di ogni modifica, quindi non conferma nulla.
    const initialSnapshot = contentKey(readContent(el));
    return () => {
      // Già confermato (Invio, Tab, blur) o annullato (Esc): niente da fare. Il blur non arriva
      // a un editor smontato, quindi senza questo il testo scritto andrebbe perso.
      if (done.current) return;
      const content = readContent(el);
      if (contentKey(content) === initialSnapshot) return;
      done.current = true;
      onUnmountCommitRef.current?.(startTopicId.current, content.text, content.runs);
    };
    // Solo all'apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (exit: EditExit) => {
    if (done.current) return;
    done.current = true;
    const el = ref.current;
    if (!el) {
      onCommit(initialText, exit);
      return;
    }
    const { text, runs } = readContent(el);
    onCommit(text, exit, runs);
  };

  // Applica `mutate` ai caratteri selezionati; senza selezione a tutto il testo (comandi dalla barra).
  const restyle = (
    mutate: (selected: StyledChar[]) => void,
    { wholeIfCollapsed }: { wholeIfCollapsed: boolean }
  ) => {
    const el = ref.current;
    if (!el) return;
    const chars = getStyledChars(el);
    if (chars.length === 0) return;
    const offsets = getSelectionOffsets(el);
    let start = Math.max(0, Math.min(offsets?.start ?? 0, chars.length));
    let end = Math.max(0, Math.min(offsets?.end ?? 0, chars.length));
    const collapsed = start >= end;
    if (collapsed && !wholeIfCollapsed) return;
    if (collapsed) {
      start = 0;
      end = chars.length;
    }

    mutate(chars.slice(start, end));

    const runs = charsToRuns(chars);
    renderRunsToElement(el, runs);
    if (collapsed && offsets) setSelectionOffsets(el, offsets.start, offsets.end);
    else setSelectionOffsets(el, start, end);
    fit();
  };

  const toggleStyle = (styleKey: InlineToggleStyle, wholeIfCollapsed = false) =>
    restyle(
      (selected) => {
        const nextVal = !selected.every((c) => Boolean(c.style[styleKey]));
        for (const c of selected) c.style[styleKey] = nextVal;
      },
      { wholeIfCollapsed }
    );

  useEffect(
    () =>
      registerInlineEditor({
        toggleStyle: (style) => toggleStyle(style, true),
        setColor: (color) =>
          restyle(
            (selected) => {
              for (const c of selected) {
                if (color) c.style.color = color;
                else delete c.style.color;
              }
            },
            { wholeIfCollapsed: true }
          ),
        setFontSize: (px) =>
          restyle(
            (selected) => {
              for (const c of selected) {
                if (px) c.style.fontSizePx = px;
                else delete c.style.fontSizePx;
              }
            },
            { wholeIfCollapsed: true }
          ),
        stepFontSize: (delta, basePx) =>
          restyle(
            (selected) => {
              for (const c of selected) c.style.fontSizePx = clampFontSizePx((c.style.fontSizePx ?? basePx) + delta);
            },
            { wholeIfCollapsed: true }
          ),
      }),
    // Le funzioni leggono solo il DOM tramite `ref`: basta registrarle una volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleShiftEnter = () => {
    const el = ref.current;
    if (!el) return;
    const offsets = getSelectionOffsets(el);
    if (!offsets) return;

    const chars = getStyledChars(el);
    const start = Math.max(0, Math.min(offsets.start, chars.length));
    const end = Math.max(0, Math.min(offsets.end, chars.length));

    const insertStyle =
      start > 0 && start <= chars.length
        ? { ...chars[start - 1].style }
        : start < chars.length
        ? { ...chars[start].style }
        : {};

    const newChars = [
      ...chars.slice(0, start),
      { char: '\n', style: insertStyle },
      ...chars.slice(end),
    ];

    const runs = charsToRuns(newChars);
    renderRunsToElement(el, runs);
    setSelectionOffsets(el, start + 1, start + 1);
    fit();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    // Gli appunti di Windows usano CRLF: nel titolo resta solo `\n`.
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!text) return;

    const el = ref.current;
    if (!el) return;

    const offsets = getSelectionOffsets(el);
    if (!offsets) return;

    const chars = getStyledChars(el);
    const start = Math.max(0, Math.min(offsets.start, chars.length));
    const end = Math.max(0, Math.min(offsets.end, chars.length));

    const insertStyle =
      start > 0 && start <= chars.length
        ? { ...chars[start - 1].style }
        : start < chars.length
        ? { ...chars[start].style }
        : {};

    const insertedChars: StyledChar[] = [];
    for (let i = 0; i < text.length; i++) {
      insertedChars.push({ char: text[i], style: { ...insertStyle } });
    }

    const newChars = [
      ...chars.slice(0, start),
      ...insertedChars,
      ...chars.slice(end),
    ];

    const runs = charsToRuns(newChars);
    renderRunsToElement(el, runs);
    setSelectionOffsets(el, start + text.length, start + text.length);
    fit();
  };

  return (
    <div
      ref={ref}
      contentEditable
      role="textbox"
      aria-multiline="true"
      aria-label="Titolo del blocco"
      spellCheck={false}
      suppressContentEditableWarning
      className={cn(
        'absolute cursor-text overflow-hidden rounded-[10px] border border-primary bg-card px-2.5 py-1 leading-snug text-foreground shadow-composer outline-hidden ring-[3px] ring-primary/25 whitespace-pre-wrap wrap-break-word',
        isRoot ? 'font-semibold tracking-tight' : 'font-medium'
      )}
      style={{ left: x, top: y, width: Math.max(w, 120), minHeight: h, fontSize: `${fontPx}px` }}
      onInput={fit}
      onPaste={handlePaste}
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        // Ctrl/Cmd+S (e Maiusc per «Salva con nome») passa all'app: il suo salvataggio toglie il
        // focus all'editor, il blur conferma il testo e poi si salva. Qui non si fa altro.
        if (
          (e.ctrlKey || e.metaKey) &&
          !e.altKey &&
          e.key.toLowerCase() === 's' &&
          !e.nativeEvent.isComposing
        ) {
          return;
        }
        e.stopPropagation();
        // Safari conferma la composizione IME con un keydown di Invio con `isComposing` falso
        // ma keyCode 229: senza questo controllo chiuderebbe l'editor a metà parola.
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;
        if (isCtrlOrMeta && !e.altKey && !e.shiftKey) {
          const key = e.key.toLowerCase();
          if (key === 'b') {
            e.preventDefault();
            toggleStyle('bold');
            return;
          }
          if (key === 'i') {
            e.preventDefault();
            toggleStyle('italic');
            return;
          }
          if (key === 'u') {
            e.preventDefault();
            toggleStyle('underline');
            return;
          }
        }
        if (e.key === 'Enter') {
          if (e.shiftKey) {
            e.preventDefault();
            handleShiftEnter();
          } else {
            e.preventDefault();
            finish('enter');
          }
        } else if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          finish('tab');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
    />
  );
};
