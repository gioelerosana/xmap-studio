import { describe, expect, it } from 'vitest';
import { AppController, DEFAULT_LAYOUT_OPTS, layoutSheets } from '../src/index.js';
import { minimalXmind } from './helpers.js';
import { syntheticSheet } from './perf-core-fixtures.js';

/** Media in ms di `reps` esecuzioni dopo un giro di riscaldamento. */
function time(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - t0) / reps;
}

// Benchmark lunghi: si eseguono solo con XMAP_BENCH=1 e servono per i numeri, non per la CI.
describe.skipIf(!process.env.XMAP_BENCH)('benchmark modifica end-to-end', () => {
  for (const size of [500, 2000]) {
    it(`mappa da ${size} blocchi (x3 fogli)`, async () => {
      const c = new AppController();
      const bytes = await minimalXmind([
        syntheticSheet(size, 'a'),
        syntheticSheet(size, 'b'),
        syntheticSheet(size, 'c'),
      ]);
      const t0 = performance.now();
      await c.open(bytes);
      const openMs = performance.now() - t0;
      let k = 0;
      const target = `a-t${Math.floor(size / 2)}`;
      const edit = (): void => {
        const dto = c.setTopicTitle(target, `Titolo ${k++}`);
        layoutSheets([dto.sheets[0]], new Set(), undefined, DEFAULT_LAYOUT_OPTS);
      };
      const editOnly = (): void => void c.setTopicTitle(target, `Titolo ${k++}`);
      const color = (): void => void c.setTopicColor(target, k++ % 2 === 0 ? '#ff0000' : '#00ff00');
      const dto = c.workbook();
      expect(dto).not.toBeNull();
      const sheet = dto?.sheets[0];
      if (!sheet) throw new Error('foglio mancante');
      const layoutOnly = (): void => void layoutSheets([sheet], new Set(), undefined, DEFAULT_LAYOUT_OPTS);
      const toDto = (): void => void c.workbook();
      const reps = 30;
      // Come la UI: undo, poi `workbook()` per la selezione e di nuovo per lo stato.
      const undoUi = (): void => {
        c.setTopicTitle(target, `U ${k++}`);
        c.undo();
        c.workbook();
        c.workbook();
      };
      // Salvataggio: markSaved + refreshState, e il layout che la UI rifà se il foglio cambia identità.
      let lastSheet = c.workbook()?.sheets[0];
      const saveUi = (): void => {
        c.markSaved(undefined, 'hash');
        const s = c.workbook()?.sheets[0];
        if (s && s !== lastSheet) layoutSheets([s], new Set(), undefined, DEFAULT_LAYOUT_OPTS);
        lastSheet = s;
      };
      console.log(
        `[bench ${size}x3] modifica+undo come la UI ${time(undoUi, reps).toFixed(2)} ms | ` +
          `salvataggio (markSaved+refresh+layout) ${time(saveUi, reps).toFixed(2)} ms`
      );
      console.log(
        `[bench ${size}x3] open ${openMs.toFixed(1)} ms | rinomina+layout ${time(edit, reps).toFixed(2)} ms | ` +
          `rinomina(controller) ${time(editOnly, reps).toFixed(2)} ms | colore ${time(color, reps).toFixed(2)} ms | ` +
          `toDto ${time(toDto, reps).toFixed(2)} ms | layout ${time(layoutOnly, reps).toFixed(2)} ms`
      );
    }, 120000);
  }
});
