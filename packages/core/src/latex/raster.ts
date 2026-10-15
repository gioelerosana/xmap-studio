import { CODE_RENDERER, XmapError } from '../errors.js';
/**
 * Converte SVG in immagine PNG ad alta risoluzione (scala tipica: 3x per XMind).
 */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale: number = 3.0,
  color: string = '#000000'
): Promise<Uint8Array> {
  let coloredSvg = svg.replaceAll('currentColor', color);
  if (!coloredSvg.includes('xmlns="http://www.w3.org/2000/svg"')) {
    coloredSvg = coloredSvg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  }

  // 1. Prova prima con @resvg/resvg-js (ambiente Node/Electron/Vitest)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resvgPkg = typeof process !== 'undefined' && process.versions?.node ? await import('@resvg/resvg-js') : null;
    if (resvgPkg && resvgPkg.Resvg) {
      const resvg = new resvgPkg.Resvg(coloredSvg, {
        fitTo: {
          mode: 'zoom',
          value: scale,
        },
      });
      const pngData = resvg.render();
      return new Uint8Array(pngData.asPng());
    }
  } catch {
    // Non disponibile o siamo nel browser
  }

  // 2. Ambiente Browser / DOM Canvas
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return await rasterizeBrowserCanvas(coloredSvg, width, height, scale);
  }

  // 3. Fallback OffscreenCanvas se presente (Web Worker)
  if (typeof OffscreenCanvas !== 'undefined') {
    return await rasterizeOffscreenCanvas(coloredSvg, width, height, scale);
  }

  throw new XmapError(CODE_RENDERER, 'Nessun motore di rasterizzazione disponibile (manca @resvg/resvg-js o Canvas DOM)');
}

function rasterizeBrowserCanvas(
  svg: string,
  width: number,
  height: number,
  scale: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new XmapError(CODE_RENDERER, 'Canvas 2D context not available'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blobResult) => {
        if (!blobResult) {
          reject(new XmapError(CODE_RENDERER, 'Canvas toBlob failed'));
          return;
        }
        blobResult.arrayBuffer().then((buf) => {
          resolve(new Uint8Array(buf));
        }).catch(reject);
      }, 'image/png');
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new XmapError(CODE_RENDERER, `Caricamento SVG fallito per rasterizzazione: ${e}`));
    };

    img.src = url;
  });
}

async function rasterizeOffscreenCanvas(
  svg: string,
  width: number,
  height: number,
  scale: number
): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new XmapError(CODE_RENDERER, 'OffscreenCanvas 2D not available');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await resultBlob.arrayBuffer();
  return new Uint8Array(buf);
}
