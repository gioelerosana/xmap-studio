import { describe, expect, it } from 'vitest';
import {
  AppController,
  CODE_INVALID_INPUT,
  errorCode,
  readArchive,
  Sheet,
  validateArchiveBytes,
  WorkbookDto,
  XmapError,
} from '../src/index.js';
import { cloneSheet, createSheet, nextSheetTitle, NEW_SHEET_ROOT_TITLE } from '../src/model/sheets.js';
import { minimalXmind } from './helpers.js';

/** Indice di foglio che non esiste in nessuna delle mappe usate nei test. */
const INDICE_INESISTENTE = 9;
/** Indice dell'ultimo foglio in una mappa di tre fogli. */
const ULTIMO_DI_TRE = 2;
/** Indice di "Gamma" dopo add e duplicate in una mappa a quattro fogli. */
const INDICE_GAMMA = 3;
const PRIMA_DELL_INIZIO = -4;
const DOPO_LA_FINE = 99;

/** Foglio con radice, due figli, una relazione e campi sconosciuti (`custom`) su foglio, blocco e relazione. */
function sheetFixture(id: string, title: string): Record<string, unknown> {
  return {
    id,
    class: 'sheet',
    title,
    custom: { origine: id },
    rootTopic: {
      id: `${id}-r`,
      class: 'topic',
      title: `Radice ${title}`,
      custom: 'blocco',
      children: {
        attached: [
          { id: `${id}-a`, title: 'A' },
          { id: `${id}-b`, title: 'B' },
        ],
      },
    },
    relationships: [{ id: `${id}-rel`, end1Id: `${id}-a`, end2Id: `${id}-b`, title: 'collega', custom: 1 }],
  };
}

async function openSheets(titles: string[]): Promise<{ c: AppController; dto: WorkbookDto }> {
  const c = new AppController();
  const dto = await c.open(await minimalXmind(titles.map((title, i) => sheetFixture(`s${i + 1}`, title))));
  return { c, dto };
}

/** Codice dell'errore lanciato da `fn`, o `undefined` se non lancia. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return errorCode(err);
  }
  return undefined;
}

function titlesOf(dto: WorkbookDto): string[] {
  return dto.sheets.map((s) => s.title);
}

async function contentOf(bytes: Uint8Array): Promise<Sheet[]> {
  const archive = await readArchive(bytes);
  const raw = archive.entries.get('content.json');
  if (!raw) throw new Error('content.json assente');
  return JSON.parse(new TextDecoder().decode(raw)) as Sheet[];
}

/** Tutti i valori della chiave `id` nel sottoalbero. */
function collectIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectIds(item));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(key === 'id' && typeof child === 'string' ? [child] : []),
    ...collectIds(child),
  ]);
}

describe('createSheet e nextSheetTitle', () => {
  it('createSheet crea un foglio vuoto con un solo blocco centrale e id nuovi', () => {
    const a = createSheet('Uno');
    const b = createSheet('Uno');
    expect(a.title).toBe('Uno');
    expect(a.class).toBe('sheet');
    expect(a.rootTopic?.title).toBe(NEW_SHEET_ROOT_TITLE);
    expect(a.rootTopic?.children).toBeUndefined();
    expect(a.id).not.toBe(b.id);
    expect(a.rootTopic?.id).not.toBe(b.rootTopic?.id);
  });

  it('nextSheetTitle usa "Foglio N" con N = numero dei fogli + 1', () => {
    expect(nextSheetTitle([createSheet('Foglio')])).toBe('Foglio 2');
  });

  it('nextSheetTitle salta i titoli già usati', () => {
    expect(nextSheetTitle([createSheet('Foglio'), createSheet('Foglio 3')])).toBe('Foglio 4');
  });

  it('cloneSheet rigenera tutti gli id e preserva i campi sconosciuti', () => {
    const original = sheetFixture('s1', 'Alfa') as Sheet;
    const copy = cloneSheet(original, 'Alfa bis');
    expect(copy.title).toBe('Alfa bis');
    expect(copy.custom).toEqual({ origine: 's1' });
    expect(copy.id).not.toBe(original.id);
    expect(original.title).toBe('Alfa');
  });
});

