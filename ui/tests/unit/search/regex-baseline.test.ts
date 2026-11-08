// Guard G11 (feature 011, research 2.3, SC-003, FR-021): every regular expression valid in release
// 0.0.8 finds exactly what it found there - in the Body view's and the fields' search
// (buildSearchRegExp) and in the Source view's (CodeMirror's RegExpCursor). The matches were
// recorded on the unchanged branch into regex-baseline.json - for each expression and engine the
// number of matches and the SHA-256 of their [from, to] list; MFBE_RECORD_REGEX_BASELINE=1
// records them again (only before the search changes, never to make this test pass).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Text } from '@codemirror/state';
import { RegExpCursor } from '@codemirror/search';
import { describe, expect, it } from 'vitest';

import { allMatches, buildSearchRegExp } from '@/features/search/replacement';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'regex-baseline.json');
const BOOK = path.resolve(HERE, '../../../../tests/fixtures/books/modern-utf8.fb2');

/** The expressions of the guard: what release 0.0.8 accepted, each kind at least once. */
const EXPRESSIONS: Array<{ query: string; matchCase?: boolean; wholeWord?: boolean }> = [
  { query: 'FictionBook' },
  { query: 'fictionbook' },
  { query: 'fictionbook', matchCase: true },
  { query: 'создание' },
  { query: '[А-Яа-яЁё]+' },
  { query: '[0-9]{2,}' },
  { query: '\\s+' },
  { query: '\\d+' },
  { query: '\\w+' },
  { query: '\\btitle\\b' },
  { query: 'title', wholeWord: true },
  { query: '\\p{Lu}\\p{Ll}+' },
  { query: '(body|section)' },
  { query: '(?:first|last)-name' },
  { query: '(\\w)\\1' },
  { query: 'e{2}' },
  { query: 'l+o?' },
  { query: '<[a-z-]+>' },
  { query: '[^<>\\s]+' },
  { query: '\\.' },
  { query: '\\(' },
  { query: '\\[' },
  { query: '^\\s*<p>' },
  { query: '[.,;:!?]' },
  { query: '[\\-–—]' },
  { query: 'ё|е' },
  { query: '(?<=<p>)\\S+' },
  { query: '\\S+(?=</p>)' },
];

type Key = string;
const keyOf = (e: (typeof EXPRESSIONS)[number]): Key =>
  `${e.query} case=${e.matchCase ? 1 : 0} word=${e.wholeWord ? 1 : 0}`;

function bodyMatches(text: string, e: (typeof EXPRESSIONS)[number]): Array<[number, number]> {
  const re = buildSearchRegExp({
    query: e.query,
    regex: true,
    matchCase: !!e.matchCase,
    wholeWord: !!e.wholeWord,
  });
  if (!re) return [];
  return allMatches(re, text).map((m) => [m.index, m.index + m[0].length]);
}

function sourceMatches(text: string, e: (typeof EXPRESSIONS)[number]): Array<[number, number]> {
  if (e.wholeWord) return [];
  const doc = Text.of(text.split('\n'));
  const found: Array<[number, number]> = [];
  const cursor = new RegExpCursor(doc, e.query, { ignoreCase: !e.matchCase });
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    found.push([step.value.from, step.value.to]);
  }
  return found;
}

describe('guard G11: regular expressions valid in 0.0.8 find the same', () => {
  const text = readFileSync(BOOK, 'utf8');
  const digest = (ranges: Array<[number, number]>) =>
    `${ranges.length}:${createHash('sha256').update(JSON.stringify(ranges)).digest('hex')}`;
  const current: Record<Key, { body: string; source: string }> = {};
  for (const e of EXPRESSIONS) {
    current[keyOf(e)] = {
      body: digest(bodyMatches(text, e)),
      source: digest(sourceMatches(text, e)),
    };
  }

  if (process.env.MFBE_RECORD_REGEX_BASELINE === '1') {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof current;

  it('the baseline covers every expression of the guard', () => {
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(current).sort());
  });

  for (const e of EXPRESSIONS) {
    it(`${keyOf(e)}: the Body view and the fields find the same`, () => {
      expect(current[keyOf(e)]?.body).toEqual(baseline[keyOf(e)]?.body);
    });
    it(`${keyOf(e)}: the Source view finds the same`, () => {
      expect(current[keyOf(e)]?.source).toEqual(baseline[keyOf(e)]?.source);
    });
  }
});
