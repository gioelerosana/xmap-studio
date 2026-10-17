/**
 * Marchio di XMap Studio: una X fatta di mappa. Un blocco radice al centro e
 * quattro argomenti agli angoli, collegati da rami curvi come nella vista
 * mappa; l'argomento in alto a destra è l'unico dettaglio color ambra.
 * Il marchio ha colori fissi di brand (sfondo blu, inchiostro bianco) e non
 * segue il tema: resta lo stesso in chiaro e in scuro, come l'icona
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
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5383ff" />
          <stop offset="1" stopColor="#2440d8" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${gradientId})`} />
      <g fill="none" stroke="#ffffff" strokeWidth="12" strokeLinecap="round">
        <path d="M100 128C76 128 82 76 58 76" />
        <path d="M100 128C76 128 82 180 58 180" />
        <path d="M156 128C180 128 174 76 198 76" />
        <path d="M156 128C180 128 174 180 198 180" />
      </g>
      <rect x="90" y="104" width="76" height="48" rx="15" fill="#ffffff" />
      <rect x="34" y="60" width="44" height="32" rx="11" fill="#ffffff" />
      <rect x="34" y="164" width="44" height="32" rx="11" fill="#ffffff" />
      <rect x="178" y="164" width="44" height="32" rx="11" fill="#ffffff" />
      <rect x="178" y="60" width="44" height="32" rx="11" fill="#fbbf24" />
    </svg>
  );
};
