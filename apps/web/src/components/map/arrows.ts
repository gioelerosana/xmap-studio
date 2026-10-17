import type { ArrowShape } from '@xmap/core';

/**
 * Punta di freccia come path riempito. `(x, y)` è la punta (l'estremità della
 * linea), `angle` la direzione in radianti verso cui punta (tangente uscente).
 * Dimensioni proporzionali allo spessore, con un minimo leggibile.
 */
export function arrowPath(shape: ArrowShape, x: number, y: number, angle: number, lineWidth: number): string | null {
  if (shape === 'none') return null;
  const s = Math.max(9, lineWidth * 4.5);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Coordinate locali (u lungo la direzione, v perpendicolare) → mondo.
  const pt = (u: number, v: number): string => `${(x + u * cos - v * sin).toFixed(2)} ${(y + u * sin + v * cos).toFixed(2)}`;

  switch (shape) {
    case 'triangle':
    case 'attached':
      return `M ${pt(0, 0)} L ${pt(-s, s * 0.45)} L ${pt(-s, -s * 0.45)} Z`;
    case 'spearhead':
      return `M ${pt(0, 0)} L ${pt(-s, s * 0.5)} L ${pt(-s * 0.65, 0)} L ${pt(-s, -s * 0.5)} Z`;
    case 'square': {
      const h = s * 0.4;
      return `M ${pt(0, h)} L ${pt(-2 * h, h)} L ${pt(-2 * h, -h)} L ${pt(0, -h)} Z`;
    }
    case 'diamond': {
      const h = s * 0.5;
      return `M ${pt(0, 0)} L ${pt(-h, h * 0.7)} L ${pt(-2 * h, 0)} L ${pt(-h, -h * 0.7)} Z`;
    }
    case 'dot': {
      const r = s * 0.35;
      const cx = x - r * cos;
      const cy = y - r * sin;
      return (
        `M ${(cx - r).toFixed(2)} ${cy.toFixed(2)} ` +
        `a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
      );
    }
    default:
      return null;
  }
}

/** Tratteggio SVG scalato sullo spessore. */
export function dashArray(pattern: string, lineWidth: number): string | undefined {
  const w = Math.max(lineWidth, 1);
  switch (pattern) {
    case 'dash':
      return `${4 * w} ${3 * w}`;
    case 'dot':
      return `${w} ${2 * w}`;
    case 'dash-dot':
      return `${4 * w} ${2 * w} ${w} ${2 * w}`;
    default:
      return undefined;
  }
}

/** Luminanza approssimata e alfa di un colore esadecimale; `null` se non è `#RGB[A]`/`#RRGGBB[AA]`. */
function parseHex(color: string): { lum: number; alpha: string } | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, alpha: h.slice(6, 8) };
}

/** Colore effettivo della linea: nel tema scuro i colori molto scuri passano a un grigio chiaro (stessa alfa). */
export function resolveLineColor(color: string | undefined, darkMode: boolean | undefined): string {
  if (!color) return 'var(--muted-foreground)';
  if (darkMode) {
    const p = parseHex(color);
    if (p && p.lum < 0.25) return `#d4d4d8${p.alpha}`;
  }
  return color;
}
