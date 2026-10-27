import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  AppController,
  layoutSheets,
  readSheetTheme,
  setSheetTheme,
  Sheet,
  validateArchiveBytes,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

/** Tema come lo scrive XMind 26.x (estratto del tema "Dawn" della mappa demo). */
const dawnTheme = () => ({
  colorThemeId: 'Dawn-#ffffff-MULTI_LINE_COLORS',
  skeletonThemeId: '456ab570dafa3902b18f8ab397',
  map: {
    id: 'm',
    properties: {
      'color-list': '#FF6B6B #FF9F69 #97D3B6',
      'multi-line-colors': '#FF6B6B #FF9F69 #97D3B6',
      'line-tapered': 'none',
      'svg:fill': '#ffffff',
    },
  },
  centralTopic: {
    id: 'c',
    properties: {
      'fill-pattern': 'none',
      'svg:fill': '#000000',
      'fo:font-family': 'Nunito',
      'fo:font-size': '36pt',
      'fo:font-weight': '700',
      'line-class': 'org.xmind.branchConnection.roundedElbow',
      'line-width': '3pt',
      'shape-class': 'org.xmind.topicShape.roundedRect',
      'border-line-width': '3pt',
    },
  },
  mainTopic: {
    id: 'mt',
    properties: {
      'fill-pattern': 'solid',
      'svg:fill': 'inherited',
      'fo:color': 'inherited',
      'fo:font-size': '18pt',
      'fo:font-weight': '600',
      'line-width': 'inherited',
    },
  },
  subTopic: {
    id: 'st',
    properties: { 'fill-pattern': 'none', 'fo:font-size': '14pt', 'fo:font-weight': '400', 'line-width': '2pt' },
  },
  relationship: { id: 'r', properties: { 'shape-class': 'org.xmind.relationshipShape.zigzag' } },
  zone: { id: 'z', properties: { 'fo:font-size': '12' } },
});

const sheetWithTheme = (theme?: unknown): Sheet => ({
  id: 's1',
  class: 'sheet',
  title: 'Foglio',
  rootTopic: {
    id: 'r',
    class: 'topic',
    title: 'Radice',
    children: {
      attached: [
        { id: 'a', title: 'A', children: { attached: [{ id: 'a1', title: 'A1' }] } },
        { id: 'b', title: 'B' },
      ],
    },
  },
  ...(theme === undefined ? {} : { theme }),
});

describe('Tema del foglio: lettura', () => {
  it('legge colori dei rami, sfondo e stili dei livelli dal formato di XMind', () => {
    const theme = readSheetTheme(sheetWithTheme(dawnTheme()));
    expect(theme.branchColors).toEqual(['#FF6B6B', '#FF9F69', '#97D3B6']);
    expect(theme.background).toBe('#ffffff');
    // `fill-pattern: none` = nessun riempimento, anche con `svg:fill` esadecimale.
    expect(theme.levels.central).toEqual({
      fontFamily: 'Nunito',
      fontSizePt: 36,
      bold: true,
      shape: 'roundedRect',
      line: 'roundedElbow',
      lineWidthPt: 3,
    });
    // `inherited` non è un valore: il livello resta al default della vista.
    expect(theme.levels.main).toEqual({ fontSizePt: 18, bold: false });
    expect(theme.levels.sub).toEqual({ fontSizePt: 14, bold: false, lineWidthPt: 2 });
  });

  it('senza tema non inventa nulla', () => {
    expect(readSheetTheme(sheetWithTheme())).toEqual({ levels: { central: {}, main: {}, sub: {} } });
    expect(readSheetTheme(sheetWithTheme('rotto'))).toEqual({ levels: { central: {}, main: {}, sub: {} } });
  });

  it('ignora forme e linee che l’app non sa disegnare', () => {
    const theme = readSheetTheme(
      sheetWithTheme({
        mainTopic: {
          properties: {
            'shape-class': 'org.xmind.topicShape.cloud',
            'line-class': 'org.xmind.branchConnection.bight',
          },
        },
      })
    );
    expect(theme.levels.main).toEqual({});
  });
});

