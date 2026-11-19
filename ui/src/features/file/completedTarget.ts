import type { CommandContext } from '@/app/commands';

/**
 * The question before a save or an export writes a name the system's dialog did not check: its ZIP box turned the
 * chosen name into another after the dialog closed (book.txt into book.zip, or back), or Save As completed it. An
 * existing file there is replaced only on Yes (feature 009, D10; for the exports the requester after his smoke test
 * of 0.0.12-rc.4 - they replaced it without a word).
 */
export async function confirmCompletedTarget(
  ctx: CommandContext,
  chosen: string,
  target: string,
): Promise<boolean> {
  if (target === chosen || !ctx.rpc) return true;
  const inspected = await ctx.rpc.call('files.inspect', { path: target }).catch(() => null);
  if (!inspected?.exists) return true;
  const answer = await ctx.dialogs.showMessage({
    text: ctx.t('dialog.saveFile.replaceCompleted', { path: target }),
    caption: ctx.t('app.name'),
    buttons: 'yesNo',
    icon: 'warning',
    testId: 'dialog-replace-completed',
  });
  return answer === 'yes';
}
