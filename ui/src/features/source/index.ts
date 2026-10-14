/**
 * Source tools feature registrar (US4, T079-T081): creates the per-store Source editor
 * controller, registers its history adapter and caret provider (so Undo/Redo and "go to issue"
 * work for the Source view even while another view is shown), replaces the navigation command
 * stubs (`edit.gotoWrongTag`, `edit.gotoMatchTag`, `source.collapse1..9`, `source.expand1..9`),
 * registers the Source Find / Replace target and tracks which editor text the validation
 * panel's report belongs to.
 */

import type { FeatureContext } from '@/app/services';
import { getSearchSession } from '@/features/search/search';
import { createSourceFindTarget } from '@/features/search/sourceTarget';
import { sourceEditorFor } from '@/views/source/sourceEditor';
import { trackValidationFreshness } from '@/views/source/sync';

import { createSourceCommands } from './navigation';

export function registerSourceFeature(ctx: FeatureContext): void {
  const controller = sourceEditorFor(ctx.store, ctx.undo);
  ctx.undo.registerView('source', controller.undoAdapter);
  ctx.carets.register('source', controller.caretProvider);
  // The same Find and Replace dialogs as the Body view (the original's Source view did so).
  getSearchSession(ctx.store, ctx.undo).registerTarget(createSourceFindTarget(controller));
  trackValidationFreshness(ctx.store);
  for (const command of createSourceCommands(ctx.commands)) ctx.commands.replace(command);
}
