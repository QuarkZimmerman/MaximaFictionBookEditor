/**
 * Validation helpers shared by the panel and the file flows: localised issue messages
 * (`validation.<code>` keys with a raw-message fallback), the "Validation failed ... save
 * anyway?" prompt (FR-011) and the go-to-issue navigator (FR-010, T080).
 *
 * Navigation rules:
 *  - an issue with a `nodeId` activated while the Body view is shown goes to that node through
 *    the `NodeNavigator` (default: the Body caret provider; `setNodeNavigator()` lets the shell
 *    install a richer implementation that scrolls/selects the node);
 *  - otherwise the issue's `line`/`column` is shown in the Source view: the view is activated,
 *    the cursor placed and the line highlighted for a moment;
 *  - when the preferred target is unavailable (node vanished, no position) the other one is
 *    tried.
 *
 * Feature 006 (US8, FR-062; C61): the warning `table.irregular` of an irregular table reads as
 * the table's mark is named - its problems with their plurals, `Irregular table "<id>": …` for
 * a table with an id -, and goes to the table: from the Body view to its first cell, from a
 * clean Source view to the `<` of its `<table` line, from a dirty one to the line and column of
 * the text form; a table the Body view lacks (the source book's annotation) to its Source line.
 */

import type { TFunction, i18n as I18n } from 'i18next';

import type { CommandContext } from '@/app/commands';
import type { TableSummary } from '@/editor/table/grid';
import { describeTableMark } from '@/features/tables/marks';
import type { ValidationIssue, ValidationReport } from '@/model/document';
import { getSourceEditor } from '@/views/source/sourceEditor';
import { requestViewSwitch, setCaretWhenReady } from '@/views/source/sync';

import type { Dialogs } from './types';

/**
 * Core codes whose natural key collides with an older string key (`validation.schema` is the
 * message of the fake core / US1 tests) are mapped to a sibling key.
 */
const CODE_KEY_ALIASES: Record<string, string> = {
  'schema.invalid': 'validation.schemaInvalid',
  'schema.unavailable': 'validation.schemaUnavailable',
};

/** i18n key for an issue code: `schema` -> `validation.schema`, `validation.x` stays. */
export function issueMessageKey(code: string): string {
  const alias = CODE_KEY_ALIASES[code];
  if (alias) return alias;
  return code.startsWith('validation.') ? code : `validation.${code}`;
}

/** Localised message of an issue; falls back to the raw message, detail or code. */
export function issueMessage(
  issue: ValidationIssue,
  t: TFunction,
  i18n?: Pick<I18n, 'exists'>,
): string {
  // An irregular table (feature 006, C61): the mark's name, whose problem parts carry their
  // plurals, which the flat key lookup below cannot build.
  if (issue.code === 'table.irregular') {
    return describeTableMark(issue.params as unknown as TableSummary, t).name;
  }
  const key = issueMessageKey(issue.code);
  const exists = i18n ? i18n.exists(key) : false;
  if (exists) return t(key, { ...issue.params }) as string;
  const raw = issue.params.message ?? issue.params.detail;
  if (raw !== undefined && raw !== '') return String(raw);
  return issue.code;
}

/** "Validation failed ... save anyway?" prompt; resolves true when the user insists. */
export async function confirmSaveWithErrors(
  dialogs: Dialogs,
  t: TFunction,
  report: ValidationReport,
): Promise<boolean> {
  const answer = await dialogs.showMessage({
    text: t('msg.validationFailed', {
      errors: t('msg.errorsFound', { count: report.errorCount }),
    }),
    caption: t('msg.validationFailedCaption'),
    buttons: 'yesNo',
    icon: 'warning',
    defaultButton: 'no',
    testId: 'dialog-validation-failed',
  });
  return answer === 'yes';
}

/* ------------------------------------------------------------------------ */
/* Go to issue                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Moves the Body view to a node (scroll + select). Resolves false when the node does not exist.
 * The default implementation activates the Body view and uses its caret provider; the shell may
 * install one that also scrolls the node into view and selects it (`setNodeNavigator`).
 */
export type NodeNavigator = (nodeId: string, ctx: CommandContext) => Promise<boolean> | boolean;

export const defaultNodeNavigator: NodeNavigator = async (nodeId, ctx) => {
  if (!(await requestViewSwitch(ctx, 'body'))) return false;
  return setCaretWhenReady(ctx, { view: 'body', nodeId });
};

let nodeNavigator: NodeNavigator = defaultNodeNavigator;

/** Installs the Body node navigator used by the validation panel (null restores the default). */
export function setNodeNavigator(navigator: NodeNavigator | null): void {
  nodeNavigator = navigator ?? defaultNodeNavigator;
}

/**
 * Moves to a Source line/column: activates the view, places the cursor (on the first non-blank
 * character when the issue has no column) and highlights the line for a moment.
 */
export async function navigateToSourcePosition(
  ctx: CommandContext,
  line: number,
  column?: number,
): Promise<boolean> {
  if (!(await requestViewSwitch(ctx, 'source'))) return false;
  const editor = getSourceEditor(ctx.store);
  if (editor) return editor.goTo(line, column, { highlight: true });
  return setCaretWhenReady(ctx, { view: 'source', line, column: column ?? 1 });
}

export interface IssueNavigatorOptions {
  navigateToNode?: NodeNavigator;
}

/**
 * Navigation from a validation issue: Body node when the issue has a `nodeId` and the Body view
 * is active (or the issue has no position), otherwise the Source line/column; the other target
 * is the fallback.
 */
export function createIssueNavigator(
  ctx: CommandContext,
  options: IssueNavigatorOptions = {},
): (issue: ValidationIssue) => Promise<boolean> {
  return async (issue) => {
    const { store } = ctx;
    const state = store.getState();
    if (!state.document) return false;
    const toNode = options.navigateToNode ?? nodeNavigator;
    const nodeAvailable = !!issue.nodeId && !state.sourceOnly && !state.sourceDirty;
    const positionAvailable = issue.line !== undefined;
    const preferBody = nodeAvailable && (state.activeView === 'body' || !positionAvailable);
    if (preferBody && (await toNode(issue.nodeId!, ctx))) return true;
    if (positionAvailable && (await navigateToSourcePosition(ctx, issue.line!, issue.column))) {
      return true;
    }
    if (!preferBody && nodeAvailable) return toNode(issue.nodeId!, ctx);
    return false;
  };
}
