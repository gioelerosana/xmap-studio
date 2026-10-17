/**
 * Marchio di XMap Studio: la mappa come la disegna l'app, con il titolo in
 * alto, un tronco dritto che scende dal suo centro e tre argomenti principali
 * a destra. Segue il design system T3: quadrato nero, segno bianco e un solo
 * dettaglio nel blu `primary` (l'argomento centrale). Il marchio ha colori
 * fissi e non segue il tema: resta lo stesso in chiaro e in scuro, come
 * l'icona installata. Il disegno coincide con `apps/web/public/icon.svg`.
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
    <path
      d="M80 76V200M80 112H116M80 156H116M80 200H116"
      fill="none"
      stroke="#ffffff"
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect x="36" y="40" width="88" height="36" rx="18" fill="#ffffff" />
    <rect x="114" y="98" width="104" height="28" rx="14" fill="#ffffff" />
    <rect x="114" y="142" width="84" height="28" rx="14" fill="#346bf1" />
    <rect x="114" y="186" width="96" height="28" rx="14" fill="#ffffff" />
  </svg>
);
