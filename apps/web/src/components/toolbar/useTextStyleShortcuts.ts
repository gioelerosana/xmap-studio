import { useEffect, useRef } from 'react';
import type { TopicView } from '@xmap/core';

import type { TopicActions, TextStylePatch } from '../../app/useTopicActions.js';
import { TEXT_FIELD } from '../../app/constants.js';
import { titleBaseFontPx } from '@xmap/core';
import { activeInlineEditor, clampFontSizePx, type InlineToggleStyle } from '../map/editorBridge.js';

const PATCH_FOR_STYLE: Record<InlineToggleStyle, (value: boolean) => TextStylePatch> = {
  bold: (bold) => ({ bold }),
  italic: (italic) => ({ italic }),
  underline: (underline) => ({ underline }),
  strikethrough: (strikethrough) => ({ strikethrough }),
};

interface StyleTarget {
  topic: TopicView | null;
  isEditingText: boolean;
  actions: TopicActions;
}

/**
 * Attiva/disattiva uno stile: sulla selezione dell'editor in place se un titolo è in modifica,
 * altrimenti sull'intero blocco di testo selezionato.
 */
export function toggleTextStyle({ topic, isEditingText, actions }: StyleTarget, style: InlineToggleStyle) {
  if (isEditingText) {
    activeInlineEditor()?.toggleStyle(style);
    return;
  }
  if (!topic || topic.kind !== 'text') return;
  actions.setTextStyle(topic.id, PATCH_FOR_STYLE[style](!topic.textStyle?.[style]));
}

/** Colore del testo (`null` = predefinito del tema), con le stesse regole di `toggleTextStyle`. */
export function setTextColor({ topic, isEditingText, actions }: StyleTarget, color: string | null) {
  if (isEditingText) {
    activeInlineEditor()?.setColor(color);
    return;
  }
  if (!topic || topic.kind !== 'text') return;
  actions.setTextStyle(topic.id, { color });
}

/** Dimensione del testo in px (`null` = predefinita del blocco), con le stesse regole di `toggleTextStyle`. */
export function setTextFontSize({ topic, isEditingText, actions }: StyleTarget, px: number | null) {
  const size = px === null ? null : clampFontSizePx(px);
  if (isEditingText) {
    activeInlineEditor()?.setFontSize(size);
    return;
  }
  if (!topic || topic.kind !== 'text') return;
  actions.setTextStyle(topic.id, { fontSizePx: size });
}

/** Ingrandisce o rimpicciolisce il testo di `delta` px rispetto alla dimensione attuale. */
export function stepTextFontSize({ topic, isEditingText, actions }: StyleTarget, delta: number) {
  if (!topic || topic.kind !== 'text') return;
  const current = titleBaseFontPx(topic.depth, topic.textStyle);
  if (isEditingText) {
    activeInlineEditor()?.stepFontSize(delta, current);
    return;
  }
  actions.setTextStyle(topic.id, { fontSizePx: clampFontSizePx(current + delta) });
}

const SHORTCUT_STYLES: Record<string, InlineToggleStyle> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
};

/**
 * Ctrl/Cmd+B, I, U sul blocco di testo selezionato quando non si sta scrivendo in place
 * (l'editor in place le gestisce da sé). Si ignorano campi di testo, finestre aperte e Alt/Maiusc.
 */
export function useTextStyleShortcuts(target: StyleTarget) {
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const style = SHORTCUT_STYLES[e.key.toLowerCase()];
      if (!style) return;
      const { topic, isEditingText } = targetRef.current;
      if (isEditingText || !topic || topic.kind !== 'text') return;
      const source = e.target instanceof Element ? e.target : document.activeElement;
      if (source?.closest(TEXT_FIELD)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      toggleTextStyle(targetRef.current, style);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
