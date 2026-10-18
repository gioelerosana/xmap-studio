import { setTextMeasurer } from '@xmap/core';

/**
 * Misura reale del testo dei blocchi con il font della mappa (canvas `measureText`),
 * così il layout del core adatta i blocchi esattamente al testo invece di stimarlo.
 * Il grassetto si misura a 700, il peso più largo usato sulla mappa: meglio un
 * pixel in più che un titolo troncato.
 */
export function installTextMeasurer(): void {
  if (typeof document === 'undefined') return;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  const family =
    getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif';
  const cache = new Map<string, number>();
  setTextMeasurer((text, fontSizePx, bold) => {
    const key = `${bold ? 'b' : 'n'}${fontSizePx}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = `${bold ? 700 : 400} ${fontSizePx}px ${family}`;
    const width = ctx.measureText(text).width;
    if (cache.size > 20000) cache.clear();
    cache.set(key, width);
    return width;
  });
}
