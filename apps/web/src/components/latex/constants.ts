// L'inchiostro è un dato salvato nel PNG dell'equazione (compatibilità XMind), non stile.
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
