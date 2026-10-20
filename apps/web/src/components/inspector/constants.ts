import type { RelationshipShape } from '@xmap/core';

// I valori di colore sono dati salvati nel file XMind (compatibilità col formato), non stile.
export const BRANCH_COLORS = ['#E65D5D', '#E9863F', '#C99A12', '#79A83B', '#1599B5', '#7953A9', '#4E5D6C'];
export const INK_COLORS = ['#000000', '#ffffff', '#3b6cf6', '#e5484d', '#2f9e63', '#7953a9'];
export const TEMPLATES = [
  { label: 'Frazione', latex: '\\frac{a}{b}' },
  { label: 'Integrale', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: 'Sommatoria', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Radice', latex: '\\sqrt{x^2+y^2}' },
  { label: 'Limite', latex: '\\lim_{x\\to\\infty}\\frac{1}{x}=0' },
  { label: 'Matrice', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
];
export const TITLE_MODE_ITEMS: { id: 'formula_only' | 'keep_title' | 'custom'; label: string }[] = [
  { id: 'formula_only', label: 'Solo formula' },
  { id: 'keep_title', label: 'Mantieni' },
  { id: 'custom', label: 'Custom' },
];
export const RELATIONSHIP_SHAPES: { id: RelationshipShape; label: string }[] = [
  { id: 'curved', label: 'Curva' },
  { id: 'straight', label: 'Dritta' },
  { id: 'angled', label: 'Ad angolo' },
  { id: 'zigzag', label: 'Zig-zag' },
];
