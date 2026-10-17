import React, { useLayoutEffect, useRef } from 'react';
import { cn } from '@xmap/ui-kit';

export type EditExit = 'enter' | 'tab' | 'blur';

export interface NodeEditorProps {
  /** Posizione e misura del blocco in coordinate mondo (il contenitore applica pan/zoom). */
  x: number;
  y: number;
  w: number;
  h: number;
  isRoot: boolean;
  initialText: string;
  /** Seleziona tutto il testo all'apertura; altrimenti il cursore va in fondo. */
  selectAll: boolean;
  onCommit: (text: string, exit: EditExit) => void;
  onCancel: () => void;
}

/** Editor in place del titolo di un blocco: Invio conferma, Maiusc+Invio va a capo, Tab conferma, Esc annulla. */
export const NodeEditor: React.FC<NodeEditorProps> = ({
  x,
  y,
  w,
  h,
  isRoot,
  initialText,
  selectAll,
  onCommit,
  onCancel,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, h)}px`;
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    fit();
    // Solo all'apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (exit: EditExit) => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current?.value ?? initialText, exit);
  };

  return (
    <textarea
      ref={ref}
      defaultValue={initialText}
      rows={1}
      spellCheck={false}
      aria-label="Titolo del blocco"
      className={cn(
        'absolute resize-none overflow-hidden rounded-[10px] border border-primary bg-card px-2.5 py-1 leading-snug text-foreground shadow-composer outline-none ring-[3px] ring-primary/25',
        isRoot ? 'text-sm font-semibold tracking-tight' : 'text-xs font-medium'
      )}
      style={{ left: x, top: y, width: Math.max(w, 120), minHeight: h }}
      onInput={fit}
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish('enter');
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
