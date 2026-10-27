import { describe, expect, it } from 'vitest';
import {
  buildSvgDocument,
  computeRasterSize,
  MAX_RASTER_PIXELS,
  MAX_RASTER_SIDE,
} from '../src/exporters/svgDocument.js';
import type { WorldRect } from '../src/print/paginate.js';

const RIQUADRO_X = 10;
const RIQUADRO_Y = 20;
const RIQUADRO_W = 300.5;
const RIQUADRO_H = 200;
const LARGHEZZA_ARROTONDATA = 301;

const MAPPA_PICCOLA_W = 100;
const MAPPA_PICCOLA_H = 50;
const SCALA_DOPPIA = 2;
const SCALA_SESQUI = 1.5;
const LARGHEZZA_FRAZIONARIA = 100.7;
const LARGHEZZA_SCALATA = 151;
const ALTEZZA_SCALATA = 75;

const MAPPA_ENORME = 20000;
const MAPPA_ENORME_ALTEZZA = 10000;

describe('buildSvgDocument', () => {
  const bounds: WorldRect = {
    x: RIQUADRO_X,
    y: RIQUADRO_Y,
    w: RIQUADRO_W,
    h: RIQUADRO_H,
  };
  const piccolo: WorldRect = { x: 0, y: 0, w: MAPPA_PICCOLA_W, h: MAPPA_PICCOLA_H };

  describe('struttura del documento', () => {
    it('inserisce la dichiarazione XML e il namespace SVG', () => {
      const svg = buildSvgDocument({ bounds, contentXml: '' });

      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    });

    it('usa width e height arrotondati per eccesso e viewBox pari al riquadro', () => {
      const svg = buildSvgDocument({ bounds, contentXml: '' });

      expect(svg).toContain(`width="${LARGHEZZA_ARROTONDATA}"`);
      expect(svg).toContain(`height="${RIQUADRO_H}"`);
      expect(svg).toContain(`viewBox="${RIQUADRO_X} ${RIQUADRO_Y} ${RIQUADRO_W} ${RIQUADRO_H}"`);
    });

    it('avvolge il contenuto in un gruppo e chiude l elemento svg', () => {
      const svg = buildSvgDocument({ bounds, contentXml: '<text>ciao</text>' });

      expect(svg).toContain('<g><text>ciao</text></g>');
      expect(svg.endsWith('</svg>')).toBe(true);
    });
  });

  describe('titolo', () => {
    it('escapa i caratteri speciali (&, <, >, ")', () => {
      const svg = buildSvgDocument({
        bounds,
        contentXml: '',
        title: 'A & B <C> "D"',
      });

      expect(svg).toContain('<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>');
      expect(svg).not.toContain('<C>');
    });

    it('non emette l elemento title se il titolo manca', () => {
      const svg = buildSvgDocument({ bounds, contentXml: '' });

      expect(svg).not.toContain('<title>');
    });
  });

  describe('sfondo', () => {
    it('disegna un rect di sfondo col colore dato, coperto dal riquadro', () => {
      const svg = buildSvgDocument({
        bounds: piccolo,
        contentXml: '',
        background: '#ffffff',
      });

      expect(svg).toContain(
        `<rect x="0" y="0" width="${MAPPA_PICCOLA_W}" height="${MAPPA_PICCOLA_H}" fill="#ffffff"/>`,
      );
    });

    it('non disegna alcun rect se lo sfondo è null', () => {
      const svg = buildSvgDocument({ bounds, contentXml: '', background: null });

      expect(svg).not.toContain('<rect');
    });

    it('non disegna alcun rect se lo sfondo è omesso', () => {
      const svg = buildSvgDocument({ bounds, contentXml: '' });

      expect(svg).not.toContain('<rect');
    });
  });

  describe('ordine di composizione', () => {
    it('inserisce defs prima dello sfondo e lo sfondo prima del contenuto', () => {
      const svg = buildSvgDocument({
        bounds: piccolo,
        defsXml: '<defs><linearGradient id="g"/></defs>',
        background: '#ffffff',
        contentXml: '<text>x</text>',
      });

      const defsAt = svg.indexOf('<defs>');
      const backgroundAt = svg.indexOf('<rect');
      const contentAt = svg.indexOf('<g>');

      expect(defsAt).toBeGreaterThan(-1);
      expect(backgroundAt).toBeGreaterThan(defsAt);
      expect(contentAt).toBeGreaterThan(backgroundAt);
    });
  });

  describe('input non validi', () => {
    it('lancia errore se la larghezza o l altezza sono <= 0 (mappa vuota)', () => {
      expect(() => buildSvgDocument({ bounds: { x: 0, y: 0, w: 0, h: MAPPA_PICCOLA_H }, contentXml: '' })).toThrowError(
        'vuota',
      );
      expect(() => buildSvgDocument({ bounds: { x: 0, y: 0, w: MAPPA_PICCOLA_W, h: -1 }, contentXml: '' })).toThrowError(
        'vuota',
      );
    });

    it('lancia errore con messaggio in italiano se una coordinata non è finita', () => {
      expect(() => buildSvgDocument({ bounds: { x: NaN, y: 0, w: MAPPA_PICCOLA_W, h: MAPPA_PICCOLA_H }, contentXml: '' })).toThrowError(
        'non è valido',
      );
      expect(() => buildSvgDocument({ bounds: { x: 0, y: 0, w: Infinity, h: MAPPA_PICCOLA_H }, contentXml: '' })).toThrowError(
        'non è valido',
      );
    });
  });
});

