// Feature 017 (T022; D4 to D9, D14, D16; contracts/txt-format.md): the TXT layout of the golden books
// equals their golden files in tests/fixtures/txt/golden/ (MFBE_TXT_GOLDEN=write rewrites them).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { layoutTxt } from '@/features/txt/export/layout';
import type { RecordLists } from '@/features/txt/export/record';
import type { Document } from '@/model/document';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const MODELS = path.join(REPO, 'tests/fixtures/txt/models');
const GOLDEN = path.join(REPO, 'tests/fixtures/txt/golden');

const LISTS: RecordLists = {
  genres: [
    {
      code: 'sf',
      category: 'sf',
      names: { en: 'Science Fiction', ru: 'Научная фантастика', uk: 'Наукова фантастика' },
      source: 'standard',
    },
    {
      code: 'prose_classic',
      category: 'prose',
      names: { en: 'Classic prose', ru: 'Классическая проза', uk: 'Класична проза' },
      source: 'standard',
    },
  ],
  languages: [
    { code: 'en', names: { en: 'English', ru: 'Английский', uk: 'Англійська' } },
    { code: 'ru', names: { en: 'Russian', ru: 'Русский', uk: 'Російська' } },
    { code: 'de', names: { en: 'German', ru: 'Немецкий', uk: 'Німецька' } },
  ],
};

const model = (name: string): Document =>
  JSON.parse(readFileSync(path.join(MODELS, `${name}.json`), 'utf8')) as Document;

describe('the TXT layout', () => {
  for (const name of ['reference-all-elements', 'modern-utf8', 'long-notes', 'german-book']) {
    it(`lays ${name} out as its golden file`, () => {
      const { text } = layoutTxt(model(name), LISTS, name, '0.0.12');
      const golden = path.join(GOLDEN, `${name}.txt`);
      if (process.env.MFBE_TXT_GOLDEN === 'write' || !existsSync(golden)) {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(golden, text);
      }
      expect(text).toBe(readFileSync(golden, 'utf8'));
    });
  }

  it('takes the file name for a missing title, on the title page and in the record (D16)', () => {
    const book = model('german-book');
    book.description.titleInfo.bookTitle = '';
    const { text, missingTitle } = layoutTxt(book, LISTS, 'Mein Buch', '0.0.12');
    expect(missingTitle).toBe(true);
    expect(text.startsWith('Mein Buch\n')).toBe(true);
    expect(text).toContain('\nTitle: Mein Buch\n');
  });

  it('ends with the record and the line naming the editor (D4, D5)', () => {
    const { text } = layoutTxt(model('reference-all-elements'), LISTS, 'x', '0.0.12');
    const lines = text.trimEnd().split('\n');
    expect(lines.at(-1)).toMatch(/^Made with Maxima Fiction Book Editor 0\.0\.12$/);
    expect(lines).toContain('='.repeat(40));
  });

  it('gives each paragraph of raw XML a line of its own, its formatting spaces collapsed', () => {
    // Books of the corpus nest <p> in <p> (67.fb2, 2213.fb2, 2380.fb2, 2926.fb2): the editor keeps the inner
    // paragraphs as raw XML inside the outer one. Their words must not run together ("ХранителюМолитва").
    const book = model('german-book');
    const section = book.bodies[0]!.content.find((node) => node.type === 'section') as unknown as {
      content: unknown[];
    };
    section.content.unshift({
      type: 'p',
      content: [
        { type: 'text', text: 'Before the list. ' },
        {
          type: 'raw-xml',
          attrs: {
            inline: true,
            xml: '<p>mov ah,4Eh</p><p>mov dx,offset\n        fname</p><p><strong>add</strong> dx,bp</p>',
          },
        },
        { type: 'text', text: ' After it.' },
      ],
    });
    section.content.unshift({
      type: 'raw-xml',
      attrs: {
        inline: false,
        xml: '<poem>\n  <v>First   verse</v>\n  <v>Second verse</v>\n</poem>',
      },
    });
    const lines = layoutTxt(book, LISTS, 'raw', '0.0.12').text.split('\n');
    const at = lines.indexOf('First verse');
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at, at + 6)).toEqual([
      'First verse',
      'Second verse',
      'Before the list.',
      'mov ah,4Eh',
      'mov dx,offset fname',
      'add dx,bp',
    ]);
    expect(lines[at + 6]).toBe('After it.');
  });
});
