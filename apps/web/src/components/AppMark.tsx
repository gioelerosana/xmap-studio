/**
 * Marchio di XMap Studio: un nodo centrale da cui partono rami curvi verso
 * tre nodi, uno dei quali contiene un Σ tracciato con path (niente font, così
 * il disegno è identico ovunque). Il Σ è l'unico dettaglio color ambra.
 * Il marchio ha colori fissi di brand (sfondo indaco, inchiostro bianco) e
 * non segue il tema: resta lo stesso in chiaro e in scuro, come l'icona
 * installata. Il disegno coincide con `apps/web/public/icon.svg`.
 */
import React, { useId } from 'react';
import { cn } from '@xmap/ui-kit';

export interface AppMarkProps {
  size?: number;
  className?: string;
}

export const AppMark: React.FC<AppMarkProps> = ({ size = 40, className }) => {
  const gradientId = `app-mark-bg-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#312e81" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${gradientId})`} />
      <g transform="translate(-4 -2)">
        <g fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round">
          <path d="M120 128C100 104 80 86 58 64" />
          <path d="M120 128C150 118 172 102 194 74" />
          <path d="M120 128C112 152 96 176 74 198" />
        </g>
        <circle cx="120" cy="128" r="26" fill="#ffffff" />
        <circle cx="58" cy="64" r="13" fill="#ffffff" />
        <circle cx="74" cy="198" r="13" fill="#ffffff" />
        <circle cx="198" cy="70" r="24" fill="#1e293b" stroke="#ffffff" strokeWidth="8" />
        <path
          d="M206 59.5H190L199 70L190 80.5H206"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};
