/**
 * *Add → Table* in the Source view (feature 006, FR-061; FR-040 to FR-043 for the Source view;
 * US1 sc.10; I23, I27; C6, C28, C36; data-model §4.5 `insert.table`, §7.3, §9.3, §9.6;
 * resource-formats.md §9; research R4.7): `insert.table`'s branch while the Source view shows a
 * document. The Source controller judges the cursor (`tablePoint()`, the table rule of
 * `views/source/tablePoint.ts`): the command is enabled exactly where the verdict is `ok`, and
 * otherwise says why with `tables.reason.source.<code>` - the line of the first problem for
 * `notWellFormed`, the parent's name for `notAllowed`. Its run opens the Table properties
 * dialog with the values last confirmed, stores the confirmed ones and, the cursor judged again,
 * inserts the table's XML as one undo step (`insertTable`); Cancel changes nothing.
 * `__mfbeTest.sourceTable.sweep(offsets)` gives the verdict and the registry's state of
 * `insert.table` at each offset, for the journeys (I27; data-model §16.4).
 */

import type { TFunction } from 'i18next';

import type { CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import i18next from '@/i18n';
import type { AppStore } from '@/model/store';
import {
  getSourceEditor,
  type SourceEditorController,
  type SourceVerdict,
} from '@/views/source/sourceEditor';

import { openTableDialog, rememberTableDialog } from './dialog';
import { reasonText } from './reasons';

/** True while the Source view shows a document: `insert.table` then takes its Source branch. */
export function sourceTableActive(store: AppStore): boolean {
  const state = store.getState();
  return state.activeView === 'source' && state.document !== null;
}

/** The verdict at the Source cursor (the controller's `tablePoint()`), `loading` before it exists. */
export function sourceTableVerdict(store: AppStore): SourceVerdict {
  return getSourceEditor(store)?.tablePoint() ?? { code: 'loading' };
}

/**
 * The words of a verdict: `tables.reason.source.<code>`, with `{line}` for `notWellFormed` and
 * `{element}` for `notAllowed`; null for `ok`.
 */
export function sourceTableReason(verdict: SourceVerdict, t: TFunction): string | null {
  switch (verdict.code) {
    case 'ok':
      return null;
    case 'notWellFormed':
      return reasonText('source.notWellFormed', { line: verdict.line }, t);
    case 'notAllowed':
      return reasonText('source.notAllowed', { element: verdict.element }, t);
    default:
      return reasonText(`source.${verdict.code}`, undefined, t);
  }
}

/**
 * `insert.table`'s run in the Source view (data-model §4.5): the dialog with the values last
 * confirmed; nothing on Cancel; on OK the values stored (best effort, without waiting for the
 * answer), then - the Source view still active - `insertTable`, which judges the cursor again
 * and inserts nothing where the verdict is no longer `ok` or while the editor is locked.
 */
export async function runSourceTable(ctx: CommandContext): Promise<void> {
  const controller = getSourceEditor(ctx.store);
  if (!controller || controller.tablePoint().code !== 'ok') return;
  const values = await openTableDialog(ctx);
  if (!values) return;
  const stored = rememberTableDialog(ctx, values);
  if (sourceTableActive(ctx.store)) controller.insertTable(values);
  await stored;
}

/** The answer of the Source sweep at one offset (data-model §16.4). */
export interface SourceSweepAnswer {
  offset: number;
  /** The registry's state of `insert.table` with the cursor there. */
  enabled: boolean;
  /** The verdict's code there, `ok` included. */
  code: SourceVerdict['code'];
}

export interface SourceTableTestHooks {
  /**
   * The Source view's table rule at each offset, in input order: the cursor put there (a
   * selection only - no scroll, no focus), the registry's state of `insert.table` and the
   * verdict's code; the selection found is restored and the text does not change. Throws for an
   * offset outside the Source text, so a wrong list fails at once.
   */
  sweep(offsets: readonly number[]): SourceSweepAnswer[];
}

function sweepController(ctx: FeatureContext): SourceEditorController {
  const controller = getSourceEditor(ctx.store);
  if (!controller) throw new Error('sourceTable.sweep: no Source editor');
  return controller;
}

/**
 * Assigns `__mfbeTest.sourceTable` on the shared hook object, as the other test hooks do; the
 * tables feature calls it only for a page that asks for test hooks or a core started with them.
 */
export function installSourceTableHooks(ctx: FeatureContext): void {
  if (typeof window === 'undefined') return;
  const hooks: SourceTableTestHooks = {
    sweep(offsets) {
      const controller = sweepController(ctx);
      const length = controller.state.doc.length;
      for (const offset of offsets) {
        if (!Number.isInteger(offset) || offset < 0 || offset > length) {
          throw new Error(`sourceTable.sweep: no offset ${String(offset)} in the Source text`);
        }
      }
      const commandCtx = {
        store: ctx.store,
        rpc: ctx.rpc ?? null,
        undo: ctx.undo,
        hotkeys: ctx.hotkeys,
        carets: ctx.carets,
        t: i18next.t,
        version: '',
      } as unknown as CommandContext;
      const start = controller.state;
      try {
        return offsets.map((offset) => {
          controller.target.dispatch({ selection: { anchor: offset } });
          return {
            offset,
            enabled: ctx.commands.isEnabled('insert.table', commandCtx),
            code: controller.tablePoint().code,
          };
        });
      } finally {
        if (controller.state.doc === start.doc) {
          controller.target.dispatch({ selection: start.selection });
        }
      }
    },
  };
  const existing = window.__mfbeTest ?? {};
  window.__mfbeTest = Object.assign(existing, { sourceTable: hooks });
}