describe('addSheet', () => {
  it('senza titolo aggiunge "Foglio 2" in fondo, con un blocco centrale', async () => {
    const { c } = await openSheets(['Alfa']);
    const dto = c.addSheet();
    expect(titlesOf(dto)).toEqual(['Alfa', 'Foglio 2']);
    expect(dto.sheets[1]?.topics.map((t) => t.title)).toEqual([NEW_SHEET_ROOT_TITLE]);
    expect(dto.canUndo).toBe(true);
  });

  it('con titolo usa il titolo indicato, senza spazi ai bordi', async () => {
    const { c } = await openSheets(['Alfa']);
    const dto = c.addSheet('  Note  ');
    expect(titlesOf(dto)).toEqual(['Alfa', 'Note']);
  });

  it('con atIndex inserisce il foglio nella posizione richiesta', async () => {
    const { c } = await openSheets(['Alfa', 'Beta']);
    const dto = c.addSheet('Gamma', 1);
    expect(titlesOf(dto)).toEqual(['Alfa', 'Gamma', 'Beta']);
  });

  it('atIndex fuori range viene limitato a inizio o fine', async () => {
    const { c } = await openSheets(['Alfa', 'Beta']);
    expect(titlesOf(c.addSheet('Inizio', PRIMA_DELL_INIZIO))).toEqual(['Inizio', 'Alfa', 'Beta']);
    expect(titlesOf(c.addSheet('Fine', DOPO_LA_FINE))).toEqual(['Inizio', 'Alfa', 'Beta', 'Fine']);
  });

  it('senza titolo evita le collisioni con i titoli già presenti', async () => {
    const { c } = await openSheets(['Foglio', 'Foglio 3']);
    const dto = c.addSheet();
    expect(titlesOf(dto)).toEqual(['Foglio', 'Foglio 3', 'Foglio 4']);
  });

  it('annullabile con undo', async () => {
    const { c, dto: before } = await openSheets(['Alfa']);
    c.addSheet('Beta');
    const after = c.undo();
    expect(after.sheets).toEqual(before.sheets);
    expect(after.canRedo).toBe(true);
  });
});

describe('renameSheet', () => {
  it('cambia il titolo della linguetta', async () => {
    const { c } = await openSheets(['Alfa', 'Beta']);
    const dto = c.renameSheet(1, 'Gamma');
    expect(dto.sheets.map((s) => s.title)).toEqual(['Alfa', 'Gamma']);
  });

  it('elimina gli spazi ai bordi del nuovo titolo', async () => {
    const { c } = await openSheets(['Alfa']);
    expect(c.renameSheet(0, '  Nuovo  ').sheets[0]?.title).toBe('Nuovo');
  });

  it('titolo vuoto o di soli spazi lancia XmapError e non modifica nulla', async () => {
    const { c, dto: before } = await openSheets(['Alfa']);
    expect(() => c.renameSheet(0, '')).toThrow(XmapError);
    expect(codeOf(() => c.renameSheet(0, '   '))).toBe(CODE_INVALID_INPUT);
    expect(c.workbook()).toEqual(before);
  });

  it('titolo invariato non crea un passo di annullamento', async () => {
    const { c, dto: before } = await openSheets(['Alfa']);
    const dto = c.renameSheet(0, 'Alfa');
    expect(dto.canUndo).toBe(false);
    expect(dto).toEqual(before);
  });

  it('indice inesistente lancia XmapError', async () => {
    const { c } = await openSheets(['Alfa']);
    expect(codeOf(() => c.renameSheet(INDICE_INESISTENTE, 'Nuovo'))).toBe(CODE_INVALID_INPUT);
  });

  it('la rinomina si annulla e si ripete con redo', async () => {
    const { c } = await openSheets(['Alfa']);
    c.renameSheet(0, 'Beta');
    expect(c.undo().sheets[0]?.title).toBe('Alfa');
    expect(c.redo().sheets[0]?.title).toBe('Beta');
  });
});

describe('duplicateSheet', () => {
  it('copia il foglio subito dopo l\'originale con titolo "<titolo> (copia)"', async () => {
    const { c } = await openSheets(['Alfa', 'Beta']);
    const dto = c.duplicateSheet(0);
    expect(titlesOf(dto)).toEqual(['Alfa', 'Alfa (copia)', 'Beta']);
  });

  it('la copia ha tutti gli id (foglio, blocchi, relazioni) diversi dall\'originale', async () => {
    const { c } = await openSheets(['Alfa']);
    c.duplicateSheet(0);
    const content = await contentOf(await c.prepareArchiveBytes().then((r) => r.bytes));
    const originalIds = collectIds(content[0]);
    const copyIds = collectIds(content[1]);
    expect(copyIds).toHaveLength(originalIds.length);
    expect(copyIds.filter((id) => originalIds.includes(id))).toEqual([]);
  });

  it('le relazioni della copia puntano ai blocchi della copia', async () => {
    const { c } = await openSheets(['Alfa']);
    const dto = c.duplicateSheet(0);
    const [original, copy] = dto.sheets;
    const copyTopicIds = copy?.topics.map((t) => t.id) ?? [];
    const rel = copy?.relationships[0];
    expect(copy?.relationships).toHaveLength(1);
    expect(copyTopicIds).toContain(rel?.end1Id);
    expect(copyTopicIds).toContain(rel?.end2Id);
    expect(original?.relationships[0]?.end1Id).toBe('s1-a');
    expect(rel?.id).not.toBe(original?.relationships[0]?.id);
  });

  it('i campi sconosciuti di foglio, blocco e relazione sopravvivono nella copia', async () => {
    const { c } = await openSheets(['Alfa']);
    c.duplicateSheet(0);
    const content = await contentOf((await c.prepareArchiveBytes()).bytes);
    const copy = content[1];
    expect(copy?.custom).toEqual({ origine: 's1' });
    expect(copy?.rootTopic?.custom).toBe('blocco');
    expect(copy?.relationships?.[0]?.custom).toBe(1);
  });

  it('l\'originale resta intatto', async () => {
    const { c, dto: before } = await openSheets(['Alfa']);
    const after = c.duplicateSheet(0);
    expect(after.sheets[0]).toEqual(before.sheets[0]);
  });

  it('annullabile con undo', async () => {
    const { c, dto: before } = await openSheets(['Alfa', 'Beta']);
    c.duplicateSheet(0);
    expect(c.undo().sheets).toEqual(before.sheets);
  });

  it('indice inesistente lancia XmapError', async () => {
    const { c } = await openSheets(['Alfa']);
    expect(codeOf(() => c.duplicateSheet(INDICE_INESISTENTE))).toBe(CODE_INVALID_INPUT);
  });
});

