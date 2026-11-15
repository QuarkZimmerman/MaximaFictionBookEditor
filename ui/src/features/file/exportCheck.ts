/**
 * The check before an export of the book (requester, rc.5): as Save asks before writing an invalid
 * book, Export as Markdown, EPUB and PDF ask before they write one. The FBD export checks its own
 * content in the core and asks the same question (exportFbd.ts).
 */

import type { CommandContext } from '@/app/commands';
import { confirmExportWithErrors } from '@/dialogs/validation';

import { validateBook } from './fileCommands';

/**
 * Resolves true when the export may go on: the book is valid, or the user insists. The book's
 * errors are the last check's while nothing changed since it (the check that runs when a book
 * has loaded, File > Validate, a save), else those of a new check.
 */
export async function confirmBookExport(ctx: CommandContext): Promise<boolean> {
  const { lastCheck, contentRevision } = ctx.store.getState();
  const errorCount =
    lastCheck && lastCheck.revision === contentRevision
      ? lastCheck.problems
      : ((await validateBook(ctx, { quiet: true }))?.errorCount ?? 0);
  return errorCount === 0 || confirmExportWithErrors(ctx.dialogs, ctx.t, errorCount);
}
