import React from 'react';
import type { TextStyle, TitleRun } from '@xmap/core';

/** Stile CSS di un `TextStyle`; il colore del tema vince solo se il file non ne indica uno. */
export function textStyleCss(style?: TextStyle): React.CSSProperties {
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
    color: style.color,
  };
}

interface RichTitleProps {
  text: string;
  runs?: TitleRun[];
}

/**
 * Titolo di un blocco: testo semplice o frammenti con stile proprio
 * (`attributedTitle`). Lo stile del blocco intero lo applica il contenitore.
 */
export const RichTitle: React.FC<RichTitleProps> = ({ text, runs }) => {
  if (!runs || runs.length === 0) return <>{text}</>;
  return (
    <>
      {runs.map((run, i) => (
        <span key={i} style={textStyleCss(run)}>
          {run.text}
        </span>
      ))}
    </>
  );
};
