import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AppController,
  findTopic,
  OpenWorkbook,
  sha256Hex,
  sheetIndexOf,
  walkTopic,
  type Sheet,
  type Topic,
  type WorkbookDto,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';
import { syntheticSheet } from './perf-core-fixtures.js';

/**
 * Le ottimizzazioni di prestazioni non devono cambiare i risultati: qui si
 * confrontano con il calcolo di riferimento (senza cache, o con node:crypto).
 */

/** Il workbook interno del controller, per confrontarlo con uno ricostruito da zero. */
function liveWorkbook(c: AppController): OpenWorkbook {
  const wb = (c as unknown as { currentWorkbook: OpenWorkbook | null }).currentWorkbook;
  if (!wb) throw new Error('nessun workbook aperto');
  return wb;
}

/** DTO dei fogli costruiti da zero dal contenuto corrente, senza nessuna cache. */
function freshSheets(c: AppController): WorkbookDto['sheets'] {
  const wb = liveWorkbook(c);
  return new OpenWorkbook(null, 'x.xmind', wb.archive, wb.content).toDto().sheets;
}

describe('sha256Hex (JS puro a blocchi)', () => {
  it('coincide con node:crypto su tutte le lunghezze attorno ai bordi dei blocchi', () => {
    for (let len = 0; len <= 260; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 31 + len * 7) & 0xff;
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('coincide con node:crypto su dati grandi e su stringhe UTF-8', () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 17);
    for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
    expect(sha256Hex(big)).toBe(createHash('sha256').update(big).digest('hex'));
    const text = 'Mappa — π ≈ 3.14 ✓';
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    // Vettore noto (FIPS 180-2): "abc".
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('findTopic / sheetIndexOf con uscita anticipata', () => {
  it('trovano lo stesso topic della visita completa, anche con id ripetuti', () => {
    const sheets = [syntheticSheet(60, 'x'), syntheticSheet(40, 'y')] as Sheet[];
    // Id ripetuto: vince il primo in pre-ordine, come prima.
    const dupA = { id: 'dup', title: 'primo' };
    const dupB = { id: 'dup', title: 'secondo' };
    sheets[0].rootTopic?.children?.attached?.[1]?.children?.attached?.push(dupA);
    sheets[0].rootTopic?.children?.attached?.[3]?.children?.attached?.push(dupB);
    sheets[1].rootTopic?.children?.attached?.push({ id: 'det', title: 'd', children: { detached: [{ id: 'free' }] } });
    const reference = (id: string): Topic | undefined => {
      let found: Topic | undefined;
      for (const sheet of sheets) {
        if (!sheet.rootTopic || found) continue;
        walkTopic(sheet.rootTopic, (t) => {
          if (!found && t.id === id) found = t;
        });
      }
      return found;
    };
    for (const id of ['x-t0', 'x-t59', 'y-t0', 'y-t39', 'dup', 'free', 'manca']) {
      expect(findTopic(sheets, id)).toBe(reference(id));
    }
    expect(findTopic(sheets, 'dup')).toBe(dupA);
    expect(sheetIndexOf(sheets, 'free')).toBe(1);
    expect(sheetIndexOf(sheets, 'x-t10')).toBe(0);
    expect(sheetIndexOf(sheets, 'manca')).toBe(-1);
  });
});

describe('cronologia per foglio e cache dei DTO', () => {
  async function openThreeSheets(): Promise<AppController> {
    const c = new AppController();
    await c.open(await minimalXmind([syntheticSheet(120, 'a'), syntheticSheet(80, 'b'), syntheticSheet(60, 'c')]));
    return c;
  }

  it('dopo ogni operazione i DTO coincidono con quelli ricostruiti da zero', async () => {
    const c = await openThreeSheets();
    const states: string[] = [];
    const check = (dto: WorkbookDto): void => {
      expect(dto.sheets).toEqual(freshSheets(c));
      expect(c.workbook()?.sheets).toEqual(dto.sheets);
    };
    const snapshot = (): string => JSON.stringify(liveWorkbook(c).content);
    states.push(snapshot());

    const ops: Array<() => WorkbookDto> = [
      () => c.setTopicTitle('a-t5', 'Rinominato $x^2$'),
      () => c.setTopicColor('b-t3', '#336699'),
      () => c.addTopic('c-t2', 'Nuovo').dto,
      () => c.setTopicNotes('a-t7', 'nota nuova'),
      () => c.moveTopic('a-t9', 'a-t1', 'into'),
      () => c.toggleTopicMarker('b-t4', 'priority-2'),
      () => c.removeTopic('c-t5'),
      () => c.setSheetTheme(1, { background: '#ffeedd' }),
      () => c.renameSheet(2, 'Terzo'),
      () => c.moveSheet(0, 2),
      () => c.duplicateSheet(1),
      () => c.deleteSheet(0),
      () => c.addSheet('Vuoto'),
      () => c.setTopicFolded('a-t1', true),
    ];
    for (const op of ops) {
      check(op());
      states.push(snapshot());
    }
    // Undo fino all'apertura: ogni passo ritrova esattamente lo stato di prima.
    for (let i = states.length - 2; i >= 0; i--) {
      check(c.undo());
      expect(snapshot()).toBe(states[i]);
    }
    expect(c.workbook()?.canUndo).toBe(false);
    // Redo fino in fondo.
    for (let i = 1; i < states.length; i++) {
      check(c.redo());
      expect(snapshot()).toBe(states[i]);
    }
  });

  it('i fogli non toccati e le chiamate senza modifiche riusano lo stesso DTO', async () => {
    const c = await openThreeSheets();
    const before = c.workbook();
    if (!before) throw new Error('workbook mancante');
    // Nessuna modifica (salvataggio): stesso array di fogli.
    expect(c.markSaved(undefined, 'hash').sheets).toBe(before.sheets);
    expect(c.workbook()?.sheets).toBe(before.sheets);

    const edited = c.setTopicTitle('b-t2', 'Solo il secondo foglio');
    expect(edited.sheets).not.toBe(before.sheets);
    expect(edited.sheets[0]).toBe(before.sheets[0]);
    expect(edited.sheets[1]).not.toBe(before.sheets[1]);
    expect(edited.sheets[2]).toBe(before.sheets[2]);

    // Undo: il foglio toccato torna uguale (non lo stesso oggetto), gli altri restano condivisi.
    const undone = c.undo();
    expect(undone.sheets[0]).toBe(before.sheets[0]);
    expect(undone.sheets[2]).toBe(before.sheets[2]);
    expect(undone.sheets[1]).toEqual(before.sheets[1]);
  });

  it('la cronologia condivide le stringhe dei fogli invariati', async () => {
    const c = await openThreeSheets();
    c.setTopicTitle('a-t1', 'X');
    const wb = liveWorkbook(c);
    const [first, second] = wb.history;
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
    // Lo stesso contenuto serializzato come un unico array resta quello di prima.
    expect(`[${second.join(',')}]`).toBe(JSON.stringify(wb.content));
  });

  it('il contenuto passato al costruttore viene copiato come prima', () => {
    const sheets: Sheet[] = [{ id: 's', rootTopic: { id: 'r', title: 'R', extra: { keep: [1, { a: null }] } } }];
    const wb = new OpenWorkbook(null, 'x.xmind', { entries: new Map(), resources: new Map() }, sheets);
    expect(wb.content).toEqual(sheets);
    expect(wb.content[0]).not.toBe(sheets[0]);
  });
});

describe('misure dei blocchi e arrivo di MathJax', () => {
  it('dopo il caricamento il layout coincide con quello a cache vuota e il testo semplice non si rimisura', async () => {
    vi.resetModules();
    const mj = await import('../src/latex/mathjax.js');
    const layout = await import('../src/layout/layout.js');
    const state = await import('../src/state/workbook.js');
    const sheet = syntheticSheet(150, 'm') as Sheet;
    const dto = new state.OpenWorkbook(null, 'x', { entries: new Map(), resources: new Map() }, [sheet]).toDto();
    const sheetDto = dto.sheets[0];

    const measured: string[] = [];
    layout.setTextMeasurer((text, size, bold) => {
      measured.push(text);
      return text.length * size * (bold ? 0.6 : 0.5);
    });
    const run = () => layout.layoutSheets([sheetDto], new Set(), undefined, layout.DEFAULT_LAYOUT_OPTS);
    run();
    // MathJax arriva: si invalidano solo le misure con formule.
    await mj.loadMathJax();
    measured.length = 0;
    const afterReady = run();
    const plainTitles = sheetDto.topics.filter((t) => !t.title.includes('$')).map((t) => t.title);
    expect(plainTitles.length).toBeGreaterThan(0);
    for (const title of plainTitles) {
      for (const word of title.split(' ')) expect(measured).not.toContain(word);
    }
    // Riferimento: tutte le misure da capo (setTextMeasurer svuota ogni cache).
    layout.setTextMeasurer((text, size, bold) => text.length * size * (bold ? 0.6 : 0.5));
    expect(afterReady).toEqual(run());
    layout.setTextMeasurer(null);
  });
});
