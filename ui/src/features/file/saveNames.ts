/**
 * Save As and ZIP archives (feature 009, User Story 2): the name the dialog proposes, the name a
 * save completes from the one chosen, and the sticky "save as ZIP archive" checkbox (D10, D31,
 * FR-018, FR-019, data-model §4 and §5). Pure functions; the File commands wire them up.
 */
import type { DocumentSource } from '@/model/document';

const ZIP = /\.zip$/i;
const BOOK = /\.(fb2|fbd)$/i;

/** The file name of `path`, whatever the separator. */
export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The folder of `path` with its trailing separator ("" for a bare name). */
function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function withBookExtension(name: string, descriptor: boolean): string {
  return BOOK.test(name) ? name : `${name}${descriptor ? '.fbd' : '.fb2'}`;
}

/** Where a save writes, and - for a ZIP save - the book's name inside the new archive. */
export interface SaveTarget {
  path: string;
  /** Set when the box was ticked: the only entry of the new archive, at its top level. */
  entryName?: string;
}

/**
 * Completes the name chosen in the Save As dialog (D10, FR-018):
 * - ticked: `.zip` is added when missing (`book.fb2` -> `book.fb2.zip`); the book inside keeps
 *   its own name - a book from an archive the file name it has there, without folders; any
 *   other book the completed name without `.zip`, with `.fb2`/`.fbd` added when missing;
 * - unticked: a `.zip` ending is dropped and `.fb2`/`.fbd` added when missing
 *   (`book.fb2.zip` -> `book.fb2`, `12345.zip` -> `12345.fb2`); any other name stays.
 */
export function completeSaveTarget(
  chosen: string,
  zip: boolean,
  book: { descriptor: boolean; sourceEntry?: string },
): SaveTarget {
  if (!zip) {
    if (!ZIP.test(chosen)) return { path: chosen };
    return { path: withBookExtension(chosen.replace(ZIP, ''), book.descriptor) };
  }
  const path = ZIP.test(chosen) ? chosen : `${chosen}.zip`;
  const entryName = book.sourceEntry
    ? baseName(book.sourceEntry)
    : withBookExtension(baseName(path).replace(ZIP, ''), book.descriptor);
  return { path, entryName };
}

/**
 * The name the dialog proposes, following the checkbox's starting state (D31, data-model §4):
 * for a book from an archive, in the archive's folder - ticked, the archive's own name when it
 * held only this book, else the book's name with `.zip`; unticked, the book's own name. Any
 * other book: its own name, with `.zip` when the box starts ticked.
 */
export function proposedSavePath(p: {
  current: string;
  source?: DocumentSource;
  archiveHeldOnlyThisBook: boolean;
  checked: boolean;
}): string {
  if (p.source) {
    const name = baseName(p.source.entry);
    if (!p.checked) return `${folderOf(p.source.archive)}${name}`;
    return p.archiveHeldOnlyThisBook
      ? p.source.archive
      : `${folderOf(p.source.archive)}${name}.zip`;
  }
  return p.checked && !ZIP.test(p.current) ? `${p.current}.zip` : p.current;
}

/*
 * The sticky checkbox (D31, FR-019): the state the user left at the last save through the
 * dialog in this running copy - kept in memory only, never in the settings; a restart or a new
 * copy starts afresh. Before its first use it starts ticked for a book from an archive.
 */
let zipSticky: boolean | null = null;

export function zipStartState(fromArchive: boolean): boolean {
  return zipSticky ?? fromArchive;
}

/** A save through the dialog wrote a file with the box in this state. */
export function rememberZipChoice(checked: boolean): void {
  zipSticky = checked;
}

/** Tests only: a fresh running copy. */
export function resetZipSticky(): void {
  zipSticky = null;
}
