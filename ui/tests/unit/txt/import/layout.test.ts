// Feature 017 (T034; D27, DP-12, clarify): the paragraphs of foreign text files in the five layouts of
// SC-005 (tests/fixtures/txt/layouts/, made by tests/fixtures/txt/make-fixtures.py), at least 99% of
// them back; blank lines beyond the layout's own as one empty line; control characters counted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { foreignParagraphs } from '@/features/txt/import/layout';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/txt',
);
const LAYOUTS = path.join(FIXTURES, 'layouts');

describe('foreign TXT layouts', () => {
  const expected = readdirSync(LAYOUTS).filter((name) => name.endsWith('.expected.json'));
  for (const file of expected) {
    const stem = file.replace(/\.expected\.json$/, '');
    const { paragraphs } = JSON.parse(readFileSync(path.join(LAYOUTS, file), 'utf8')) as {
      paragraphs: string[];
    };
    for (const layout of [
      'per-line',
      'per-line-blank',
      'per-line-indent',
      'wrapped-blank',
      'wrapped-indent',
    ]) {
      it(`${stem} ${layout}: its paragraphs come back`, () => {
        const text = readFileSync(path.join(LAYOUTS, `${stem}.${layout}.txt`), 'utf8');
        const got = foreignParagraphs(text).items.filter((p): p is string => p !== null);
        const back = paragraphs.filter((p, i) => got[i] === p).length;
        expect(back / paragraphs.length).toBeGreaterThanOrEqual(0.99);
        expect(got.length).toBe(paragraphs.length);
      });
    }
  }

  it('joins words broken at a line end as the dictionaries decide (clarify)', () => {
    const text = readFileSync(
      path.join(FIXTURES, 'hyphenated', 'hyphenated.wrapped-blank.txt'),
      'utf8',
    );
    const { paragraphs } = JSON.parse(
      readFileSync(path.join(FIXTURES, 'hyphenated', 'hyphenated.expected.json'), 'utf8'),
    ) as { paragraphs: string[] };
    const known = new Set([
      'information',
      'government',
      'государство',
      'литература',
      'університет',
    ]);
    const got = foreignParagraphs(text, (word) => known.has(word)).items;
    expect(got).toEqual(paragraphs);
  });

  it('gives one empty line for blank lines beyond the layout, and counts control characters', () => {
    const text = 'One\nTwo\n\n\n\nThree\x01\x02\n';
    const result = foreignParagraphs(text);
    expect(result.layout).toBe('per-line');
    expect(result.items).toEqual(['One', 'Two', null, 'Three']);
    expect(result.controlsLeftOut).toBe(2);
  });

  it('keeps the single blank line between one-per-line paragraphs as the layout', () => {
    const long =
      'A paragraph long enough to be read as one paragraph per line in its file, past any width a person wraps at.';
    const result = foreignParagraphs(`${long}\n\n${long}\n\n\n\n${long}\n`);
    expect(result.items).toEqual([long, long, null, long]);
  });
});
