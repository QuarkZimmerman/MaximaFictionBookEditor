/**
 * The FR-015 confirmation (feature 006; C13; I12; data-model §6.4, §10.2): before *Merge cells*
 * removes cells whose `id` a link of the book targets, the host asks, naming the number of such
 * links. *No* changes nothing and records no undo step (FR-045); *Yes* makes the plan again on
 * the state as it is at the answer and commits it as one step, after which the links appear in
 * File → Validate as `link.dangling` (US5 sc.4). Only merges ask (C13): *Delete row*, *Delete
 * column* and *Delete table* neither ask nor refuse. US8's span growth from the Table bar reuses
 * `runWithLinkCheck`; the assistant is refused with `confirmationRequired` instead (FR-052).
 *
 * This module is in the features layer, which has the dialogs and the store; the engine imports
 * neither (C8).
 */

import type { CommandContext } from '@/app/commands';
import { planCommand, type TablePlan } from '@/editor/table/commands';
import { commitTableEdit, isRefusal, tableTarget, type PlanContext } from '@/editor/table/edit';
import { collectBookIds, countLinksTo } from '@/model/ids';
import type { AppStore } from '@/model/store';

import type { TableEditTarget } from './target';

/**
 * The links of the book whose target is one of `removedIds` (`countLinksTo` on the store's
 * document: text links and linked inline atoms in the bodies, both annotations and the
 * history); 0 without ids or without a document.
 */
export function linkTargetCount(store: AppStore, removedIds: readonly string[]): number {
  if (removedIds.length === 0) return 0;
  const document = store.getState().document;
  return document ? countLinksTo(document, removedIds) : 0;
}

/**
 * The FR-015 question for `count` links that would lose their target: true at once for 0;
 * otherwise a yes/no message box (No the default; Escape ignored, as for every `yesNo` set)
 * with the test ids `dialog-table-link-targets`, `-text`, `-button-yes` and `-button-no`,
 * resolving true only for Yes.
 */
export async function confirmLinkTargets(
  ctx: Pick<CommandContext, 'dialogs' | 't'>,
  count: number,
): Promise<boolean> {
  if (count <= 0) return true;
  const answer = await ctx.dialogs.showMessage({
    text: ctx.t('tables.msg.linkTargets', { count }),
    caption: ctx.t('tables.msg.linkTargetsCaption'),
    buttons: 'yesNo',
    icon: 'question',
    defaultButton: 'no',
    testId: 'dialog-table-link-targets',
  });
  return answer === 'yes';
}

/**
 * Runs `plan` on `target` with the FR-015 question (data-model §6.4, §9.1): a dry run of the plan
 * on the target's selection, with the target's node ids and the book's ids; a refusal or a no-op
 * dispatches nothing and answers false; when links of the book target ids the plan removes, the
 * question - *No* answers false, with nothing dispatched and no undo step -; on *Yes*, or
 * without such links, `target.run(planCommand(plan, planCtx))`, which makes the plan again on the
 * state as it is then and commits it as one step. Answers whether that step was made.
 */
export async function runWithLinkCheck(
  ctx: CommandContext,
  target: TableEditTarget,
  plan: TablePlan,
): Promise<boolean> {
  const state = target.state;
  if (!state) return false;
  const found = tableTarget(state);
  if (!found || found.selection === 'mixed' || found.selection === 'none') return false;
  const document = ctx.store.getState().document;
  const planCtx: PlanContext = {
    nextId: () => target.nextNodeId(),
    bookIds: document ? collectBookIds(document) : undefined,
  };
  const dryRun = plan(found.address, planCtx);
  if (isRefusal(dryRun) || !commitTableEdit(state.tr, found.tablePos, dryRun)) return false;
  const count = linkTargetCount(ctx.store, dryRun.removedIds);
  if (count > 0 && !(await confirmLinkTargets(ctx, count))) return false;
  return target.run(planCommand(plan, planCtx));
}
