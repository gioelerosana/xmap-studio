import { describe, expect, it } from 'vitest';
import { AppController, OpenWorkbook, Sheet } from '../src/index.js';
import { minimalXmind } from './helpers.js';

function workbook(): OpenWorkbook {
  const sheets: Sheet[] = [{ id: 's', rootTopic: { id: 'root', title: 'R' } }];
  return new OpenWorkbook('/tmp/x.xmind', 'x.xmind', { entries: new Map(), resources: new Map() }, sheets);
}

function edit(wb: OpenWorkbook, title: string): void {
  wb.content[0].rootTopic!.title = title;
  wb.pushHistory();
}

describe('OpenWorkbook dirty flag', () => {
  it('resta dirty dopo salvataggio, undo e nuova modifica (ramo redo scartato)', () => {
    const wb = workbook();
    edit(wb, 'A');
    edit(wb, 'B');
    wb.markSaved(undefined, 'hash');
    expect(wb.isDirty()).toBe(false);
    wb.undo();
    expect(wb.isDirty()).toBe(true);
    edit(wb, 'C');
    expect(wb.isDirty()).toBe(true);
    // Nemmeno tornando indietro si ritrova lo stato salvato.
    wb.undo();
    expect(wb.content[0].rootTopic!.title).toBe('A');
    expect(wb.isDirty()).toBe(true);
  });

  it('undo fino allo stato salvato torna pulito', () => {
    const wb = workbook();
    edit(wb, 'A');
    wb.markSaved(undefined, 'hash');
    edit(wb, 'B');
    expect(wb.isDirty()).toBe(true);
    wb.undo();
    expect(wb.isDirty()).toBe(false);
  });

  it('lo stato salvato espulso dalla cronologia non torna pulito', () => {
    const wb = workbook();
    wb.markSaved(undefined, 'hash');
    for (let i = 0; i < 250; i++) edit(wb, `T${i}`);
    while (wb.canUndo()) {
      wb.undo();
      expect(wb.isDirty()).toBe(true);
    }
  });

  it('una modifica senza cambiamenti non crea un passo di undo né sporca la mappa', () => {
    const wb = workbook();
    edit(wb, 'A');
    wb.markSaved(undefined, 'hash');
    edit(wb, 'A');
    expect(wb.isDirty()).toBe(false);
    expect(wb.history).toHaveLength(2);
  });

  it('fondere una modifica nello snapshot salvato lo rende di nuovo da salvare', () => {
    const wb = workbook();
    edit(wb, 'A');
    wb.markSaved(undefined, 'hash');
    wb.content[0].rootTopic!.title = 'A2';
    wb.replaceHistoryTop();
    expect(wb.isDirty()).toBe(true);
  });

  it('le modifiche fatte durante un salvataggio asincrono restano da salvare', async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind(), null, 'x.xmind');
    ctrl.setTopicTitle('a', 'Prima');
    const { revision } = await ctrl.prepareArchiveBytes();
    // Il blocco cambia mentre i byte sono in scrittura.
    ctrl.setTopicTitle('a', 'Durante');
    expect(ctrl.markSaved(undefined, 'hash', revision).dirty).toBe(true);
    ctrl.undo();
    expect(ctrl.isDirty()).toBe(false);
  });

  it('rinominare un blocco appena creato dopo averlo salvato sporca la mappa', async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind(), null, 'x.xmind');
    const { newId } = ctrl.addTopic('r', 'Nuovo blocco');
    ctrl.markSaved(undefined, 'hash');
    const dto = ctrl.setTopicTitle(newId, 'Rinominato', { mergeWithPrevious: true });
    expect(dto.dirty).toBe(true);
  });
});

describe('OpenWorkbook memoria della cronologia', () => {
  it('scarta i passi più vecchi oltre il tetto di memoria, mai lo stato corrente', () => {
    const wb = workbook();
    // Snapshot da ~30 milioni di caratteri: nel tetto di 64 Mi ne stanno al massimo due.
    const big = 'x'.repeat(30 * 1024 * 1024);
    for (const suffix of ['A', 'B', 'C', 'D']) edit(wb, big + suffix);
    expect(wb.history.length).toBeLessThanOrEqual(2);
    expect(wb.content[0].rootTopic!.title.endsWith('D')).toBe(true);
    wb.undo();
    expect(wb.content[0].rootTopic!.title.endsWith('C')).toBe(true);
    expect(wb.canUndo()).toBe(false);
  });
});
