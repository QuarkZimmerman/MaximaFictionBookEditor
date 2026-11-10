// Feature 011 (US7; D46; FR-074; contracts/markdown-export.md §7): CSS written for HTML, made into
// CSS for the book.
import { describe, expect, it } from 'vitest';

import { translateCss } from '@/features/markdown/cssTranslate';
import { checkDeclarations } from '@/features/styles/declarations';
import { checkSelector } from '@/features/styles/selectors';

describe('translating CSS written for HTML (§7)', () => {
  it('translates element selectors with an FB2 counterpart and keeps classes and ids', () => {
    const out = translateCss(
      'blockquote { margin: 0 2em; }\nem, i { font-style: italic; }\nh1 { text-align: center; }\n#ch1 p.lead { text-indent: 0; }',
    );
    expect(out.css).toBe(
      'cite {\n  margin: 0 2em;\n}\nemphasis {\n  font-style: italic;\n}\ntitle {\n  text-align: center;\n}\n#ch1 p.lead {\n  text-indent: 0;\n}\n',
    );
    expect(out.dropped).toEqual([]);
  });

  it('drops an HTML element beside a class, and what has no counterpart, listing it', () => {
    const out = translateCss(
      'div.note { color: gray; }\nnav ul { margin: 0; }\n@media print { p { color: black; } }\np { -webkit-hyphens: auto; hyphens: auto; }',
    );
    expect(out.css).toBe('.note {\n  color: gray;\n}\np {\n  hyphens: auto;\n}\n');
    expect(out.dropped).toEqual(['nav ul', '@media', '-webkit-hyphens']);
  });

  it('gives CSS that passes the Styles view’s checks', () => {
    const out = translateCss(
      'strong { font-weight: bold; }\ntable td { border: 1px solid black; }',
    );
    for (const rule of out.css.split('}\n').filter((part) => part.trim())) {
      const [selector, block] = rule.split('{');
      expect(checkSelector(selector!.trim()), selector).toEqual({ ok: true });
      expect(checkDeclarations(block!).issues, block).toEqual([]);
    }
  });
});
