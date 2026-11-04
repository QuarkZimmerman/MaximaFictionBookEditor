/**
 * Feature 009, User Story 2 (T023, T024): the names a Save As completes and proposes, and the
 * sticky "save as ZIP archive" checkbox (D10, D31, FR-018, FR-019, data-model §4 and §5).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  completeSaveTarget,
  proposedSavePath,
  rememberZipChoice,
  resetZipSticky,
  zipStartState,
} from '@/features/file/saveNames';

const book = { descriptor: false };

describe('completeSaveTarget (D10, data-model §4)', () => {
  it('ticked: .zip is added when missing, in any letter case', () => {
    expect(completeSaveTarget('/b/book.fb2', true, book)).toEqual({
      path: '/b/book.fb2.zip',
      entryName: 'book.fb2',
    });
    expect(completeSaveTarget('/b/book.fb2.ZIP', true, book).path).toBe('/b/book.fb2.ZIP');
    expect(completeSaveTarget('/b/My book.zip', true, book)).toEqual({
      path: '/b/My book.zip',
      entryName: 'My book.fb2',
    });
    expect(completeSaveTarget('/b/desc', true, { descriptor: true })).toEqual({
      path: '/b/desc.zip',
      entryName: 'desc.fbd',
    });
  });

  it('ticked: a book from an archive keeps its entry\u2019s file name, without folders', () => {
    expect(
      completeSaveTarget('/b/12345.zip', true, {
        descriptor: false,
        sourceEntry: 'War and Peace.fb2',
      }),
    ).toEqual({ path: '/b/12345.zip', entryName: 'War and Peace.fb2' });
    expect(
      completeSaveTarget('C:\\b\\any name', true, {
        descriptor: false,
        sourceEntry: 'Author/Series/book.fb2',
      }),
    ).toEqual({ path: 'C:\\b\\any name.zip', entryName: 'book.fb2' });
  });

  it('unticked: a .zip ending is dropped and .fb2/.fbd added when missing', () => {
    expect(completeSaveTarget('/b/book.fb2.zip', false, book)).toEqual({ path: '/b/book.fb2' });
    expect(completeSaveTarget('/b/12345.zip', false, book)).toEqual({ path: '/b/12345.fb2' });
    expect(completeSaveTarget('/b/d.zip', false, { descriptor: true })).toEqual({
      path: '/b/d.fbd',
    });
    // Any other name stays as chosen.
    expect(completeSaveTarget('/b/book.fb2', false, book)).toEqual({ path: '/b/book.fb2' });
    expect(completeSaveTarget('/b/notes.xml', false, book)).toEqual({ path: '/b/notes.xml' });
  });
});

describe('proposedSavePath (D31, data-model §4)', () => {
  const source = { archive: '/lib/books.zip', entry: 'tolstoy/War.fb2' };
  it('a book from an archive: in its folder, by the checkbox\u2019s starting state', () => {
    expect(
      proposedSavePath({
        current: '/lib/books.zip',
        source,
        archiveHeldOnlyThisBook: true,
        checked: true,
      }),
    ).toBe('/lib/books.zip');
    expect(
      proposedSavePath({
        current: '/lib/books.zip',
        source,
        archiveHeldOnlyThisBook: false,
        checked: true,
      }),
    ).toBe('/lib/War.fb2.zip');
    expect(
      proposedSavePath({
        current: '/lib/books.zip',
        source,
        archiveHeldOnlyThisBook: true,
        checked: false,
      }),
    ).toBe('/lib/War.fb2');
  });
  it('any other book: its own name, with .zip when the box starts ticked', () => {
    expect(
      proposedSavePath({ current: '/b/book.fb2', archiveHeldOnlyThisBook: false, checked: false }),
    ).toBe('/b/book.fb2');
    expect(
      proposedSavePath({ current: '/b/book.fb2', archiveHeldOnlyThisBook: false, checked: true }),
    ).toBe('/b/book.fb2.zip');
  });
});

describe('the sticky ZIP checkbox (D31, FR-019, data-model §5)', () => {
  afterEach(() => resetZipSticky());

  it('starts ticked for a book from an archive, unticked for any other, until first used', () => {
    expect(zipStartState(true)).toBe(true);
    expect(zipStartState(false)).toBe(false);
  });

  it('then starts as the user left it, for any book, until the copy restarts', () => {
    rememberZipChoice(false);
    expect(zipStartState(true)).toBe(false);
    rememberZipChoice(true);
    expect(zipStartState(false)).toBe(true);
    resetZipSticky(); // a new running copy
    expect(zipStartState(false)).toBe(false);
  });
});
