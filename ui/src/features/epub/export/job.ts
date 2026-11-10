/**
 * Feature 012 (US1, D2, D3, D33): the EPUB export's job - the first module of the lazy chunk
 * `epub-export`. Built out by T021.
 */
import type { CommandContext } from '@/app/commands';

export async function exportEpub(ctx: CommandContext): Promise<void> {
  await ctx.dialogs.showMessage({
    text: ctx.t('epub.notReady'),
    caption: ctx.t('epub.exportCaption'),
  });
}
