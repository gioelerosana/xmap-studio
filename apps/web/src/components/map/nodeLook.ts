import type { LayoutNode } from '@xmap/core';
import { hexLuminance } from './RichTitle.js';

// MathJax produce SVG con colore letterale, non una variabile CSS: i valori
// replicano il token foreground nei due temi e i testi su riempimento pieno.
export const FORMULA_COLOR = { dark: '#f5f5f5', light: '#2b2b30' };
export const TEXT_ON_DARK = '#ffffff';
export const TEXT_ON_LIGHT = '#1f1f24';

export interface NodeLook {
  fill: string;
  stroke: string;
  text: string;
  /** Testo chiaro: formule bianche, PNG di equazione invertiti, chip schiariti. */
  textLight: boolean;
  /** Riempimento pieno (radice, rami principali, fill esplicito): niente bordo hairline. */
  solid: boolean;
}

// Stile XMind: topic centrale pieno, rami principali pieni del colore del ramo,
// sotto-blocchi tinti dello stesso colore così le sezioni si leggono a colpo d'occhio.
export function nodeLook(node: LayoutNode, darkMode: boolean): NodeLook {
  const solidOn = (color: string): NodeLook => {
    // Il colore del testo del tema vale solo sul riempimento pieno, dove il tema ne ha scelto il contrasto.
    if (node.themeTextColor) {
      const textLum = hexLuminance(node.themeTextColor);
      return { fill: color, stroke: color, text: node.themeTextColor, textLight: textLum !== null && textLum >= 0.5, solid: true };
    }
    const lum = hexLuminance(color);
    const textLight = lum === null || lum < 0.45;
    return { fill: color, stroke: color, text: textLight ? TEXT_ON_DARK : TEXT_ON_LIGHT, textLight, solid: true };
  };
  // Forma sottolineata: niente riquadro, solo la linea del ramo sotto il testo.
  if (node.shape === 'underline') {
    return {
      fill: 'transparent',
      stroke: node.fill || node.accent || 'var(--map-link)',
      text: 'var(--foreground)',
      textLight: darkMode,
      solid: false,
    };
  }
  if (node.fill) return solidOn(node.fill);
  if (node.depth === 0) {
    return {
      fill: 'var(--map-central)',
      stroke: 'var(--map-central)',
      text: 'var(--map-central-foreground)',
      textLight: true,
      solid: true,
    };
  }
  if (node.depth === 1 && node.accent) return solidOn(node.accent);
  if (node.accent) {
    return {
      fill: `color-mix(in oklab, ${node.accent} var(--map-tint), var(--map-canvas))`,
      stroke: `color-mix(in oklab, ${node.accent} 45%, transparent)`,
      text: 'var(--foreground)',
      textLight: darkMode,
      solid: false,
    };
  }
  return { fill: 'var(--card)', stroke: 'var(--border)', text: 'var(--foreground)', textLight: darkMode, solid: false };
}
