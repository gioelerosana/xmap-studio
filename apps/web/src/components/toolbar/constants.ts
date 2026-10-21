import type { RelationshipShape } from '@xmap/core';

// I valori di colore sono dati salvati nel file XMind (compatibilità col formato), non stile.
export const BRANCH_COLORS = ['#E65D5D', '#E9863F', '#C99A12', '#79A83B', '#1599B5', '#7953A9', '#4E5D6C'];
export const RELATIONSHIP_SHAPES: { id: RelationshipShape; label: string }[] = [
  { id: 'curved', label: 'Curva' },
  { id: 'straight', label: 'Dritta' },
  { id: 'angled', label: 'Ad angolo' },
  { id: 'zigzag', label: 'Zig-zag' },
];
