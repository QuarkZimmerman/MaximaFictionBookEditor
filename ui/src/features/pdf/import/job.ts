/**
 * Feature 016 (plan DP-10 to DP-15): the lazy part of the PDF import (chunk `pdf-import`): the FBD questions,
 * the read, the conversion and the new book. Filled by User Story 1 and the stories after it.
 */

import type { CommandContext } from '@/app/commands';
import type { FileFeature } from '@/features/file/fileCommands';

import type { PdfImportRun } from '../importCommand';

export async function importPdf(
  ctx: CommandContext,
  _files: FileFeature,
  run: PdfImportRun,
): Promise<void> {
  run.modal.end();
  await ctx.rpc?.call('pdfImport.end', { token: run.token }).catch(() => undefined);
}
