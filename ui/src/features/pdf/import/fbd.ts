/**
 * Feature 016 (D22 to D24, plan DP-17; tasks T051): an FBD of the archive as the book's description. It is read
 * by 004's reader (`doc.readDescription`) into a hidden session and given to the new book as File > Import >
 * Description from FictionBook file gives it to an untouched new document - every entry, cover pictures
 * included. For the editor's own PDF its description is compared with the record's, field by field, and its
 * cover with the PDF's first picture (D23, clarify).
 */

import type { CommandContext } from '@/app/commands';
import { copyBinaries } from '@/features/transfer/importDescription';
import {
  applyEntries,
  importableEntries,
  type ReadDescriptionResult,
} from '@/features/transfer/importEntries';
import type { Document } from '@/model/document';
import { withSchemaPersons } from '@/views/description/model';

/** Reads the description file `path` against the open document `docId`; close it with `closeRead`. */
export function readDescriptionFile(
  ctx: CommandContext,
  docId: string,
  path: string,
): Promise<ReadDescriptionResult> {
  return ctx.rpc!.runJob('doc.readDescription', { docId, path });
}

export async function closeRead(
  ctx: CommandContext,
  read: ReadDescriptionResult | null,
): Promise<void> {
  if (read) await ctx.rpc?.call('doc.close', { docId: read.importId }).catch(() => undefined);
}

/** The description's cover picture's metadata, when it has one. */
function coverOf(
  read: ReadDescriptionResult,
): { width?: number; height?: number; contentType: string } | null {
  const href = read.description.titleInfo?.coverpage?.[0]?.href ?? '';
  return read.binaries.find((binary) => `#${binary.id}` === href) ?? null;
}

/**
 * D23 (clarify): the FBD gives the description the editor's own PDF gives back - the same fields, and the same
 * cover picture: before the pages are read (FR-045) the PDF's cover is known by its size in pixels and kind.
 */
export function sameDescription(
  record: ReadDescriptionResult,
  fbd: ReadDescriptionResult,
  cover: { w: number; h: number; jpeg: boolean } | undefined,
): boolean {
  // The record holds the description without its annotation and history: the PDF prints them as pages, and
  // the import gives them back from there (014 R10, D5). They are no difference.
  const comparable = (read: ReadDescriptionResult): string => {
    const description = structuredClone(read.description) as typeof read.description & {
      titleInfo?: { annotation?: unknown };
      documentInfo?: { history?: unknown };
    };
    if (description.titleInfo) delete description.titleInfo.annotation;
    if (description.documentInfo) delete description.documentInfo.history;
    return JSON.stringify(description);
  };
  if (comparable(record) !== comparable(fbd)) return false;
  const theirs = coverOf(fbd);
  if (!coverOf(record) && !theirs) return true;
  return (
    !!theirs &&
    !!cover &&
    theirs.width === cover.w &&
    theirs.height === cover.h &&
    (theirs.contentType === 'image/jpeg') === cover.jpeg
  );
}

/** The new book `document` (open as `docId`) with the FBD's description, every entry of it (D23). */
export async function applyFbd(
  ctx: CommandContext,
  docId: string,
  document: Document,
  read: ReadDescriptionResult,
): Promise<Document> {
  const entries = importableEntries(read);
  const { map, added } = await copyBinaries(ctx, docId, read.importId, entries);
  return {
    ...document,
    description: withSchemaPersons(
      applyEntries(
        document.description,
        read,
        entries.map((entry) => entry.key),
        map,
      ),
    ),
    binaries: [...document.binaries, ...added],
  };
}
