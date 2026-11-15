/**
 * Feature 015 (FR-016, T035): the user's own genres are marked in Choose a genre - a class for
 * their colour and their file in the tooltip - and the standard and bundled ones are not.
 */
import { describe, expect, it } from 'vitest';

import { isGenreCode, ownGenreMarks, proposedCategory } from '@/views/description/genreCodes';
import type { GenreCatalog } from '@/views/description/resources';

describe('own-genre marks (feature 015)', () => {
  it('marks an entry from a user file with the class and its file', () => {
    expect(ownGenreMarks({ source: 'user:my.genres.tsv' })).toEqual({
      className: 'mfbe-genre-own',
      title: 'my.genres.tsv',
    });
    expect(
      ownGenreMarks({ source: 'user:x.genres.tsv', file: '/home/u/genres/x.genres.tsv' }).title,
    ).toBe('/home/u/genres/x.genres.tsv');
  });

  it('leaves the standard and the bundled entries unmarked', () => {
    expect(ownGenreMarks({ source: 'standard' })).toEqual({});
    expect(ownGenreMarks({ source: 'bundled-extension' })).toEqual({});
    expect(ownGenreMarks({ source: 'bundled:10-fbe-legacy.genres.tsv' })).toEqual({});
  });
});

describe('the add-genre form rules (feature 015)', () => {
  it('accepts only lowercase Latin letters, digits and _ as a code', () => {
    expect(isGenreCode('my_genre_2')).toBe(true);
    for (const bad of ['', 'My Genre', 'genre-x', 'жанр', 'Sf'])
      expect(isGenreCode(bad)).toBe(false);
  });

  it('proposes Other the first time, else the first category', () => {
    const catalog = (keys: string[]) =>
      ({ categories: keys.map((key) => ({ key, titles: {} })) }) as unknown as GenreCatalog;
    expect(proposedCategory(catalog(['sf', 'other']))).toBe('other');
    expect(proposedCategory(catalog(['sf', 'det']))).toBe('sf');
  });
});
