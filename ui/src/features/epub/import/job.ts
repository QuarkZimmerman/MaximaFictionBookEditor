/**
 * Feature 012 (US2, D14-D16, D33): the EPUB import's job - the first module of the lazy chunk
 * `epub-import`. Built out by T033.
 */
import type { CommandContext } from '@/app/commands';
import type { FileFeature } from '@/features/file/fileCommands';

export async function importEpub(ctx: CommandContext, files: FileFeature): Promise<void> {
  void files;
  await ctx.dialogs.showMessage({
    text: ctx.t('epub.notReady'),
    caption: ctx.t('epub.importCaption'),
  });
}
