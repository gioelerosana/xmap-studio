import { describe, expect, it } from 'vitest';
import {
  AppController,
  readTextStyle,
  readTitleRuns,
  setTextStyle,
  setTitle,
  layoutSheets,
  Topic,
} from '../src/index.js';
import { minimalXmind } from './helpers.js';

const sheetWith = (a: Record<string, unknown>) => [
  {
    id: 's1',
    class: 'sheet',
    title: 'Foglio',
    rootTopic: {
      id: 'r',
      class: 'topic',
      title: 'Radice',
      children: { attached: [{ id: 'a', title: 'fbf è soddisfacibile', ...a }] },
    },
  },
];

describe('Stile del testo', () => {
  it('legge lo stile del blocco intero', () => {
    const t: Topic = {
      id: 't',
      style: {
        id: 'x',
        properties: {
          'fo:font-weight': '700',
          'fo:font-style': 'italic',
          'fo:text-decoration': 'underline line-through',
          'fo:color': '#FF0000',
          'fo:font-size': '12pt',
        },
      },
    };
    expect(readTextStyle(t)).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      color: '#FF0000',
      fontSizePx: 16,
    });
    expect(readTextStyle({ style: { properties: { 'fo:font-weight': 'bold' } } })?.bold).toBe(true);
    expect(readTextStyle({ style: { properties: { 'fo:font-weight': '400' } } })?.bold).toBe(false);
    expect(readTextStyle({ id: 'n' })).toBeUndefined();
  });

  it('legge i frammenti solo se coerenti con il titolo', () => {
    const t: Topic = {
      title: 'fbf è soddisfacibile',
      attributedTitle: [{ text: 'fbf è ' }, { text: 'soddisfacibile', 'fo:font-weight': '700' }],
    };
    expect(readTitleRuns(t)).toEqual([{ text: 'fbf è ' }, { text: 'soddisfacibile', bold: true }]);
    expect(readTitleRuns({ ...t, title: 'altro' })).toBeUndefined();
    expect(readTitleRuns({ title: 'ab', attributedTitle: [{ text: 'a' }, { text: 'b' }] })).toBeUndefined();
  });

  it('setTextStyle preserva chiavi sconosciute e gestisce null', () => {
    const t: Topic = { id: 't', style: { id: 's', extra: 1, properties: { 'svg:fill': '#000', other: 'x' } } };
    setTextStyle(t, { bold: true, underline: true, strikethrough: true, color: '#00FF00' });
    const style = t.style as { id: string; extra: number; properties: Record<string, string> };
    expect(style.extra).toBe(1);
    expect(style.properties['svg:fill']).toBe('#000');
    expect(style.properties.other).toBe('x');
    expect(style.properties['fo:font-weight']).toBe('700');
    expect(style.properties['fo:text-decoration']).toBe('underline line-through');
    setTextStyle(t, { underline: false });
    expect(style.properties['fo:text-decoration']).toBe('line-through');
    setTextStyle(t, { bold: false, italic: false });
    expect(style.properties['fo:font-weight']).toBe('400');
    expect(style.properties['fo:font-style']).toBe('normal');
    setTextStyle(t, { bold: null, italic: null, color: null, underline: null, strikethrough: null });
    expect(style.properties).toEqual({ 'svg:fill': '#000', other: 'x' });
  });

  it('crea style con id quando manca', () => {
    const t: Topic = { id: 't' };
    setTextStyle(t, { bold: true });
    const style = t.style as { id: string; properties: Record<string, string> };
    expect(typeof style.id).toBe('string');
    expect(style.properties['fo:font-weight']).toBe('700');
  });

  it('setTitle invalida attributedTitle solo se il testo cambia', () => {
    const t: Topic = { title: 'ab', attributedTitle: [{ text: 'a' }, { text: 'b', 'fo:font-weight': '700' }] };
    setTitle(t, 'ab');
    expect(t.attributedTitle).toBeDefined();
    setTitle(t, 'abc');
    expect(t.attributedTitle).toBeUndefined();
  });

  it('il DTO via AppController espone textStyle e titleRuns e il layout li propaga', async () => {
    const ctrl = new AppController();
    const dto = await ctrl.open(
      await minimalXmind(
        sheetWith({
          style: { id: 'st', properties: { 'fo:font-weight': '700' } },
          attributedTitle: [{ text: 'fbf è ' }, { text: 'soddisfacibile', 'fo:font-weight': '700' }],
        }),
      ),
    );
    const view = dto.sheets[0].topics.find((x) => x.id === 'a');
    expect(view?.textStyle).toEqual({ bold: true });
    expect(view?.titleRuns?.[1]).toEqual({ text: 'soddisfacibile', bold: true });
    const layout = layoutSheets(dto.sheets);
    expect(layout.nodes.find((n) => n.id === 'a')?.textStyle).toEqual({ bold: true });

    const after = ctrl.setTopicTextStyle('a', { italic: true });
    expect(after.sheets[0].topics.find((x) => x.id === 'a')?.textStyle).toEqual({ bold: true, italic: true });
    const edited = ctrl.setTopicTitle('a', 'nuovo');
    expect(edited.sheets[0].topics.find((x) => x.id === 'a')?.titleRuns).toBeUndefined();
  });
});