describe('Tema del foglio: modifica', () => {
  it('scrive solo le chiavi modificate e conserva sezioni e proprietà sconosciute', () => {
    const sheet = sheetWithTheme(dawnTheme());
    const changed = setSheetTheme(sheet, {
      branchColors: ['#112233', '#445566'],
      levels: {
        main: { fill: '#AABBCC', shape: 'rect', fontSizePt: 20 },
        sub: { line: 'straight', bold: true },
      },
    });
    expect(changed).toBe(true);
    const t = sheet.theme as ReturnType<typeof dawnTheme>;
    expect(t.colorThemeId).toBe('Dawn-#ffffff-MULTI_LINE_COLORS');
    expect(t.skeletonThemeId).toBe('456ab570dafa3902b18f8ab397');
    expect(t.relationship).toEqual(dawnTheme().relationship);
    expect(t.zone).toEqual(dawnTheme().zone);
    expect(t.map.properties).toEqual({
      'color-list': '#112233 #445566',
      'multi-line-colors': '#112233 #445566',
      'line-tapered': 'none',
      'svg:fill': '#ffffff',
    });
    expect(t.mainTopic).toEqual({
      id: 'mt',
      properties: {
        'fill-pattern': 'solid',
        'svg:fill': '#AABBCC',
        'fo:color': 'inherited',
        'fo:font-size': '20pt',
        'fo:font-weight': '600',
        'line-width': 'inherited',
        'shape-class': 'org.xmind.topicShape.rect',
      },
    });
    expect(t.subTopic.properties).toMatchObject({
      'fill-pattern': 'none',
      'fo:font-weight': '700',
      'line-class': 'org.xmind.branchConnection.straight',
    });
    expect(t.centralTopic).toEqual(dawnTheme().centralTopic);
  });

  it('null riporta il livello al default del tema', () => {
    const sheet = sheetWithTheme(dawnTheme());
    setSheetTheme(sheet, {
      background: null,
      levels: { central: { fontSizePt: null, shape: null, line: null }, main: { fill: null, textColor: null } },
    });
    const t = sheet.theme as ReturnType<typeof dawnTheme>;
    expect(t.map.properties['svg:fill']).toBeUndefined();
    expect(t.centralTopic.properties['fo:font-size']).toBeUndefined();
    expect(t.centralTopic.properties['shape-class']).toBeUndefined();
    expect(t.centralTopic.properties['line-class']).toBeUndefined();
    expect(t.centralTopic.properties['border-line-width']).toBe('3pt');
    expect(t.mainTopic.properties['svg:fill']).toBe('inherited');
    expect(t.mainTopic.properties['fo:color']).toBe('inherited');
  });

  it('crea tema e sezioni mancanti con un id, come XMind', () => {
    const sheet = sheetWithTheme();
    setSheetTheme(sheet, { levels: { central: { fill: '#123456' } } });
    const t = sheet.theme as Record<string, { id: unknown; properties: Record<string, unknown> }>;
    expect(typeof t.centralTopic.id).toBe('string');
    expect(t.centralTopic.properties).toEqual({ 'svg:fill': '#123456', 'fill-pattern': 'solid' });
    expect(readSheetTheme(sheet).levels.central.fill).toBe('#123456');
  });

  it('un valore non valido non tocca il foglio', () => {
    const sheet = sheetWithTheme(dawnTheme());
    const before = JSON.stringify(sheet);
    expect(() =>
      setSheetTheme(sheet, { branchColors: ['#112233'], levels: { main: { fill: 'rosso' } } })
    ).toThrow(/Riempimento/);
    expect(() => setSheetTheme(sheet, { levels: { sub: { fontSizePt: -2 } } })).toThrow();
    expect(JSON.stringify(sheet)).toBe(before);
  });

  it('una modifica che non cambia nulla non lo segnala', () => {
    const sheet = sheetWithTheme(dawnTheme());
    expect(setSheetTheme(sheet, { levels: { central: { fontSizePt: 36 } } })).toBe(false);
  });
});

describe('Tema del foglio: vista e round-trip', () => {
  it('il layout usa i colori dei rami, i font e le linee del tema', async () => {
    const ctrl = new AppController();
    const dto = await ctrl.open(await minimalXmind([sheetWithTheme(dawnTheme())]));
    const layout = layoutSheets(dto.sheets);
    const node = (id: string) => layout.nodes.find((n) => n.id === id);
    expect(node('a')?.accent).toBe('#FF6B6B');
    expect(node('b')?.accent).toBe('#FF9F69');
    // 36pt = 36px; il blocco ne tiene conto.
    expect(node('r')?.textStyle).toEqual({ fontSizePx: 36, bold: true });
    expect(node('r')?.fontFamily).toBe('Nunito');
    expect(node('r')?.branchLine).toBe('roundedElbow');
    expect(node('r')?.branchLineWidth).toBe(4);
    expect(node('a1')?.textStyle).toEqual({ fontSizePx: 14, bold: false });
    expect(node('r')!.h).toBeGreaterThan(node('a')!.h);
  });

  it('lo stile del blocco vince su quello del tema', async () => {
    const sheet = sheetWithTheme(dawnTheme());
    sheet.rootTopic!.children!.attached![0].style = { id: 'x', properties: { 'fo:font-size': '9pt', 'svg:fill': '#00FF00' } };
    const ctrl = new AppController();
    const dto = await ctrl.open(await minimalXmind([sheet]));
    const a = layoutSheets(dto.sheets).nodes.find((n) => n.id === 'a');
    expect(a?.textStyle?.fontSizePx).toBe(12);
    expect(a?.fill).toBe('#00FF00');
  });

  it('controller: un passo di undo per modifica e il file salvato riapre lo stesso tema', async () => {
    const ctrl = new AppController();
    await ctrl.open(await minimalXmind([sheetWithTheme(dawnTheme())]));
    const dto = ctrl.setSheetTheme(0, { branchColors: ['#010203', '#040506'], levels: { sub: { shape: 'underline' } } });
    expect(dto.dirty).toBe(true);
    expect(dto.sheets[0].theme?.branchColors).toEqual(['#010203', '#040506']);
    expect(dto.sheets[0].theme?.levels.sub.shape).toBe('underline');

    expect(() => ctrl.setSheetTheme(0, { background: 'blu' })).toThrow(/Sfondo/);
    expect(() => ctrl.setSheetTheme(3, { background: null })).toThrow(/Foglio 4/);

    const { bytes } = await ctrl.prepareArchiveBytes();
    await expect(validateArchiveBytes(bytes)).resolves.toBeTruthy();
    const content = JSON.parse(await (await JSZip.loadAsync(bytes)).file('content.json')!.async('string'));
    expect(content[0].theme.colorThemeId).toBe('Dawn-#ffffff-MULTI_LINE_COLORS');
    expect(content[0].theme.relationship).toEqual(dawnTheme().relationship);

    const reopened = new AppController();
    const again = await reopened.open(bytes);
    expect(again.sheets[0].theme).toEqual(dto.sheets[0].theme);

    const undone = ctrl.undo();
    expect(undone.sheets[0].theme?.branchColors).toEqual(['#FF6B6B', '#FF9F69', '#97D3B6']);
    expect(undone.sheets[0].theme?.levels.sub.shape).toBeUndefined();
  });
});
