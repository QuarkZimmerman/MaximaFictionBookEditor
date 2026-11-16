/**
 * Feature 016 (D13; tasks T035): the description of a PDF not made by the editor - from its document
 * information, the template filling what FB2 needs; the language guessed with the dictionaries.
 */
import { describe, expect, it } from 'vitest';

import { guessLanguage, metadataDescription, splitName } from '@/features/pdf/import/describe';

const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?><FictionBook><description><title-info><genre/><author><first-name/><last-name/></author><book-title/><annotation><p>Placeholder</p></annotation><coverpage><image l:href=""/></coverpage><lang>ru</lang></title-info><document-info><author><nickname>me</nickname></author><id>X</id><version>1.0</version></document-info></description><body/></FictionBook>`;

describe('the description of a PDF (D13)', () => {
  it('takes the title, the authors, the subject and the keywords', () => {
    const xml = metadataDescription(
      {
        Title: 'A Title',
        Author: 'Ann B. Example; Doe, John',
        Subject: 'What it is about',
        Keywords: 'one, two',
      },
      TEMPLATE,
      'file-name',
      'en',
    );
    expect(xml).toContain(
      '<title-info><genre/><author><first-name>Ann</first-name><middle-name>B.</middle-name><last-name>Example</last-name></author><author><first-name>John</first-name><last-name>Doe</last-name></author><book-title>A Title</book-title><annotation><p>What it is about</p></annotation><keywords>one, two</keywords><lang>en</lang></title-info>',
    );
    // The template's document-info stays as the core fills a new book's.
    expect(xml).toContain('<document-info><author><nickname>me</nickname></author>');
  });

  it("falls back to the file's name, the template's author and its language", () => {
    const xml = metadataDescription(undefined, TEMPLATE, 'file-name', null);
    expect(xml).toContain(
      '<author><first-name/><last-name/></author><book-title>file-name</book-title><lang>ru</lang>',
    );
    expect(xml).not.toContain('Placeholder');
  });

  it('names the cover the first page gave (D14)', () => {
    expect(metadataDescription({}, TEMPLATE, 'f', 'en', 'cover')).toContain(
      '<coverpage><image l:href="#cover"/></coverpage><lang>en</lang>',
    );
  });

  it('splits names written either way', () => {
    expect(splitName('Ann Example')).toEqual({ first: 'Ann', middle: '', last: 'Example' });
    expect(splitName('Example, Ann B.')).toEqual({ first: 'Ann', middle: 'B.', last: 'Example' });
    expect(splitName('Plato')).toEqual({ first: '', middle: '', last: 'Plato' });
  });
});

describe('the language of a PDF (DP-14)', () => {
  // Forty words, each once: the sample counts different words.
  const words = Array.from(
    { length: 40 },
    (_, i) => `слов${'абвгдежзик'[i % 10]}${'абвг'[Math.floor(i / 10)]}`,
  );
  it('is the one whose dictionary knows most of its words, at least half', async () => {
    const lang = await guessLanguage(words, async (list, code) =>
      code === 'ru' ? list.slice(0, 5) : list,
    );
    expect(lang).toBe('ru');
  });
  it('is none when no dictionary knows half, or the sample is too small', async () => {
    expect(await guessLanguage(words, async (list) => list)).toBeNull();
    expect(await guessLanguage(['one', 'two'], async () => [])).toBeNull();
  });
});
