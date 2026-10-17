import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELATIONSHIP_STYLE,
  readControlPoints,
  resolveRelationshipStyle,
  setRelationshipControlPoint,
  setRelationshipShape,
} from '../src/model/relationship.js';
import {
  dragHandle,
  handleToControlPoint,
  relationshipGeometry,
  type Rect,
} from '../src/layout/relationship.js';
import type { Point, RelationshipShape, RelationshipStyle } from '../src/state/types.js';
import type { Sheet } from '../src/model/types.js';

const theme = {
  relationship: {
    id: 't',
    properties: {
      'shape-class': 'org.xmind.relationshipShape.zigzag',
      'line-pattern': 'dash',
      'line-width': '3',
      'line-color': '#00000066',
      'arrow-begin-class': 'org.xmind.arrowShape.none',
      'arrow-end-class': 'org.xmind.arrowShape.triangle',
    },
  },
};

function sheetWith(rel: Record<string, unknown>, t: unknown = theme): Sheet {
  return { id: 's', theme: t, relationships: [{ id: 'r1', end1Id: 'a', end2Id: 'b', ...rel }] };
}

function firstRel(sheet: Sheet) {
  const rel = sheet.relationships?.[0];
  if (!rel) throw new Error('relazione assente');
  return rel;
}

describe('stile delle relazioni', () => {
  it('legge il tema', () => {
    const sheet = sheetWith({});
    expect(resolveRelationshipStyle(sheet, firstRel(sheet))).toEqual({
      shape: 'zigzag',
      linePattern: 'dash',
      lineWidth: 3,
      lineColor: '#00000066',
      arrowBegin: 'none',
      arrowEnd: 'triangle',
    });
  });

  it('le proprietà della relazione vincono sul tema', () => {
    const sheet = sheetWith({
      style: {
        id: 'x',
        properties: {
          'shape-class': 'org.xmind.relationshipShape.angled',
          'arrow-begin-class': 'org.xmind.arrowShape.dot',
        },
      },
    });
    const st = resolveRelationshipStyle(sheet, firstRel(sheet));
    expect(st.shape).toBe('angled');
    expect(st.arrowBegin).toBe('dot');
    expect(st.lineWidth).toBe(3);
  });

  it('ricade sul default con valori sconosciuti o assenti', () => {
    const sheet = sheetWith(
      { style: { properties: { 'shape-class': 'boh', 'line-width': 'x' } } },
      {
        relationship: {
          properties: { 'line-pattern': 'wavy', 'arrow-end-class': 'org.xmind.arrowShape.zzz' },
        },
      }
    );
    expect(resolveRelationshipStyle(sheet, firstRel(sheet))).toEqual(DEFAULT_RELATIONSHIP_STYLE);
    const bare: Sheet = { relationships: [{ id: 'r' }] };
    expect(resolveRelationshipStyle(bare, firstRel(bare))).toEqual(DEFAULT_RELATIONSHIP_STYLE);
  });

  it('mappa le varianti flexible alla forma base', () => {
    const sheet = sheetWith({
      style: { properties: { 'shape-class': 'org.xmind.relationshipShape.flexible.zigzag' } },
    });
    expect(resolveRelationshipStyle(sheet, firstRel(sheet)).shape).toBe('zigzag');
  });
});

describe('scrittura dei punti di controllo', () => {
  it('legge solo valori cartesiani', () => {
    expect(readControlPoints({ controlPoints: { 0: { x: 1, y: 2 } } })).toEqual([
      { x: 1, y: 2 },
      undefined,
    ]);
    expect(readControlPoints({ controlPoints: { 0: { angle: 1, amount: 0.3 } } })).toBeUndefined();
    expect(readControlPoints({})).toBeUndefined();
  });

  it('imposta e rimuove conservando le chiavi sconosciute', () => {
    const sheet = sheetWith({
      custom: 42,
      controlPoints: { 0: { x: 1, y: 1 }, 1: { x: 2, y: 2 }, extra: 'k' },
      lineEndPoints: { 0: { x: 9, y: 9 }, 1: { x: 8, y: 8 } },
    });
    const rel = firstRel(sheet);
    expect(setRelationshipControlPoint(sheet, 'r1', 0, { x: 10, y: -5 })).toBe(true);
    expect(rel.controlPoints).toEqual({ 0: { x: 10, y: -5 }, 1: { x: 2, y: 2 }, extra: 'k' });
    expect(rel.lineEndPoints).toEqual({ 1: { x: 8, y: 8 } });
    expect(rel.custom).toBe(42);

    expect(setRelationshipControlPoint(sheet, 'r1', 1, null)).toBe(true);
    expect(rel.controlPoints).toEqual({ 0: { x: 10, y: -5 }, extra: 'k' });
    expect(rel.lineEndPoints).toBeUndefined();
  });

  it("crea controlPoints se manca e rimuove l'oggetto vuoto", () => {
    const sheet = sheetWith({});
    const rel = firstRel(sheet);
    setRelationshipControlPoint(sheet, 'r1', 1, { x: 3, y: 4 });
    expect(rel.controlPoints).toEqual({ 1: { x: 3, y: 4 } });
    setRelationshipControlPoint(sheet, 'r1', 1, null);
    expect(rel.controlPoints).toBeUndefined();
    expect(setRelationshipControlPoint(sheet, 'nope', 0, null)).toBe(false);
  });

  it('sostituisce un punto polare con uno cartesiano', () => {
    const sheet = sheetWith({ controlPoints: { 0: { angle: 1, amount: 0.5 } } });
    setRelationshipControlPoint(sheet, 'r1', 0, { x: 1, y: 2 });
    expect(firstRel(sheet).controlPoints).toEqual({ 0: { x: 1, y: 2 } });
  });

  it('setRelationshipShape crea lo stile e conserva le altre chiavi', () => {
    const sheet = sheetWith({});
    expect(setRelationshipShape(sheet, 'r1', 'angled')).toBe(true);
    const style = firstRel(sheet).style as { id: string; properties: Record<string, string> };
    expect(style.id).toBeTruthy();
    expect(style.properties['shape-class']).toBe('org.xmind.relationshipShape.angled');

    const s2 = sheetWith({ style: { id: 'keep', foo: 1, properties: { 'line-width': '4' } } });
    setRelationshipShape(s2, 'r1', 'curved');
    expect(firstRel(s2).style).toEqual({
      id: 'keep',
      foo: 1,
      properties: { 'line-width': '4', 'shape-class': 'org.xmind.relationshipShape.curved' },
    });
    expect(setRelationshipShape(s2, 'nope', 'curved')).toBe(false);
  });
});