describe('computeRasterSize', () => {
  describe('scala richiesta entro i limiti', () => {
    const piccolo: WorldRect = { x: 0, y: 0, w: MAPPA_PICCOLA_W, h: MAPPA_PICCOLA_H };

    it('con scala 1 restituisce le dimensioni del riquadro senza riduzioni', () => {
      expect(computeRasterSize(piccolo, 1)).toEqual({
        width: MAPPA_PICCOLA_W,
        height: MAPPA_PICCOLA_H,
        scale: 1,
        clamped: false,
      });
    });

    it('con scala 2 raddoppia le dimensioni senza riduzioni', () => {
      expect(computeRasterSize(piccolo, SCALA_DOPPIA)).toEqual({
        width: MAPPA_PICCOLA_W * SCALA_DOPPIA,
        height: MAPPA_PICCOLA_H * SCALA_DOPPIA,
        scale: SCALA_DOPPIA,
        clamped: false,
      });
    });

    it('tronca le dimensioni frazionarie per difetto', () => {
      const size = computeRasterSize({ x: 0, y: 0, w: LARGHEZZA_FRAZIONARIA, h: MAPPA_PICCOLA_H }, SCALA_SESQUI);

      expect(size.width).toBe(LARGHEZZA_SCALATA);
      expect(size.height).toBe(ALTEZZA_SCALATA);
      expect(size.clamped).toBe(false);
    });
  });

  describe('riquadro enorme', () => {
    const enorme: WorldRect = { x: 0, y: 0, w: MAPPA_ENORME, h: MAPPA_ENORME_ALTEZZA };

    it('riduce la scala e segnala clamped', () => {
      const size = computeRasterSize(enorme, 1);

      expect(size.scale).toBeLessThan(1);
      expect(size.clamped).toBe(true);
    });

    it('rispetta il lato massimo e l area massima', () => {
      const size = computeRasterSize(enorme, 1);

      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_RASTER_SIDE);
      expect(size.width * size.height).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
    });

    it('rispetta l area massima anche quando il lato resta sotto il limite', () => {
      const quadrato: WorldRect = { x: 0, y: 0, w: MAPPA_ENORME, h: MAPPA_ENORME };
      const size = computeRasterSize(quadrato, 1);

      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_RASTER_SIDE);
      expect(size.width * size.height).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
      expect(size.clamped).toBe(true);
    });
  });

  describe('input non validi', () => {
    const piccolo: WorldRect = { x: 0, y: 0, w: MAPPA_PICCOLA_W, h: MAPPA_PICCOLA_H };

    it('lancia errore per scala <= 0 o non finita', () => {
      expect(() => computeRasterSize(piccolo, 0)).toThrowError('scala');
      expect(() => computeRasterSize(piccolo, -1)).toThrowError('scala');
      expect(() => computeRasterSize(piccolo, NaN)).toThrowError('scala');
    });

    it('lancia errore per un riquadro vuoto', () => {
      expect(() => computeRasterSize({ x: 0, y: 0, w: 0, h: MAPPA_PICCOLA_H }, 1)).toThrowError('vuota');
    });
  });
});
