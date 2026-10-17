/**
 * Marchio di XMap Studio: un piccolo albero di blocchi, come la lista
 * dell'app. Il blocco radice chiaro in alto e due figli collegati da un ramo
 * ad angolo; il figlio selezionato è l'unico dettaglio nel blu primary.
 * Il marchio ha colori fissi di brand (sfondo quasi nero) e non segue il
 * tema: resta lo stesso in chiaro e in scuro, come l'icona installata.
 * Il disegno coincide con `apps/web/public/icon.svg`.
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
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a2e" />
          <stop offset="1" stopColor="#0c0c0e" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${gradientId})`} />
      <g
        fill="none"
        stroke="#55555c"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M80 98V165C80 173 84 177 92 177H110" />
        <path d="M80 131H110" />
      </g>
      <rect x="50" y="58" width="122" height="40" rx="12" fill="#fafafa" />
      <rect x="66" y="72" width="60" height="12" rx="6" fill="#18181b" />
      <rect x="110" y="112" width="100" height="38" rx="12" fill="#3b6cf6" />
      <rect x="125" y="125" width="48" height="12" rx="6" fill="#ffffff" />
      <rect x="110" y="158" width="100" height="38" rx="12" fill="#3a3a40" />
      <rect x="125" y="171" width="60" height="12" rx="6" fill="#a1a1aa" />
    </svg>
  );
};
