/**
 * Marchio di XMap Studio: un blocco padre in alto da cui scendono tre rami
 * curvi verso tre blocchi figli, come la mappa nell'app. Segue il design
 * system T3: quadrato nero, segno bianco e un solo dettaglio nel blu
 * `primary` (il figlio centrale). Il marchio ha colori fissi e non segue il
 * tema: resta lo stesso in chiaro e in scuro, come l'icona installata. Il
 * disegno coincide con `apps/web/public/icon.svg`.
 */
import React from 'react';
import { cn } from '@xmap/ui-kit';

export interface AppMarkProps {
  size?: number;
  className?: string;
}

export const AppMark: React.FC<AppMarkProps> = ({ size = 40, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 256 256"
    aria-hidden="true"
    className={cn('shrink-0', className)}
  >
    <rect width="256" height="256" rx="56" fill="#0a0a0a" />
    <g fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round">
      <path d="M128 100C128 132 62 124 62 158" />
      <path d="M128 100V158" />
      <path d="M128 100C128 132 194 124 194 158" />
    </g>
    <rect x="82" y="56" width="92" height="48" rx="24" fill="#ffffff" />
    <rect x="36" y="156" width="52" height="30" rx="15" fill="#ffffff" />
    <rect x="100" y="152" width="56" height="38" rx="19" fill="#346bf1" />
    <rect x="168" y="156" width="52" height="30" rx="15" fill="#ffffff" />
  </svg>
);