const A: Rect = { x: 0, y: 0, w: 163, h: 40 };
const B: Rect = { x: 400, y: 300, w: 120, h: 40 };

function style(shape: RelationshipShape): RelationshipStyle {
  return { ...DEFAULT_RELATIONSHIP_STYLE, shape };
}

function onBorder(p: Point, r: Rect): boolean {
  const inX = p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6;
  const inY = p.y >= r.y - 1e-6 && p.y <= r.y + r.h + 1e-6;
  const edge =
    Math.abs(p.x - r.x) < 1e-6 ||
    Math.abs(p.x - (r.x + r.w)) < 1e-6 ||
    Math.abs(p.y - r.y) < 1e-6 ||
    Math.abs(p.y - (r.y + r.h)) < 1e-6;
  return inX && inY && edge;
}

const CPS: [Point, Point] = [
  { x: 130, y: 20 },
  { x: -100, y: -10 },
];

describe('geometria delle relazioni', () => {
  for (const shape of ['curved', 'straight', 'angled', 'zigzag'] as const) {
    it(`${shape}: estremità sul bordo e path valido`, () => {
      for (const pts of [CPS, undefined]) {
        const g = relationshipGeometry(A, B, style(shape), pts);
        expect(onBorder(g.start, A)).toBe(true);
        expect(onBorder(g.end, B)).toBe(true);
        expect(g.d).toMatch(/^M -?[\d.]+ -?[\d.]+/);
        expect(g.d).not.toMatch(/NaN|Infinity|undefined/);
        for (const v of [g.startAngle, g.endAngle, g.label.x, g.label.y]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  }

  it("le maniglie sono l'inverso di handleToControlPoint (curved e angled)", () => {
    for (const shape of ['curved', 'angled'] as const) {
      const g = relationshipGeometry(A, B, style(shape), CPS);
      expect(handleToControlPoint(0, g.handles[0], A, B)).toEqual(CPS[0]);
      expect(handleToControlPoint(1, g.handles[1], A, B)).toEqual(CPS[1]);
    }
  });

  it('zigzag: solo tratti orizzontali e verticali', () => {
    const vertical: [Point, Point] = [
      { x: 10, y: -80 },
      { x: 5, y: -90 },
    ];
    for (const pts of [CPS, undefined, vertical]) {
      const g = relationshipGeometry(A, B, style('zigzag'), pts);
      expect(g.d).toMatch(/^M -?[\d.]+ -?[\d.]+( [HV] -?[\d.]+)+$/);
    }
  });

  it('zigzag orizzontale: tratto centrale a distanza dai bordi e quote delle estremità', () => {
    const g = relationshipGeometry(A, B, style('zigzag'), [
      { x: 120, y: 0 },
      { x: -90, y: 0 },
    ]);
    expect(g.handles[0].x).toBe(g.handles[1].x);
    expect(Math.abs(g.handles[0].x - g.start.x)).toBeGreaterThanOrEqual(10);
    expect(Math.abs(g.handles[0].x - g.end.x)).toBeGreaterThanOrEqual(10);
    expect(g.handles[0].y).toBe(g.start.y);
    expect(g.handles[1].y).toBe(g.end.y);
  });

  it('dragHandle sposta il tratto centrale dello zigzag sotto il puntatore', () => {
    const st = style('zigzag');
    const next = dragHandle(0, { x: 300, y: 50 }, A, B, st, [
      { x: 120, y: 0 },
      { x: -90, y: 0 },
    ]);
    const g = relationshipGeometry(A, B, st, next);
    expect(g.handles[0].x).toBeGreaterThan(250);
    expect(g.handles[0].x).toBe(g.handles[1].x);
  });

  it('blocchi sovrapposti non producono NaN', () => {
    const g = relationshipGeometry(A, { ...A }, style('curved'));
    expect(g.d).not.toMatch(/NaN/);
  });
});
