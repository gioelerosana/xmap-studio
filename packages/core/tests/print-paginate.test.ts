import { describe, expect, it } from 'vitest';
import {
  MM_TO_PX,
  PAPER_SIZES_MM,
  paginate,
  type PrintOptions,
  type WorldRect,
} from '../src/print/paginate.js';

describe('paginate', () => {
  const defaultA4Portrait: PrintOptions = {
    paper: 'A4',
    orientation: 'portrait',
    fit: { mode: 'fit-page' },
    marginMm: 10,
    overlapMm: 5,
  };

  describe('fit-page su A4 verticale e orizzontale', () => {
    it('calcola la scala corretta e produce 1 sola pagina per A4 verticale', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 1000, h: 2000 };
      const plan = paginate(bounds, defaultA4Portrait);

      const expectedContentW = (210 - 20) * MM_TO_PX;
      const expectedContentH = (297 - 20) * MM_TO_PX;
      const expectedScale = Math.min(expectedContentW / 1000, expectedContentH / 2000, 1.5);

      expect(plan.orientation).toBe('portrait');
      expect(plan.pageWidthMm).toBe(210);
      expect(plan.pageHeightMm).toBe(297);
      expect(plan.marginMm).toBe(10);
      expect(plan.contentWidthPx).toBeCloseTo(expectedContentW, 5);
      expect(plan.contentHeightPx).toBeCloseTo(expectedContentH, 5);
      expect(plan.scale).toBeCloseTo(expectedScale, 5);
      expect(plan.rows).toBe(1);
      expect(plan.cols).toBe(1);
      expect(plan.pages).toHaveLength(1);

      const page = plan.pages[0];
      expect(page.index).toBe(0);
      expect(page.row).toBe(0);
      expect(page.col).toBe(0);
      expect(page.world.w).toBeCloseTo(expectedContentW / expectedScale, 5);
      expect(page.world.h).toBeCloseTo(expectedContentH / expectedScale, 5);
    });

    it('calcola la scala corretta e produce 1 sola pagina per A4 orizzontale', () => {
      const bounds: WorldRect = { x: 100, y: 200, w: 2000, h: 1000 };
      const opts: PrintOptions = {
        ...defaultA4Portrait,
        orientation: 'landscape',
      };
      const plan = paginate(bounds, opts);

      const expectedContentW = (297 - 20) * MM_TO_PX;
      const expectedContentH = (210 - 20) * MM_TO_PX;
      const expectedScale = Math.min(expectedContentW / 2000, expectedContentH / 1000, 1.5);

      expect(plan.orientation).toBe('landscape');
      expect(plan.pageWidthMm).toBe(297);
      expect(plan.pageHeightMm).toBe(210);
      expect(plan.scale).toBeCloseTo(expectedScale, 5);
      expect(plan.rows).toBe(1);
      expect(plan.cols).toBe(1);
      expect(plan.pages).toHaveLength(1);
    });
  });

  describe('tetto maxScale per mappe piccole', () => {
    it('applica il default di 1.5 per fit-page', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 50, h: 50 };
      const plan = paginate(bounds, defaultA4Portrait);
      expect(plan.scale).toBe(1.5);
    });

    it('rispetta un valore personalizzato di maxScale in fit-page', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 50, h: 50 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        maxScale: 0.75,
      });
      expect(plan.scale).toBe(0.75);
    });

    it('rispetta maxScale in fit-width', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 50, h: 50 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'fit-width', pagesWide: 2 },
        maxScale: 0.8,
      });
      expect(plan.scale).toBe(0.8);
      expect(plan.cols).toBe(1);
    });
  });

  describe('orientamento auto', () => {
    it('sceglie landscape per una mappa molto larga', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 3000, h: 400 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        orientation: 'auto',
      });
      expect(plan.orientation).toBe('landscape');
    });

    it('sceglie portrait per una mappa molto alta', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 400, h: 3000 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        orientation: 'auto',
      });
      expect(plan.orientation).toBe('portrait');
    });

    it('sceglie landscape se riduce il numero di pagine in modalità scale fissa', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 2000, h: 400 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        orientation: 'auto',
        fit: { mode: 'scale', scale: 1 },
      });
      expect(plan.orientation).toBe('landscape');
      expect(plan.rows * plan.cols).toBeLessThan(
        paginate(bounds, { ...defaultA4Portrait, orientation: 'portrait', fit: { mode: 'scale', scale: 1 } }).pages.length,
      );
    });

    it('a parità di numero di pagine e scala sceglie portrait', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 10, h: 10 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        orientation: 'auto',
        maxScale: 1.5,
      });
      expect(plan.orientation).toBe('portrait');
      expect(plan.scale).toBe(1.5);
    });
  });

  describe('fit-width con 2 e 3 pagine', () => {
    it('configura 2 pagine in larghezza e calcola le righe dall altezza', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 1000, h: 800 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'fit-width', pagesWide: 2 },
      });

      const contentW = plan.contentWidthPx;
      const overlapPx = 5 * MM_TO_PX;
      const expectedScale = (2 * contentW - overlapPx) / bounds.w;

      expect(plan.cols).toBe(2);
      expect(plan.scale).toBeCloseTo(expectedScale, 5);
      const expectedRows = bounds.h * expectedScale <= plan.contentHeightPx ? 1 : 2;
      expect(plan.rows).toBe(expectedRows);
      expect(plan.pages).toHaveLength(2 * expectedRows);
    });

    it('configura 3 pagine in larghezza e calcola le righe necessarie', () => {
      const bounds: WorldRect = { x: 0, y: 0, w: 3000, h: 2500 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'fit-width', pagesWide: 3 },
      });

      const contentW = plan.contentWidthPx;
      const overlapPx = 5 * MM_TO_PX;
      const expectedScale = (3 * contentW - 2 * overlapPx) / bounds.w;

      expect(plan.cols).toBe(3);
      expect(plan.scale).toBeCloseTo(expectedScale, 5);
      expect(plan.rows).toBeGreaterThanOrEqual(1);
      expect(plan.pages).toHaveLength(3 * plan.rows);
    });
  });

  describe('scale fissa con conteggio pagine', () => {
    it('calcola correttamente righe, colonne e indici di pagina', () => {
      const bounds: WorldRect = { x: 50, y: 50, w: 1500, h: 2000 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'scale', scale: 0.8 },
      });

      expect(plan.scale).toBe(0.8);
      expect(plan.cols).toBeGreaterThan(1);
      expect(plan.rows).toBeGreaterThan(1);
      expect(plan.pages).toHaveLength(plan.rows * plan.cols);

      // Verifica ordine riga per riga e indici
      plan.pages.forEach((page, idx) => {
        expect(page.index).toBe(idx);
        expect(page.row).toBe(Math.floor(idx / plan.cols));
        expect(page.col).toBe(idx % plan.cols);
      });
    });
  });

  describe('mappa che entra esattamente in N pagine (nessuna pagina extra)', () => {
    it('non aggiunge una colonna extra quando la larghezza corrisponde esattamente a 2 pagine', () => {
      const scale = 1.0;
      const contentW = (210 - 20) * MM_TO_PX;
      const overlapPx = 5 * MM_TO_PX;
      const stepX = contentW - overlapPx;

      // Larghezza esatta per 2 pagine su carta
      const exactW = contentW + stepX;
      const bounds: WorldRect = { x: 0, y: 0, w: exactW / scale, h: 100 };

      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'scale', scale },
      });

      expect(plan.cols).toBe(2);
    });

    it('non aggiunge una colonna extra quando la larghezza corrisponde esattamente a 3 pagine', () => {
      const scale = 1.0;
      const contentW = (210 - 20) * MM_TO_PX;
      const overlapPx = 5 * MM_TO_PX;
      const stepX = contentW - overlapPx;

      const exactW = contentW + 2 * stepX;
      const bounds: WorldRect = { x: 0, y: 0, w: exactW / scale, h: 100 };

      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'scale', scale },
      });

      expect(plan.cols).toBe(3);
    });

    it('non aggiunge una riga extra quando l altezza corrisponde esattamente a 2 pagine', () => {
      const scale = 1.0;
      const contentH = (297 - 20) * MM_TO_PX;
      const overlapPx = 5 * MM_TO_PX;
      const stepY = contentH - overlapPx;

      const exactH = contentH + stepY;
      const bounds: WorldRect = { x: 0, y: 0, w: 100, h: exactH / scale };

      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'scale', scale },
      });

      expect(plan.rows).toBe(2);
    });
  });

  describe('centratura della mappa', () => {
    it('prima pagina e ultima pagina sono simmetriche rispetto a bounds', () => {
      const bounds: WorldRect = { x: 120, y: -80, w: 1400, h: 1800 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        fit: { mode: 'scale', scale: 0.75 },
      });

      const firstPage = plan.pages[0];
      const lastPage = plan.pages[plan.pages.length - 1];

      const leftMargin = bounds.x - firstPage.world.x;
      const rightMargin = (lastPage.world.x + lastPage.world.w) - (bounds.x + bounds.w);
      expect(leftMargin).toBeCloseTo(rightMargin, 6);

      const topMargin = bounds.y - firstPage.world.y;
      const bottomMargin = (lastPage.world.y + lastPage.world.h) - (bounds.y + bounds.h);
      expect(topMargin).toBeCloseTo(bottomMargin, 6);
    });
  });

  describe('sovrapposizione (overlap)', () => {
    it('pagine adiacenti si sovrappongono esattamente di overlapMm * MM_TO_PX / scale in px mondo', () => {
      const overlapMm = 8;
      const bounds: WorldRect = { x: 0, y: 0, w: 1600, h: 2200 };
      const plan = paginate(bounds, {
        ...defaultA4Portrait,
        overlapMm,
        fit: { mode: 'scale', scale: 0.9 },
      });

      const expectedOverlapWorld = (overlapMm * MM_TO_PX) / plan.scale;

      // Verifica sovrapposizione orizzontale
      for (let r = 0; r < plan.rows; r++) {
        for (let c = 0; c < plan.cols - 1; c++) {
          const pageLeft = plan.pages[r * plan.cols + c];
          const pageRight = plan.pages[r * plan.cols + c + 1];
          const actualOverlapX = (pageLeft.world.x + pageLeft.world.w) - pageRight.world.x;
          expect(actualOverlapX).toBeCloseTo(expectedOverlapWorld, 6);
        }
      }

      // Verifica sovrapposizione verticale
      for (let r = 0; r < plan.rows - 1; r++) {
        for (let c = 0; c < plan.cols; c++) {
          const pageTop = plan.pages[r * plan.cols + c];
          const pageBottom = plan.pages[(r + 1) * plan.cols + c];
          const actualOverlapY = (pageTop.world.y + pageTop.world.h) - pageBottom.world.y;
          expect(actualOverlapY).toBeCloseTo(expectedOverlapWorld, 6);
        }
      }
    });
  });

  describe('errori per input non validi', () => {
    const validBounds: WorldRect = { x: 0, y: 0, w: 500, h: 500 };

    it('lancia errore per bounds degenere (larghezza <= 0 o altezza <= 0 o non finite)', () => {
      expect(() => paginate({ x: 0, y: 0, w: 0, h: 500 }, defaultA4Portrait)).toThrowError();
      expect(() => paginate({ x: 0, y: 0, w: -10, h: 500 }, defaultA4Portrait)).toThrowError();
      expect(() => paginate({ x: 0, y: 0, w: 500, h: 0 }, defaultA4Portrait)).toThrowError();
      expect(() => paginate({ x: 0, y: 0, w: 500, h: -20 }, defaultA4Portrait)).toThrowError();
      expect(() => paginate({ x: NaN, y: 0, w: 500, h: 500 }, defaultA4Portrait)).toThrowError();
      expect(() => paginate({ x: 0, y: 0, w: Infinity, h: 500 }, defaultA4Portrait)).toThrowError();
    });

    it('lancia errore per marginMm o overlapMm negativi o non finiti', () => {
      expect(() => paginate(validBounds, { ...defaultA4Portrait, marginMm: -1 })).toThrowError();
      expect(() => paginate(validBounds, { ...defaultA4Portrait, marginMm: NaN })).toThrowError();
      expect(() => paginate(validBounds, { ...defaultA4Portrait, overlapMm: -5 })).toThrowError();
      expect(() => paginate(validBounds, { ...defaultA4Portrait, overlapMm: Infinity })).toThrowError();
    });

    it('lancia errore per margini che azzerano o rendono negativa l area utile', () => {
      // Per A4 verticale (210 x 297 mm), margine di 105 mm azzera la larghezza (210 - 2*105 = 0)
      expect(() => paginate(validBounds, { ...defaultA4Portrait, marginMm: 105 })).toThrowError();
      expect(() => paginate(validBounds, { ...defaultA4Portrait, marginMm: 120 })).toThrowError();
    });

    it('lancia errore per overlap maggiore o uguale all area utile', () => {
      // Area utile orizzontale = 210 - 20 = 190 mm. Con overlap 190 mm il passo diventa <= 0
      expect(() => paginate(validBounds, { ...defaultA4Portrait, overlapMm: 190 })).toThrowError();
      expect(() => paginate(validBounds, { ...defaultA4Portrait, overlapMm: 200 })).toThrowError();
    });

    it('lancia errore per fit-width con pagesWide non valido', () => {
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          fit: { mode: 'fit-width', pagesWide: 0 },
        }),
      ).toThrowError();
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          fit: { mode: 'fit-width', pagesWide: -2 },
        }),
      ).toThrowError();
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          fit: { mode: 'fit-width', pagesWide: 1.5 },
        }),
      ).toThrowError();
    });

    it('lancia errore per fit scale con scale non valida', () => {
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          fit: { mode: 'scale', scale: 0 },
        }),
      ).toThrowError();
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          fit: { mode: 'scale', scale: -1 },
        }),
      ).toThrowError();
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          fit: { mode: 'scale', scale: NaN },
        }),
      ).toThrowError();
    });

    it('lancia errore per maxScale non valido', () => {
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          maxScale: 0,
        }),
      ).toThrowError();
      expect(() =>
        paginate(validBounds, {
          ...defaultA4Portrait,
          maxScale: -0.5,
        }),
      ).toThrowError();
    });
  });
});
