import React, { useEffect, useState } from 'react';
import {
  inlineMathFontSize,
  splitInlineMath,
  renderLatexToSvg,
  type TextStyle,
  type TitleRun,
} from '@xmap/core';

/** Cache per le formule matematiche renderizzate per non ricalcolare MathJax */
const inlineSvgCache = new Map<string, { svg: string; error: string | null }>();
/** Limite della cache: una sessione lunga di editing di formule non deve farla crescere senza fine. */
const INLINE_SVG_CACHE_MAX = 2000;

function rememberInlineSvg(key: string, entry: { svg: string; error: string | null }): void {
  if (inlineSvgCache.size >= INLINE_SVG_CACHE_MAX) inlineSvgCache.clear();
  inlineSvgCache.set(key, entry);
}

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
    fontSize: style.fontSizePx === undefined ? undefined : `${style.fontSizePx}px`,
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

interface InlineMathProps {
  math: string;
  display?: boolean;
  fontSizePx?: number;
}

const mathCacheKey = ({ math, display, fontSizePx = 13 }: InlineMathProps) =>
  `${math}::${fontSizePx}::${display ? 'd' : 'i'}`;

/**
 * Rende una singola formula MathJax in linea o display.
 * Il rendering è memoizzato e asincrono se non già presente in cache.
 * Il `key` rimonta il componente a ogni cambio di formula: lo stato `rendered`
 * nasce da `math`, senza il rimontaggio dopo una modifica resterebbe la formula vecchia.
 */
const InlineMath: React.FC<InlineMathProps> = (props) => (
  <InlineMathView key={mathCacheKey(props)} {...props} />
);

const InlineMathView: React.FC<InlineMathProps> = ({ math, display, fontSizePx = 13 }) => {
  const cacheKey = mathCacheKey({ math, display, fontSizePx });

  const [rendered, setRendered] = useState<{ svg: string; error: string | null } | null>(() => {
    const cached = inlineSvgCache.get(cacheKey);
    if (cached) return cached;
    try {
      // Se già presente nella cache sincrona del core (es. calcolata in EstimatedMetrics)
      const res = renderLatexToSvg(math, fontSizePx, display ?? false);
      const entry = { svg: res.svg, error: res.error };
      rememberInlineSvg(cacheKey, entry);
      return entry;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (rendered) return;

    let active = true;
    const timer = setTimeout(() => {
      try {
        const res = renderLatexToSvg(math, fontSizePx, display ?? false);
        const entry = { svg: res.svg, error: res.error };
        rememberInlineSvg(cacheKey, entry);
        if (active) setRendered(entry);
      } catch (err: any) {
        const entry = { svg: '', error: err?.message || 'Errore LaTeX' };
        rememberInlineSvg(cacheKey, entry);
        if (active) setRendered(entry);
      }
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cacheKey, math, display, fontSizePx, rendered]);

  const rawSource = display ? `$$${math}$$` : `$${math}$`;

  if (!rendered) {
    return <span className="opacity-60 text-[0.9em] font-mono">{rawSource}</span>;
  }

  if (rendered.error) {
    return (
      <span
        className="text-red-500/80 dark:text-red-400/80 text-[0.85em] font-mono inline-block"
        title={`Errore formula LaTeX: ${rendered.error}`}
      >
        {rawSource}
      </span>
    );
  }

  if (display) {
    return (
      <span
        className="block my-0.5 text-center max-w-full overflow-hidden"
        style={{ color: 'currentColor' }}
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
    );
  }

  return (
    <span
      className="inline align-baseline max-w-full [&>svg]:inline"
      style={{ color: 'currentColor' }}
      dangerouslySetInnerHTML={{ __html: rendered.svg }}
    />
  );
};

/** Dimensione base del testo del titolo quando il chiamante non la indica. */
const DEFAULT_TITLE_FONT_PX = 12;

interface RichTitleProps {
  text: string;
  runs?: TitleRun[];
  textLight?: boolean;
  /** Dimensione del testo base del blocco (14 radice, 12 gli altri, salvo `textStyle`). */
  fontSizePx?: number;
}

/**
 * Titolo di un blocco: testo semplice, frammenti con stile (`runs`),
 * e formule matematiche inline ($...$) e display ($$...$$).
 * Le formule usano `inlineMathFontSize`, la stessa scala che usa la stima del layout.
 */
export const RichTitle: React.FC<RichTitleProps> = ({
  text,
  runs,
  textLight,
  fontSizePx = DEFAULT_TITLE_FONT_PX,
}) => {
  if (!runs || runs.length === 0) {
    const segments = splitInlineMath(text);
    if (segments.length === 0) return null;
    if (segments.length === 1 && segments[0].kind === 'text') {
      return <>{segments[0].value}</>;
    }
    return (
      <>
        {segments.map((seg, i) =>
          seg.kind === 'text' ? (
            <React.Fragment key={i}>{seg.value}</React.Fragment>
          ) : (
            <InlineMath
              key={i}
              math={seg.value}
              display={seg.display}
              fontSizePx={inlineMathFontSize(fontSizePx)}
            />
          )
        )}
      </>
    );
  }

  return (
    <>
      {runs.map((run, i) => {
        const style = textStyleCss(run, textLight);
        const segments = splitInlineMath(run.text);
        if (segments.length === 1 && segments[0].kind === 'text') {
          return (
            <span key={i} style={style}>
              {segments[0].value}
            </span>
          );
        }
        return (
          <span key={i} style={style}>
            {segments.map((seg, j) =>
              seg.kind === 'text' ? (
                <React.Fragment key={j}>{seg.value}</React.Fragment>
              ) : (
                <InlineMath
                  key={j}
                  math={seg.value}
                  display={seg.display}
                  fontSizePx={inlineMathFontSize(run.fontSizePx ?? fontSizePx)}
                />
              )
            )}
          </span>
        );
      })}
    </>
  );
};
