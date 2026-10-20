import { cn } from '@xmap/ui-kit';

// Anello di focus dei bottoni ui-kit, riusato dai controlli che non sono `Button`.
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

export const chipClass = (active: boolean) =>
  cn(
    'rounded-sm border px-1.5 py-0.5 text-2xs transition-colors',
    FOCUS_RING,
    active
      ? 'border-primary bg-primary/8 text-primary dark:bg-primary/16'
      : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  );

// Il bordo hairline tiene visibili bianco e nero in entrambi i temi; il selezionato usa l'anello primario.
export const swatchHairline = 'ring-1 ring-inset ring-foreground/10';
export const swatchSelected = 'ring-2 ring-primary ring-offset-2 ring-offset-background';
