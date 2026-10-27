/**
 * Font del tema come prima scelta, poi il font della mappa: se il font del
 * tema non è installato il browser ricade sul secondo, e la misura del testo
 * (`textMeasure.ts`) usa la stessa lista, così blocco e testo combaciano.
 */
export function themeFontStack(family: string | undefined, fallback: string): string {
  if (!family) return fallback;
  return `"${family.replace(/["\\]/g, '')}", ${fallback}`;
}
