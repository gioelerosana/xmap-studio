/**
 * Marchio di XMap Studio: un nodo centrale con tre rami terminati da un punto,
 * bianco su inchiostro. Usato nella schermata di benvenuto e nel dialog
 * Informazioni. I colori vengono dai token `--map-root` e
 * `--map-root-foreground`, così il marchio cambia con il tema senza varianti.
 */
import React from 'react';
import { cn } from '@xmap/ui-kit';

export interface AppMarkProps {
  size?: number;
  className?: string;
}

const ink = { stroke: 'var(--map-root-foreground)', fill: 'none' } as const;
const inkDot = { fill: 'var(--map-root-foreground)' } as const;

export const AppMark: React.FC<AppMarkProps> = ({ size = 40, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    aria-hidden="true"
    className={cn('shrink-0', className)}
  >
    <rect width="40" height="40" rx="8.8" style={{ fill: 'var(--map-root)' }} />
    <g strokeWidth="1.75" strokeLinecap="round" style={ink}>
      <circle cx="20" cy="18" r="3.2" />
      <path d="M17.38 16.16Q13.8 15.2 11.8 12.26" />
      <path d="M22.62 16.16Q26.2 15.2 28.2 12.26" />
      <path d="M20 21.2Q21.2 24.6 20 28" />
    </g>
    <circle cx="11.8" cy="12.26" r="1.8" style={inkDot} />
    <circle cx="28.2" cy="12.26" r="1.8" style={inkDot} />
    <circle cx="20" cy="28" r="1.8" style={inkDot} />
  </svg>
);
