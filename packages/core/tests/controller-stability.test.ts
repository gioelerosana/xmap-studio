import { describe, expect, it } from 'vitest';
import { AppController } from '../src/index.js';
import { minimalXmind } from './helpers.js';

async function opened(): Promise<AppController> {
  const ctrl = new AppController();
  await ctrl.open(await minimalXmind(), null, 'x.xmind');
  return ctrl;
}

describe('stabilità del controller', () => {
  it('incollare in un altro file un blocco con allegato porta con sé l’allegato', async () => {
    const source = await opened();
    source.attachFileToTopic('a', 'note.txt', new TextEncoder().encode('ciao'));
    const payload = source.copyTopic('a');

    const target = await opened();
    const { newId } = target.pasteTopic('r', payload);
    const pasted = target.workbook()!.sheets[0].topics.find((t) => t.id === newId);
    expect(pasted?.href).toMatch(/^xap:attachments\//);

    // Prima della correzione la validazione falliva: riferimento ad allegato assente dallo ZIP.
    const { bytes } = await target.prepareArchiveBytes();
    const reopened = new AppController();
    await reopened.open(bytes, null, 'y.xmind');
    expect(reopened.resourceBytes(pasted!.href!.slice('xap:'.length))).not.toBeNull();
  });

  it('una formula il cui blocco sparisce durante il rendering dà errore invece di perdersi', async () => {
    const ctrl = await opened();
    const pending = ctrl.apply('a', 'x^2');
    ctrl.removeTopic('a');
    await expect(pending).rejects.toThrow(/cambiata/);
  });

  it('una formula applicata senza interferenze resta nella mappa', async () => {
    const ctrl = await opened();
    const dto = await ctrl.apply('a', 'x^2');
    expect(dto.sheets[0].topics.find((t) => t.id === 'a')?.latex).toBe('x^2');
  });
});
