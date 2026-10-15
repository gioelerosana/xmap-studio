import { describe, expect, it } from 'vitest';
import { parseOPML, unescapeXml } from '../src/index.js';

describe('unescapeXml', () => {
  it('decodifica in un solo passaggio', () => {
    expect(unescapeXml('&amp;lt;')).toBe('&lt;');
    expect(unescapeXml('a &lt; b &amp;&amp; c &gt; d')).toBe('a < b && c > d');
    expect(unescapeXml('&quot;x&quot; &apos;y&apos;')).toBe('"x" \'y\'');
  });

  it('gestisce le entità numeriche decimali ed esadecimali', () => {
    expect(unescapeXml('caff&#232; &#xE9; &#x1F600;')).toBe('caffè é 😀');
  });

  it('lascia intatte entità sconosciute o non valide', () => {
    expect(unescapeXml('&nbsp; &#xFFFFFFF; & solo')).toBe('&nbsp; &#xFFFFFFF; & solo');
  });

  it('preserva il testo letterale negli attributi OPML', () => {
    const root = parseOPML(
      '<opml><body><outline text="Root"><outline text="&amp;lt;tag&amp;gt; &#233;"/></outline></body></opml>'
    );
    const titles: string[] = [];
    const walk = (n: { title: string; children: unknown[] }) => {
      titles.push(n.title);
      n.children.forEach((c) => walk(c as typeof n));
    };
    walk(root as never);
    expect(titles).toContain('&lt;tag&gt; é');
  });
});
