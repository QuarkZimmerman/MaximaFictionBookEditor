// Feature 010, US8 (T052, T053): the reference fixtures of tests/fixtures/markdown/ against their
// golden files - the bodies, then the pictures, characters and summary items the import gets.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';

const FIXTURES = `${path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/markdown',
)}/`;

describe('Markdown fixtures against their golden files', () => {
  for (const name of ['structure', 'special-chars', 'pictures', 'hostile', 'russian-utf8']) {
    it(name, async () => {
      const result = convertMarkdown(readFileSync(`${FIXTURES}${name}.md`, 'utf8'), {
        fileName: name,
        baseDir: '/fixtures',
        notesTitle: 'Notes',
        genres: new Set(['sf', 'prose']),
      });
      const golden = [
        result.bodyXml.replace(/(<\/(?:section|p|title|table|tr|cite|subtitle)>)/g, '$1\n'),
        result.notesXml ?? '',
        JSON.stringify(
          {
            description: result.description,
            pictures: result.pictures.map(({ id, kind, path }) => ({ id, kind, path })),
            chars: result.chars,
            summary: result.summary,
            stats: result.stats,
          },
          null,
          2,
        ),
        '',
      ].join('\n');
      await expect(golden).toMatchFileSnapshot(`${FIXTURES}${name}.expected.txt`);
    });
  }
});
