/**
 * Words tool feature registrar (US10, T136): replaces the `tools.words` stub with the Words
 * dialog. The tool acts on the Body, so the command switches to the Body view first (the
 * Source text is parsed back and malformed XML blocks the switch, FR-021) and is disabled
 * without a document or for Source-only documents.
 */

import { createElement } from 'react';

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { WordsDialog } from '@/dialogs/WordsDialog';
import { requestViewSwitch } from '@/views/source/sourceSession';

import { cmdKeys } from '../editing/common';

export { applyWordReplacements, wordFindOptions, wordPattern, wordRegExp } from './apply';
export { WordsSession, rowState } from './session';
export type { RowState, SortColumn, WordRow } from './session';

const canRun = (ctx: CommandContext): boolean => {
  const state = ctx.store.getState();
  return (
    ctx.rpc !== null &&
    state.connection === 'connected' &&
    state.document !== null &&
    !state.sourceOnly
  );
};

/** Switches to the Body view and opens the Words dialog; resolves when it closes. */
export async function openWordsDialog(ctx: CommandContext): Promise<void> {
  if (!(await requestViewSwitch(ctx, 'body'))) return;
  await ctx.dialogs.openCustom<void>((close) =>
    createElement(WordsDialog, { ctx, onClose: () => close() }),
  );
}

export function registerWordsFeature(ctx: FeatureContext): void {
  const command: Command = {
    id: 'tools.words',
    group: 'tools',
    ...cmdKeys('tools.words', 'menu.tools.words'),
    enabled: canRun,
    run: openWordsDialog,
  };
  ctx.commands.replace(command);
}
