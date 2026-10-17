import React from 'react';
import type { TextStyle, TitleRun } from '@xmap/core';

/** Luminanza relativa di un colore `#rgb`/`#rrggbb[aa]`; `null` se non è esadecimale. */
export function hexLuminance(color: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Il colore del file è pensato per il tema chiaro di XMind: su un blocco con
 * testo chiaro un verde scuro diventerebbe invisibile (e viceversa). In quel
 * caso si tiene il colore del testo del blocco.
 */
function readableColor(color: string | undefined, textLight?: boolean): string | undefined {
  if (!color || textLight === undefined) return color;
  const lum = hexLuminance(color);
  if (lum === null) return color;
  return (textLight ? lum < 0.2 : lum > 0.6) ? undefined : color;
}

/**
 * Stile CSS di un `TextStyle`; il colore del tema vince solo se il file non ne
 * indica uno leggibile. `textLight` = il blocco ha testo chiaro.
 */
export function textStyleCss(style?: TextStyle, textLight?: boolean): React.CSSProperties {
  if (!style) return {};
  const decorations = [style.underline && 'underline', style.strikethrough && 'line-through'].filter(
    Boolean
  );
  return {
    fontWeight: style.bold === undefined ? undefined : style.bold ? 700 : 400,
    fontStyle: style.italic === undefined ? undefined : style.italic ? 'italic' : 'normal',
    textDecoration:
      style.underline === undefined && style.strikethrough === undefined
        ? undefined
        : decorations.length > 0
        ? decorations.join(' ')
        : 'none',
    color: readableColor(style.color, textLight),
  };
}

interface RichTitleProps {
  text: string;
  runs?: TitleRun[];
  textLight?: boolean;
}

/**
 * Titolo di un blocco: testo semplice o frammenti con stile proprio
 * (`attributedTitle`). Lo stile del blocco intero lo applica il contenitore.
 */
export const RichTitle: React.FC<RichTitleProps> = ({ text, runs, textLight }) => {
  if (!runs || runs.length === 0) return <>{text}</>;
  return (
    <>
      {runs.map((run, i) => (
        <span key={i} style={textStyleCss(run, textLight)}>
          {run.text}
        </span>
      ))}
    </>
  );
};
