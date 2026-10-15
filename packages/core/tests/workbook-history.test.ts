import { describe, expect, it } from 'vitest';
import { OpenWorkbook, Sheet } from '../src/index.js';

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
});
