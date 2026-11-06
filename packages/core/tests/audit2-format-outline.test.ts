import { describe, expect, it } from 'vitest';
import { AppController, parseOutlineSheets, toMarkdown, toOPML } from '../src/index.js';
import type { OutlineNode, Sheet, Topic } from '../src/index.js';
import { minimalXmind } from './helpers.js';

/** Struttura confrontabile di un nodo: titolo, formula, note, etichette, figli. */
function shape(n: OutlineNode): unknown {
  return {
    title: n.title,
    latex: n.latex ?? null,
    notes: n.notes ?? null,
    labels: n.labels,
    children: n.children.map(shape),
  };
}

function topic(title: string, extra: Partial<Topic> = {}, children: Topic[] = []): Topic {
  return {
    id: `t-${title}`,
    title,
    ...extra,
    ...(children.length > 0 ? { children: { attached: children } } : {}),
  } as Topic;
}

function sheet(root: Topic): Sheet {
  return { id: `s-${root.title}`, class: 'sheet', title: 'Foglio', rootTopic: root } as Sheet;
}

describe('Import Markdown con più fogli', () => {
  const twoSheets = [
    sheet(topic('Primo', { notes: { plain: { content: 'nota primo' } } }, [topic('a'), topic('b')])),
    sheet(topic('Secondo', { notes: { plain: { content: 'nota secondo' } } }, [topic('c')])),
  ];

  it('un `#` per foglio dà un foglio per intestazione, con le note al blocco giusto', () => {
    const roots = parseOutlineSheets('markdown', toMarkdown(twoSheets));
    expect(roots.map((r) => r.title)).toEqual(['Primo', 'Secondo']);
    expect(roots[0].notes).toBe('nota primo');
    expect(roots[1].notes).toBe('nota secondo');
    expect(roots[0].children.map((c) => c.title)).toEqual(['a', 'b']);
    expect(roots[0].children[1].notes).toBeUndefined();
    expect(roots[1].children.map((c) => c.title)).toEqual(['c']);
  });

  it('con un solo `#` resta una radice', () => {
    const roots = parseOutlineSheets('markdown', '> prima\n# Unico\n- x\n## sotto\n- y\n');
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe('Unico');
    expect(roots[0].notes).toBe('prima');
    expect(roots[0].children.map((c) => c.title)).toEqual(['x', 'y']);
  });

  it('importOutline aggiunge un foglio per intestazione', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const dto = await c.importOutline('markdown', toMarkdown(twoSheets));
    expect(dto.sheets.map((s) => s.topics[0].title)).toEqual(['Radice', 'Primo', 'Secondo']);
    expect(dto.sheets[2].topics[0].notes).toBe('nota secondo');
  });

  it('asNewSheet=false aggancia il primo alla radice e aggiunge gli altri come fogli nuovi', async () => {
    const c = new AppController();
    await c.open(await minimalXmind());
    const dto = await c.importOutline('markdown', toMarkdown(twoSheets), { asNewSheet: false });
    expect(dto.sheets).toHaveLength(2);
    expect(dto.sheets[0].topics[0].title).toBe('Radice');
    expect(dto.sheets[0].topics.map((t) => t.title)).toContain('Primo');
    expect(dto.sheets[0].topics.map((t) => t.title)).not.toContain('Secondo');
    expect(dto.sheets[1].topics[0].title).toBe('Secondo');
  });
});

describe('Import OPML', () => {
  it('export → import di un foglio dà la stessa struttura, senza il livello del titolo', () => {
    const one = sheet(
      topic('Radice', { notes: { plain: { content: 'n' } }, labels: ['l1'] } as Partial<Topic>, [
        topic('a', {}, [topic('a1')]),
        topic('b'),
      ])
    );
    const roots = parseOutlineSheets('opml', toOPML([one], 'Titolo del file'));
    expect(roots).toHaveLength(1);
    expect(shape(roots[0])).toEqual({
      title: 'Radice',
      latex: null,
      notes: 'n',
      labels: ['l1'],
      children: [
        { title: 'a', latex: null, notes: null, labels: [], children: [{ title: 'a1', latex: null, notes: null, labels: [], children: [] }] },
        { title: 'b', latex: null, notes: null, labels: [], children: [] },
      ],
    });
  });

  it('con più outline di primo livello la radice resta il titolo dell\'intestazione', () => {
    const roots = parseOutlineSheets(
      'opml',
      '<opml><head><title>Testa</title></head><body><outline text="x"/><outline text="y"/></body></opml>'
    );
    expect(roots[0].title).toBe('Testa');
    expect(roots[0].children.map((c) => c.title)).toEqual(['x', 'y']);
  });
});

describe('Export Markdown: round-trip dei titoli', () => {
  const tricky = [
    'costa $5 e $10$',
    'prezzo $x$',
    '$solo$',
    'codice `x`',
    '`etichetta`',
    'barra \\ e \\$',
    'finisce con \\',
    'a`',
  ];

  it.each(tricky)('il titolo %s torna uguale', (title) => {
    const md = toMarkdown([sheet(topic('R', {}, [topic(title, { labels: ['lab'] } as Partial<Topic>), topic(title)]))]);
    const [root] = parseOutlineSheets('markdown', md);
    expect(root.children.map((c) => c.title)).toEqual([title, title]);
    expect(root.children.map((c) => c.latex ?? null)).toEqual([null, null]);
    expect(root.children[0].labels).toEqual(['lab']);
    expect(root.children[1].labels).toEqual([]);
  });

  it('le formule vere restano formule', () => {
    const eq = (t: string, latex: string) =>
      topic(t, { extensions: [{ provider: 'org.xmind.ui.mathJax', content: { content: latex } }] } as Partial<Topic>);
    const md = toMarkdown([sheet(topic('R', {}, [eq('', '\\frac{a}{b}'), eq('costo $', '\\$ x')]))]);
    const [root] = parseOutlineSheets('markdown', md);
    expect(root.children.map((c) => [c.title, c.latex])).toEqual([
      ['', '\\frac{a}{b}'],
      ['costo $', '\\$ x'],
    ]);
  });

  it('toglie i \\r delle note CRLF', () => {
    const md = toMarkdown([sheet(topic('R', {}, [topic('a', { notes: { plain: { content: 'uno\r\ndue\rtre' } } })]))]);
    expect(md).not.toContain('\r');
    const [root] = parseOutlineSheets('markdown', md);
    expect(root.children[0].notes).toBe('uno\ndue\ntre');
  });
});