describe('deleteSheet', () => {
  it('elimina il foglio indicato', async () => {
    const { c } = await openSheets(['Alfa', 'Beta', 'Gamma']);
    const dto = c.deleteSheet(1);
    expect(titlesOf(dto)).toEqual(['Alfa', 'Gamma']);
  });

  it('non elimina l\'ultimo foglio rimasto: lancia errore e non modifica nulla', async () => {
    const { c, dto: before } = await openSheets(['Alfa']);
    expect(codeOf(() => c.deleteSheet(0))).toBe(CODE_INVALID_INPUT);
    expect(c.workbook()).toEqual(before);
  });

  it('indice inesistente lancia XmapError', async () => {
    const { c } = await openSheets(['Alfa', 'Beta']);
    expect(codeOf(() => c.deleteSheet(INDICE_INESISTENTE))).toBe(CODE_INVALID_INPUT);
  });

  it('undo ripristina il foglio nella sua posizione', async () => {
    const { c, dto: before } = await openSheets(['Alfa', 'Beta', 'Gamma']);
    c.deleteSheet(1);
    const restored = c.undo();
    expect(restored.sheets).toEqual(before.sheets);
    expect(titlesOf(restored)).toEqual(['Alfa', 'Beta', 'Gamma']);
  });
});

describe('moveSheet', () => {
  it('sposta il foglio in avanti: l\'indice di destinazione è la posizione finale', async () => {
    const { c } = await openSheets(['Alfa', 'Beta', 'Gamma']);
    expect(titlesOf(c.moveSheet(0, ULTIMO_DI_TRE))).toEqual(['Beta', 'Gamma', 'Alfa']);
  });

  it('sposta il foglio indietro', async () => {
    const { c } = await openSheets(['Alfa', 'Beta', 'Gamma']);
    expect(titlesOf(c.moveSheet(ULTIMO_DI_TRE, 0))).toEqual(['Gamma', 'Alfa', 'Beta']);
  });

  it('from uguale a to è un no-op senza passo di annullamento', async () => {
    const { c, dto: before } = await openSheets(['Alfa', 'Beta']);
    const dto = c.moveSheet(1, 1);
    expect(dto).toEqual(before);
    expect(dto.canUndo).toBe(false);
  });

  it('indici fuori range lanciano XmapError', async () => {
    const { c, dto: before } = await openSheets(['Alfa', 'Beta', 'Gamma']);
    expect(codeOf(() => c.moveSheet(0, INDICE_INESISTENTE))).toBe(CODE_INVALID_INPUT);
    expect(codeOf(() => c.moveSheet(-1, 0))).toBe(CODE_INVALID_INPUT);
    expect(c.workbook()).toEqual(before);
  });

  it('undo e redo riportano l\'ordine prima e dopo lo spostamento', async () => {
    const { c, dto: before } = await openSheets(['Alfa', 'Beta', 'Gamma']);
    const moved = c.moveSheet(0, ULTIMO_DI_TRE);
    expect(c.undo().sheets).toEqual(before.sheets);
    expect(c.redo().sheets).toEqual(moved.sheets);
  });
});

describe('salvataggio dopo le operazioni sui fogli', () => {
  it('add, duplicate e move producono un archivio valido che si riapre con lo stesso ordine e contenuto', async () => {
    const { c } = await openSheets(['Alfa', 'Beta']);
    c.addSheet('Gamma');
    c.duplicateSheet(0);
    const edited = c.moveSheet(INDICE_GAMMA, 0);
    expect(titlesOf(edited)).toEqual(['Gamma', 'Alfa', 'Alfa (copia)', 'Beta']);

    const { bytes, validation } = await c.prepareArchiveBytes();
    expect(validation.entries).toBeGreaterThan(0);
    await expect(validateArchiveBytes(bytes)).resolves.toBeDefined();

    const reopened = new AppController();
    const dto = await reopened.open(bytes);
    expect(titlesOf(dto)).toEqual(['Gamma', 'Alfa', 'Alfa (copia)', 'Beta']);
    expect(dto.sheets.map((s) => s.id)).toEqual(edited.sheets.map((s) => s.id));
    expect(dto.sheets.map((s) => s.topics.length)).toEqual(edited.sheets.map((s) => s.topics.length));

    const content = await contentOf(bytes);
    expect(content[1]?.custom).toEqual({ origine: 's1' });
    expect(content[1]?.rootTopic?.custom).toBe('blocco');
  });
});
