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

/** Tolleranza numerica per prevenire pagine addizionali spurie da arrotondamento float. */
const FLOAT_EPSILON = 1e-6;

/**
 * Calcola il numero di suddivisioni necessarie (colonne o righe) a partire dalla dimensione
 * su carta della mappa, la dimensione utile della pagina e il passo tra pagine adiacenti.
 */
function computePageCount(spanOnPaper: number, contentSpan: number, stepSpan: number): number {
  const excess = spanOnPaper - contentSpan;
  if (excess <= FLOAT_EPSILON) {
    return 1;
  }
  return 1 + Math.max(0, Math.ceil(excess / stepSpan - FLOAT_EPSILON));
}

/**
 * Valida i parametri di input indipendenti dall'orientamento.
 */
function validateInputs(bounds: WorldRect, opts: PrintOptions): void {
  if (
    !bounds ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.w) ||
    !Number.isFinite(bounds.h) ||
    bounds.w <= 0 ||
    bounds.h <= 0
  ) {
    throw new Error(
      'Dimensioni del riquadro della mappa non valide: larghezza e altezza devono essere positive e finite.',
    );
  }

  if (!opts) {
    throw new Error('Opzioni di stampa non specificate.');
  }

  if (!(opts.paper in PAPER_SIZES_MM)) {
    throw new Error(`Formato carta non supportato: ${String(opts.paper)}.`);
  }

  if (!Number.isFinite(opts.marginMm) || opts.marginMm < 0) {
    throw new Error('Il margine non può essere negativo o non finito.');
  }

  if (!Number.isFinite(opts.overlapMm) || opts.overlapMm < 0) {
    throw new Error('La sovrapposizione (overlap) non può essere negativa o non finita.');
  }

  if (opts.maxScale !== undefined && (!Number.isFinite(opts.maxScale) || opts.maxScale <= 0)) {
    throw new Error('Il parametro maxScale deve essere un numero positivo e finito.');
  }

  if (
    opts.orientation !== 'portrait' &&
    opts.orientation !== 'landscape' &&
    opts.orientation !== 'auto'
  ) {
    throw new Error(`Orientamento non valido: ${String(opts.orientation)}.`);
  }

  if (!opts.fit || typeof opts.fit !== 'object') {
    throw new Error('Opzione fit non valida.');
  }

  if (opts.fit.mode === 'fit-page') {
    // Valido
  } else if (opts.fit.mode === 'fit-width') {
    if (!Number.isInteger(opts.fit.pagesWide) || opts.fit.pagesWide < 1) {
      throw new Error(
        'Il parametro pagesWide deve essere un numero intero maggiore o uguale a 1.',
      );
    }
  } else if (opts.fit.mode === 'scale') {
    if (!Number.isFinite(opts.fit.scale) || opts.fit.scale <= 0) {
      throw new Error('La scala deve essere un numero positivo e finito.');
    }
  } else {
    throw new Error(
      `Modalità fit non supportata: ${String((opts.fit as { mode?: unknown }).mode)}.`,
    );
  }
}

/**
 * Calcola il piano di impaginazione per un orientamento specifico ('portrait' | 'landscape').
 */
function buildPlan(
  bounds: WorldRect,
  opts: PrintOptions,
  orientation: 'portrait' | 'landscape',
): PrintPlan {
  const paperDimensions = PAPER_SIZES_MM[opts.paper];
  const pageWidthMm = orientation === 'portrait' ? paperDimensions.w : paperDimensions.h;
  const pageHeightMm = orientation === 'portrait' ? paperDimensions.h : paperDimensions.w;

  const contentWMm = pageWidthMm - 2 * opts.marginMm;
  const contentHMm = pageHeightMm - 2 * opts.marginMm;

  if (contentWMm <= 0 || contentHMm <= 0) {
    throw new Error(
      'I margini superano o eguagliano le dimensioni del foglio: area utile non positiva.',
    );
  }

  const contentWidthPx = contentWMm * MM_TO_PX;
  const contentHeightPx = contentHMm * MM_TO_PX;
  const overlapPx = opts.overlapMm * MM_TO_PX;

  if (overlapPx >= contentWidthPx || overlapPx >= contentHeightPx) {
    throw new Error(
      "La sovrapposizione (overlap) deve essere inferiore all'area utile della pagina.",
    );
  }

  const stepX = contentWidthPx - overlapPx;
  const stepY = contentHeightPx - overlapPx;

  const maxScale = opts.maxScale ?? 1.5;
  let scale: number;
  let cols: number;
  let rows: number;

  if (opts.fit.mode === 'fit-page') {
    scale = Math.min(contentWidthPx / bounds.w, contentHeightPx / bounds.h, maxScale);
    cols = 1;
    rows = 1;
  } else if (opts.fit.mode === 'fit-width') {
    const pagesWide = opts.fit.pagesWide;
    scale = Math.min(
      maxScale,
      (pagesWide * contentWidthPx - (pagesWide - 1) * overlapPx) / bounds.w,
    );
    cols = computePageCount(bounds.w * scale, contentWidthPx, stepX);
    rows = computePageCount(bounds.h * scale, contentHeightPx, stepY);
  } else {
    scale = opts.fit.scale;
    cols = computePageCount(bounds.w * scale, contentWidthPx, stepX);
    rows = computePageCount(bounds.h * scale, contentHeightPx, stepY);
  }

  const totalW = (contentWidthPx + (cols - 1) * stepX) / scale;
  const totalH = (contentHeightPx + (rows - 1) * stepY) / scale;

  const originX = bounds.x - (totalW - bounds.w) / 2;
  const originY = bounds.y - (totalH - bounds.h) / 2;

  const pages: PrintPage[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      pages.push({
        index: row * cols + col,
        row,
        col,
        world: {
          x: originX + (col * stepX) / scale,
          y: originY + (row * stepY) / scale,
          w: contentWidthPx / scale,
          h: contentHeightPx / scale,
        },
      });
    }
  }

  return {
    paper: opts.paper,
    orientation,
    pageWidthMm,
    pageHeightMm,
    marginMm: opts.marginMm,
    contentWidthPx,
    contentHeightPx,
    scale,
    rows,
    cols,
    pages,
  };
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
  validateInputs(bounds, opts);

  if (opts.orientation === 'auto') {
    const portraitPlan = buildPlan(bounds, opts, 'portrait');
    const landscapePlan = buildPlan(bounds, opts, 'landscape');

    const portraitPages = portraitPlan.rows * portraitPlan.cols;
    const landscapePages = landscapePlan.rows * landscapePlan.cols;

    if (landscapePages < portraitPages) {
      return landscapePlan;
    }
    if (portraitPages < landscapePages) {
      return portraitPlan;
    }

    // A parità di numero di pagine, privilegia la scala maggiore; a parità ancora portrait.
    if (landscapePlan.scale > portraitPlan.scale + FLOAT_EPSILON) {
      return landscapePlan;
    }
    return portraitPlan;
  }

  return buildPlan(bounds, opts, opts.orientation);
}
