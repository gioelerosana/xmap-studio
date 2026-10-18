/**
 * Impaginazione della mappa su fogli di carta (stampa / PDF).
 *
 * Logica pura: riceve il riquadro della mappa in coordinate del mondo (px CSS,
 * 96 dpi) e restituisce scala, orientamento e l'elenco delle pagine, ognuna
 * con il ritaglio del mondo che deve mostrare. La UI disegna ogni pagina come
 * un `<svg viewBox>` sul ritaglio.
 */

/** Millimetri → px CSS (96 dpi). */
export const MM_TO_PX = 96 / 25.4;

export type PaperSize = 'A4' | 'A3';

/** Dimensioni in mm, orientamento verticale. */
export const PAPER_SIZES_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

export type PrintOrientation = 'portrait' | 'landscape' | 'auto';

/**
 * - `fit-page`: tutta la mappa su un solo foglio (scala ≤ `maxScale`);
 * - `fit-width`: la mappa occupa `pagesWide` fogli in larghezza, le righe
 *   seguono dall'altezza;
 * - `scale`: scala fissa (`scale`, 1 = 100 %), quanti fogli servono.
 */
export type PrintFit =
  | { mode: 'fit-page' }
  | { mode: 'fit-width'; pagesWide: number }
  | { mode: 'scale'; scale: number };

export interface PrintOptions {
  paper: PaperSize;
  orientation: PrintOrientation;
  fit: PrintFit;
  /** Margine su ogni lato, in mm. */
  marginMm: number;
  /**
   * Sovrapposizione tra pagine adiacenti, in mm (per incollare i fogli); 0 =
   * nessuna. Non si applica con una sola pagina.
   */
  overlapMm: number;
  /** Tetto alla scala in `fit-page` / `fit-width`, per non ingigantire mappe piccole. Default 1.5. */
  maxScale?: number;
}

/** Riquadro in coordinate del mondo (px). */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintPage {
  /** Indice 0-based in ordine di lettura (riga per riga). */
  index: number;
  row: number;
  col: number;
  /** Porzione del mondo mostrata nell'area utile della pagina. */
  world: WorldRect;
}

export interface PrintPlan {
  paper: PaperSize;
  /** Orientamento effettivo (mai `auto`). */
  orientation: 'portrait' | 'landscape';
  /** Dimensioni del foglio in mm nell'orientamento effettivo. */
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  /** Area utile (foglio meno margini) in px CSS. */
  contentWidthPx: number;
  contentHeightPx: number;
  /** px CSS su carta per 1 px del mondo. */
  scale: number;
  rows: number;
  cols: number;
  pages: PrintPage[];
}

/**
 * Calcola l'impaginazione di `bounds` secondo `opts`.
 *
 * Regole:
 * - `bounds` vuoto o degenere (w/h ≤ 0, non finiti) → errore con messaggio in italiano;
 * - con `orientation: 'auto'` prova entrambi e sceglie quello con meno pagine,
 *   a parità quello con scala maggiore, a parità ancora `portrait`;
 * - margini/overlap negativi o che lasciano un'area utile ≤ 0 → errore;
 * - la mappa è centrata nell'area complessiva delle pagine (lo spazio avanzato
 *   è distribuito ugualmente ai due lati), quindi l'ultima riga/colonna non è
 *   mai vuota;
 * - con overlap > 0 ogni pagina dopo la prima arretra di `overlapMm` (convertito
 *   in px del mondo) rispetto alla precedente.
 */
export function paginate(bounds: WorldRect, opts: PrintOptions): PrintPlan {
  void bounds;
  void opts;
  throw new Error('paginate: non ancora implementato');
}
