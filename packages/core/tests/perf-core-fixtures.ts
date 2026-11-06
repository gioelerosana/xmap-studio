/**
 * Mappa sintetica per i test di prestazioni: radice a ventaglio, note, marker,
 * etichette, stili, formule inline e un'equazione MathJax ogni tanto.
 */
export function syntheticSheet(count: number, id = 's1'): Record<string, unknown> {
  let n = 0;
  const make = (): Record<string, unknown> => {
    const i = n++;
    const t: Record<string, unknown> = {
      id: `${id}-t${i}`,
      class: 'topic',
      title:
        i % 7 === 0
          ? `Formula $x^{${i}}+\\frac{a}{b}$ nel blocco ${i}`
          : `Blocco numero ${i} con un titolo abbastanza lungo da andare a capo`,
    };
    if (i % 5 === 0) t.notes = { plain: { content: `nota ${i}` } };
    if (i % 4 === 0) t.markers = [{ markerId: 'priority-1' }];
    if (i % 6 === 0) t.labels = ['etichetta'];
    if (i % 9 === 0) t.style = { properties: { 'svg:fill': '#ff0000', 'fo:font-weight': 'bold' } };
    if (i % 11 === 0) t.unknownField = { keep: [1, 2, { deep: 'x' }] };
    return t;
  };
  const root = make();
  const queue: Array<{ t: Record<string, unknown>; depth: number }> = [{ t: root, depth: 0 }];
  let head = 0;
  while (n < count && head < queue.length) {
    const { t, depth } = queue[head++];
    const fan = depth === 0 ? 8 : 4;
    const kids: Record<string, unknown>[] = [];
    for (let k = 0; k < fan && n < count; k++) {
      const c = make();
      kids.push(c);
      queue.push({ t: c, depth: depth + 1 });
    }
    t.children = { attached: kids };
  }
  return { id, class: 'sheet', title: `Foglio ${id}`, rootTopic: root };
}
