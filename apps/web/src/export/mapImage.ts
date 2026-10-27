import {
  buildSvgDocument,
  computeRasterSize,
  type Layout,
  type WorldRect,
} from '@xmap/core';
import { computeLayoutBounds, getPrintableMapClone } from '../print/mapClone.js';

export type MapImageFormat = 'png' | 'svg';

export interface MapImageOptions {
  layout: Layout | null;
  format: MapImageFormat;
  /** Sfondo trasparente invece del colore della tela. */
  transparent?: boolean;
  /** Moltiplicatore di risoluzione (solo PNG). */
  scale?: number;
  title?: string;
}

export interface MapImageResult {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  /** La scala richiesta è stata ridotta per rispettare i limiti del canvas. */
  clamped: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Proprietà CSS non colore che si fissano inline: l'SVG esportato non ha accesso ai fogli di stile dell'app. */
const STYLE_PROPS = [
  'opacity',
  'visibility',
  'display',
  'fill-opacity',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration-line',
  'text-anchor',
  'text-overflow',
  'white-space',
  'overflow',
  'overflow-wrap',
  'word-break',
  'box-sizing',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'align-items',
  'justify-content',
  'gap',
  'width',
  'height',
  'max-width',
  'min-width',
  'padding',
  'margin',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-radius',
  'filter',
] as const;

/** Proprietà colore: si normalizzano in rgb(a) perché oklch()/color-mix() non sono letti da tutti i visualizzatori SVG. */
const SVG_COLOR_PROPS = ['fill', 'stroke', 'stop-color'] as const;

const COLOR_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'text-decoration-color',
] as const;

const ALL_COLOR_PROPS = [...SVG_COLOR_PROPS, ...COLOR_PROPS] as const;
const CSS_FUNCTION_RE = /var\(|color-mix\(|oklch\(/;

/** Valori che non cambiano il risultato se omessi. */
const NEUTRAL_VALUES = new Set(['', 'none', 'normal', 'auto', '0px', 'visible', '1']);

function createColorResolver(): (value: string) => string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, string>();

  return (value) => {
    if (!ctx || !value || value === 'none' || value.startsWith('url(')) return value;
    const cached = cache.get(value);
    if (cached !== undefined) return cached;

    let resolved = value;
    // Sentinella: se il parser rifiuta il colore, fillStyle resta invariato.
    ctx.fillStyle = '#010203';
    ctx.fillStyle = value;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    if (a > 0) {
      resolved = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
    } else if (/^(transparent|rgba?\(.*[, /]\s*0\))$/.test(value.trim())) {
      resolved = 'transparent';
    }
    cache.set(value, resolved);
    return resolved;
  };
}

/** Sostituisce `class`/`var()` con valori calcolati: l'elemento diventa autonomo. */
function inlineComputedStyles(root: Element, resolveColor: (value: string) => string): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of elements) {
    const computed = getComputedStyle(el);
    const declarations: string[] = [];

    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop).trim();
      // Con stile `solid` e spessore omesso il bordo varrebbe `medium`: lo 0px dei bordi va scritto.
      const keepZero = prop.startsWith('border-') && prop.endsWith('-width');
      if (keepZero ? value !== '' : !NEUTRAL_VALUES.has(value)) declarations.push(`${prop}:${value}`);
    }
    const colorProps = el instanceof SVGElement ? ALL_COLOR_PROPS : COLOR_PROPS;
    for (const prop of colorProps) {
      const value = computed.getPropertyValue(prop).trim();
      if (value) declarations.push(`${prop}:${resolveColor(value)}`);
    }

    el.removeAttribute('class');
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
    }
    // Gli attributi di presentazione possono contenere var()/color-mix(): lo stile inline li sostituisce.
    for (const attr of ['fill', 'stroke', 'stop-color', 'color']) {
      if (CSS_FUNCTION_RE.test(el.getAttribute(attr) ?? '')) el.removeAttribute(attr);
    }
    el.setAttribute('style', declarations.join(';'));
  }
}

interface ExportScene {
  bounds: WorldRect;
  contentXml: string;
  defsXml?: string;
  background: string;
}

/**
 * Cattura la mappa dal DOM in tema chiaro, con stili risolti. Il clone vive in
 * un contenitore fuori schermo `.print-light` solo per il tempo del calcolo.
 */
function captureScene(layout: Layout | null): ExportScene {
  const printable = getPrintableMapClone();
  if (!printable) throw new Error('La mappa non è visibile: impossibile esportare l\'immagine.');
  const bounds = computeLayoutBounds(layout);

  const host = document.createElement('div');
  host.className = 'print-light';
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(Math.ceil(bounds.w)));
  svg.setAttribute('height', String(Math.ceil(bounds.h)));
  if (printable.defs) svg.appendChild(printable.defs);
  svg.appendChild(printable.clone);
  host.appendChild(svg);
  document.body.appendChild(host);

  try {
    const resolveColor = createColorResolver();
    inlineComputedStyles(printable.clone, resolveColor);
    const canvasColor = getComputedStyle(host).getPropertyValue('--map-canvas').trim() || '#ffffff';
    const background = resolveColor(canvasColor);
    return {
      bounds,
      contentXml: new XMLSerializer().serializeToString(printable.clone),
      defsXml: printable.defs ? new XMLSerializer().serializeToString(printable.defs) : undefined,
      background,
    };
  } finally {
    host.remove();
  }
}

function loadSvgImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Il browser non riesce a disegnare la mappa come immagine.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Impossibile creare il PNG: l\'immagine è troppo grande.'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

/** Rende la mappa visibile come SVG autonomo o PNG, senza filigrana. */
export async function renderMapImage(options: MapImageOptions): Promise<MapImageResult> {
  const { layout, format, transparent = false, scale = 2, title } = options;
  if (document.fonts?.ready) await document.fonts.ready;

  const scene = captureScene(layout);
  const svgText = buildSvgDocument({
    bounds: scene.bounds,
    contentXml: scene.contentXml,
    defsXml: scene.defsXml,
    background: transparent ? null : scene.background,
    title,
  });

  if (format === 'svg') {
    return {
      bytes: new TextEncoder().encode(svgText),
      mime: 'image/svg+xml',
      width: Math.ceil(scene.bounds.w),
      height: Math.ceil(scene.bounds.h),
      clamped: false,
    };
  }

  const size = computeRasterSize(scene.bounds, scale);
  const image = await loadSvgImage(svgText);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Il canvas non è disponibile in questo ambiente.');
  ctx.drawImage(image, 0, 0, size.width, size.height);

  return {
    bytes: await canvasToPng(canvas),
    mime: 'image/png',
    width: size.width,
    height: size.height,
    clamped: size.clamped,
  };
}
