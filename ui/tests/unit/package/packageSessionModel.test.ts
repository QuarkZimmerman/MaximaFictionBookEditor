import { describe, expect, it } from 'vitest';

import type { Document } from '@/model/document';
import {
  activePackageEntry,
  createEmptyPackageUiState,
  createOpenedPackageUiState,
  entryFromDto,
  hasNonEmptyDescription,
  proposedPackageSavePath,
  shouldConfirmRemoveEntry,
  syncActiveEntryDocument,
} from '@/features/package/packageSessionModel';
import type { PackageEntryDto } from '@/rpc/types';

function makeDoc(overrides: Partial<Document['description']['titleInfo']> = {}): Document {
  return {
    modelVersion: 1,
    docId: 'doc_1',
    fileKind: 'fbd',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    description: {
      titleInfo: {
        genres: [],
        authors: [],
        bookTitle: '',
        coverpage: [],
        lang: '',
        translators: [],
        sequences: [],
        ...overrides,
      },
      documentInfo: {
        authors: [{ firstName: '', lastName: '', homePages: [], emails: [] }],
        programUsed: 'Maxima Fiction Book Editor',
        date: { text: '2026-11-27', value: '2026-11-27' },
        srcUrls: [],
        id: 'UUID-1',
        version: '1.0',
        publishers: [],
      },
      customInfo: [],
      outputs: [],
    },
    stylesheets: [],
    bodies: [{ type: 'body', attrs: { nodeId: 'n1' }, content: [] }],
    binaries: [],
    extras: [],
  };
}

function makeDto(overrides: Partial<PackageEntryDto> = {}): PackageEntryDto {
  return {
    entryId: 'ent_1',
    docId: 'doc_1',
    fileName: 'My Novel.pdf',
    stem: 'My Novel',
    extension: 'pdf',
    size: 12345,
    originatedFromZip: false,
    hadFbd: false,
    droppedExtraImages: 0,
    document: makeDoc(),
    ...overrides,
  };
}

describe('packageSessionModel', () => {
  it('creates empty and opened package states cleanly', () => {
    const empty = createEmptyPackageUiState('pkg_1', false);
    expect(empty.packageId).toBe('pkg_1');
    expect(empty.zipPath).toBeNull();
    expect(empty.entries).toEqual([]);
    expect(empty.activeEntryId).toBeNull();
    expect(empty.modified).toBe(false);
    expect(empty.fb2TreeWasVisible).toBe(false);
    expect(activePackageEntry(empty)).toBeNull();

    const opened = createOpenedPackageUiState(
      'pkg_2',
      '/books/shelf.zip',
      [makeDto({ originatedFromZip: true, hadFbd: true })],
      true,
    );
    expect(opened.activeEntryId).toBe('ent_1');
    expect(activePackageEntry(opened)?.fileName).toBe('My Novel.pdf');
    expect(opened.fb2TreeWasVisible).toBe(true);
  });

  it('implements FR-010 Remove confirmation predicate accurately', () => {
    // Newly added with empty description -> remove immediately without prompt.
    const untouched = entryFromDto(makeDto());
    expect(hasNonEmptyDescription(untouched.document)).toBe(false);
    expect(shouldConfirmRemoveEntry(untouched)).toBe(false);

    // Originated from opened ZIP -> always confirm even if description is empty.
    const fromZip = entryFromDto(makeDto({ originatedFromZip: true }));
    expect(shouldConfirmRemoveEntry(fromZip)).toBe(true);

    // Edited in session -> confirm.
    const edited = { ...untouched, descriptionModified: true };
    expect(shouldConfirmRemoveEntry(edited)).toBe(true);

    // Non-empty metadata -> confirm.
    const withTitle = entryFromDto(makeDto({ document: makeDoc({ bookTitle: 'Dune' }) }));
    expect(hasNonEmptyDescription(withTitle.document)).toBe(true);
    expect(shouldConfirmRemoveEntry(withTitle)).toBe(true);

    const withCover = entryFromDto(
      makeDto({ document: makeDoc({ coverpage: [{ href: '#cover.jpg' }] }) }),
    );
    expect(hasNonEmptyDescription(withCover.document)).toBe(true);
    expect(shouldConfirmRemoveEntry(withCover)).toBe(true);
  });

  it('generates FR-022 proposed ZIP filenames for unsaved 1-file, multi-file, and saved packages', () => {
    const oneFile = createOpenedPackageUiState('pkg_1', '', [makeDto()], true);
    const unsavedOne = { ...oneFile, zipPath: null };
    expect(proposedPackageSavePath(unsavedOne, 'package')).toBe('My Novel.zip');

    const unsavedMulti = {
      ...unsavedOne,
      entries: [
        entryFromDto(makeDto({ entryId: 'ent_1', stem: 'Book A' })),
        entryFromDto(makeDto({ entryId: 'ent_2', stem: 'Book B' })),
      ],
    };
    expect(proposedPackageSavePath(unsavedMulti, 'пакет')).toBe('пакет.zip');

    const saved = { ...unsavedMulti, zipPath: '/tmp/existing.zip' };
    expect(proposedPackageSavePath(saved, 'package')).toBe('/tmp/existing.zip');
  });

  it('syncs active entry document and marks package and entry modified', () => {
    const base = createOpenedPackageUiState('pkg_1', '', [makeDto()], true);
    const updatedDoc = makeDoc({ bookTitle: 'Updated Title' });
    const next = syncActiveEntryDocument(base, updatedDoc, true);
    expect(next.modified).toBe(true);
    expect(next.entries[0]!.descriptionModified).toBe(true);
    expect(next.entries[0]!.document.description.titleInfo.bookTitle).toBe('Updated Title');
  });
});
