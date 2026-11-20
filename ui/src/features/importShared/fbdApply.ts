/**
 * Feature 016 (D23, plan DP-17), shared by feature 017 (D34, D39): an FBD read as the book's description -
 * by 004's reader (`doc.readDescription`) into a hidden session - and given to a new book as File > Import >
 * Description from FictionBook file gives it to an untouched new document: every entry, cover pictures
 * included. Static and small, so that every import (PDF, TXT, Markdown, EPUB) applies an FBD the same way
 * without loading another import's part.
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

/** The new book `document` (open as `docId`) with the FBD's description, every entry of it (D23, D34). */
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

/** The FBD at `path` given to the new book; the book unchanged and the error returned when it cannot be read. */
export async function withFbd(
  ctx: CommandContext,
  docId: string,
  document: Document,
  path: string,
): Promise<{ document: Document; error: unknown }> {
  let read: ReadDescriptionResult | null = null;
  try {
    read = await readDescriptionFile(ctx, docId, path);
    return { document: await applyFbd(ctx, docId, document, read), error: null };
  } catch (error) {
    return { document, error };
  } finally {
    await closeRead(ctx, read);
  }
}
