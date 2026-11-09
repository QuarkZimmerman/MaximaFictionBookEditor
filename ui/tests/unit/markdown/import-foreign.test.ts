// Feature 011 (US7; D46; FR-073, FR-074; SC-018): Markdown another tool wrote - Pandoc's header keys,
// its header-includes and css: keys, <style> blocks, class spans and blocks - with
// tests/fixtures/markdown/foreign/.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';
import { translateCss } from '@/features/markdown/cssTranslate';

const FOREIGN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/markdown/foreign',
);

function convert() {
  return convertMarkdown(readFileSync(path.join(FOREIGN, 'pandoc.md'), 'utf8'), {
    fileName: 'pandoc',
    baseDir: FOREIGN,
    notesTitle: 'Notes',
  });
}

describe('Markdown written by other tools (D46)', () => {
  it('reads Pandoc’s header keys into the FB2 fields and lists the others', () => {
    const result = convert();
    expect(result.description).toMatchObject({
      title: 'A Pandoc Book',
      authors: [{ firstName: 'Jane', lastName: 'Doe' }],
      annotation: ['An abstract.'],
      keywords: 'sea, ships',
      lang: 'en',
      publish: { publisher: 'Acme', isbn: '978-3-16-148410-0' },
    });
    expect(result.description.custom).toEqual([{ type: 'rights', text: 'CC BY 4.0' }]);
    expect(result.summary).toContainEqual({ kind: 'headerKey', detail: 'unknown-key' });
  });

  it('takes the styles of the header, of the text and of the local css: file; never a web address', () => {
    const result = convert();
    expect(result.cssFiles).toEqual(['styles.css']);
    expect(result.summary).toContainEqual({
      kind: 'webCss',
      detail: 'https://example.org/web.css',
    });
    const foreign = result.stylesheets.filter((sheet) => sheet.foreign).map((sheet) => sheet.text);
    expect(foreign).toHaveLength(2);
    expect(translateCss(foreign[0]!).css).toBe(
      'cite {\n  margin: 0 2em;\n}\n.note {\n  color: gray;\n}\n',
    );
    expect(translateCss(foreign[1]!).css).toBe('emphasis {\n  font-style: italic;\n}\n');
    const file = translateCss(readFileSync(path.join(FOREIGN, 'styles.css'), 'utf8'));
    expect(file.css).toBe('p {\n  text-indent: 1em;\n}\n');
    expect(file.dropped).toEqual(['nav']);
  });

  it('turns class spans and blocks into named styles', () => {
    const { bodyXml } = convert();
    expect(bodyXml).toContain('<style name="mark">a span</style>');
    expect(bodyXml).toContain('<style name="other">html span</style>');
    expect(bodyXml).toContain('<p style="note">A note paragraph.</p>');
    expect(bodyXml).not.toContain(':::');
    expect(bodyXml).not.toContain('font-style');
  });
});
