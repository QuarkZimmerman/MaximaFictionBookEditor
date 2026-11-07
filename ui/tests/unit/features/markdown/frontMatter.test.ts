// Feature 010, US8 (D30, DP-2): the strict front-matter reader of the Markdown import.

import { describe, expect, it } from 'vitest';

import { frontList, frontText, readFrontMatter } from '@/features/markdown/frontMatter';

describe('front matter', () => {
  it('reads scalars, quoted values, inline and dash lists and block scalars; keys lower-case', () => {
    const { values, body } = readFrontMatter(
      [
        '---',
        'Title: "The Book: Part One"',
        "author: 'Ann O''Brien'",
        'tags: [fantasy, "sea, ships", travel]',
        'authors:',
        '  - Ann Writer',
        '  - Bob',
        'summary: |',
        '  First line.',
        '  Second line.',
        'abstract: >',
        '  One',
        '  sentence.',
        'series_index: 2 # second',
        'not a key line',
        '---',
        '# Chapter',
        '',
        'Text.',
      ].join('\n'),
    );
    expect(values.get('title')).toBe('The Book: Part One');
    expect(values.get('author')).toBe("Ann O'Brien");
    expect(values.get('tags')).toEqual(['fantasy', 'sea, ships', 'travel']);
    expect(values.get('authors')).toEqual(['Ann Writer', 'Bob']);
    expect(values.get('summary')).toBe('First line.\nSecond line.');
    expect(values.get('abstract')).toBe('One sentence.');
    expect(values.get('series_index')).toBe('2');
    expect(body).toBe('# Chapter\n\nText.');
    expect(frontText(values, 'description', 'summary')).toBe('First line.\nSecond line.');
    expect(frontList(values, 'keywords', 'tags')).toEqual(['fantasy', 'sea, ships', 'travel']);
  });

  it('is absent unless the very first line opens it and a later line closes it', () => {
    expect(readFrontMatter('# Title\n---\na: b\n---\n').values.size).toBe(0);
    const unclosed = readFrontMatter('---\ntitle: x\n# no end');
    expect(unclosed.values.size).toBe(0);
    expect(unclosed.body).toBe('---\ntitle: x\n# no end');
    const bom = readFrontMatter('\uFEFF---\ntitle: x\n...\nbody');
    expect(bom.values.get('title')).toBe('x');
    expect(bom.body).toBe('body');
  });

  it('splits a list given as text', () => {
    const { values } = readFrontMatter('---\nkeywords: sea; ships, travel\n---\n');
    expect(frontList(values, 'keywords')).toEqual(['sea', 'ships', 'travel']);
  });
});
