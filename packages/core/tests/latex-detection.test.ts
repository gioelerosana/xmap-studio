import { describe, expect, it } from 'vitest';
import { isLikelyLatex, suggestedLatex, Topic, topicLatex } from '../src/index.js';

const mathjax = (latex: string): Topic => ({
  id: 't',
  title: 'eq',
  extensions: [{ provider: 'org.xmind.ui.mathJax', content: { content: latex } }],
});

describe('topicLatex', () => {
  it('legge solo l\'estensione org.xmind.ui.mathJax', () => {
    expect(topicLatex(mathjax('\\alpha + 1'))).toBe('\\alpha + 1');
  });

  it('non tratta mai il titolo come formula', () => {
    expect(topicLatex({ id: 't', title: '$x^2$' })).toBeUndefined();
    expect(topicLatex({ id: 't', title: '\\alpha' })).toBeUndefined();
  });
});

describe('isLikelyLatex (suggerimento UI)', () => {
  it('riconosce comandi con un solo backslash', () => {
    expect(isLikelyLatex('\\alpha')).toBe(true);
    expect(isLikelyLatex('\\frac{a}{b}')).toBe(true);
  });

  it('riconosce delimitatori, apici e pedici con graffe', () => {
    expect(isLikelyLatex('$a+b$')).toBe(true);
    expect(isLikelyLatex('x^2 + y^2')).toBe(true);
    expect(isLikelyLatex('a_{ij}')).toBe(true);
  });

  it('non segnala identificatori con underscore né testo normale', () => {
    for (const text of ['file_name', 'user_id', 'MAX_VALUE', 'Ciao mondo', '5$', '']) {
      expect(isLikelyLatex(text), text).toBe(false);
    }
  });

  it('suggestedLatex toglie i delimitatori e tace sulle equazioni vere', () => {
    expect(suggestedLatex({ id: 't', title: '$ x^2 $' })).toBe('x^2');
    expect(suggestedLatex({ id: 't', title: 'file_name' })).toBeUndefined();
    expect(suggestedLatex({ ...mathjax('y'), title: '$x$' })).toBeUndefined();
  });
});
