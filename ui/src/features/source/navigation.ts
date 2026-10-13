/**
 * Validation navigation (T080, FR-010/FR-024): "Go to wrong tag", "Go to matching tag" and the
 * jump from a validation issue to the Source line/column or the Body node.
 *
 * Go to wrong tag (the original's `SciGotoWrongTag` + validate-and-position behaviour):
 *  1. Source view with pending text: the text is parsed by the core (`doc.fromXml`); a parse
 *     error is the wrong tag - the cursor goes to its line/column (the view switch stays
 *     blocked, FR-021).
 *  2. Otherwise the last validation report is used when it belongs to the current text; if
 *     there is none (or it is stale) `file.validate` runs first, showing the panel.
 *  3. The first error after the cursor (wrapping to the first error of the document) is the
 *     target: Source line/column, or - from the Body view - the issue's node.
 *  Without a core the editor's own XML parser provides the unclosed/stray tag positions.
 *
 * Go to matching tag uses the Lezer syntax tree of the Source editor (`matchingTagPosition`).
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { createIssueNavigator, navigateToSourcePosition } from '@/dialogs/validation';
import type { ValidationIssue, ValidationReport } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import { getSourceEditor, type SourceEditorController } from '@/views/source/sourceEditor';
import { commitPendingSource, isValidationFresh } from '@/views/source/sync';

/* ------------------------------------------------------------------------ */
/* Issue ordering                                                           */
/* ------------------------------------------------------------------------ */

/** Errors with a position, in document order. */
export function positionedErrors(report: ValidationReport): ValidationIssue[] {
  return report.issues
    .filter((issue) => issue.severity === 'error' && issue.line !== undefined)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
}

/**
 * The error to jump to from the caret at `line:column`: the first one strictly after the caret,
 * wrapping to the first error of the document (like FBE's wrong-tag search).
 */
export function nextErrorIssue(
  report: ValidationReport,
  caret: { line: number; column: number } | null,
): ValidationIssue | null {
  const errors = positionedErrors(report);
  if (errors.length === 0) return null;
  if (!caret) return errors[0]!;
  const after = errors.find(
    (issue) =>
      (issue.line ?? 0) > caret.line ||
      ((issue.line ?? 0) === caret.line && (issue.column ?? 1) > caret.column),
  );
  return after ?? errors[0]!;
}

/** The first error of a report: positioned ones first, then anything with a node. */
export function firstErrorIssue(report: ValidationReport): ValidationIssue | null {
  return (
    positionedErrors(report)[0] ??
    report.issues.find((issue) => issue.severity === 'error' && issue.nodeId) ??
    report.issues.find((issue) => issue.severity === 'error') ??
    null
  );
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                 */
/* ------------------------------------------------------------------------ */

const inSourceView = (ctx: CommandContext): boolean => {
  const state = ctx.store.getState();
  return state.document !== null && state.activeView === 'source';
};

const canGotoWrongTag = (ctx: CommandContext): boolean => {
  const state = ctx.store.getState();
  if (!state.document) return false;
  return state.activeView === 'source' || state.validation !== null;
};

async function runValidation(
  ctx: CommandContext,
  registry: CommandRegistry,
): Promise<ValidationReport | null> {
  if (!registry.isEnabled('file.validate', ctx)) return ctx.store.getState().validation;
  await registry.execute('file.validate', ctx);
  return ctx.store.getState().validation;
}

function caretOf(editor: SourceEditorController | null): { line: number; column: number } | null {
  const caret = editor?.getCaret();
  return caret && caret.line !== undefined ? { line: caret.line, column: caret.column ?? 1 } : null;
}

/**
 * Go to wrong tag. Resolves true when the cursor was moved to a problem, false when the document
 * has no (positioned) errors.
 */
export async function gotoWrongTag(
  ctx: CommandContext,
  registry: CommandRegistry,
): Promise<boolean> {
  const { store } = ctx;
  const state = store.getState();
  if (!state.document) return false;

  if (state.activeView === 'source') {
    const editor = getSourceEditor(store);
    // 1. Pending text: a parse error is the wrong tag.
    if (ctx.rpc && (state.sourceDirty || state.sourceOnly)) {
      const result = await commitPendingSource(ctx, { silent: true });
      if (result === 'error') {
        const error = store.getState().sourceParseError;
        if (error && editor)
          editor.goTo(error.line, error.column || undefined, { highlight: true });
        return true;
      }
    }
    // Without a core only the editor's own parser can tell.
    if (!ctx.rpc) {
      if (editor?.gotoNextSyntaxError()) return true;
      actions.setStatusMessage(store, ctx.t('status.noErrors'));
      return false;
    }
    // 2. A report for this text, or a fresh one.
    let report = store.getState().validation;
    if (!report || !isValidationFresh(store)) report = await runValidation(ctx, registry);
    if (!report) return false;
    // 3. The next error after the cursor.
    const issue = nextErrorIssue(report, caretOf(editor));
    if (!issue || issue.line === undefined) {
      reportNothingToGoTo(ctx, report);
      return false;
    }
    if (editor) {
      editor.goTo(issue.line, issue.column, { highlight: true });
      return true;
    }
    return navigateToSourcePosition(ctx, issue.line, issue.column);
  }

  // Body / Description: the first error of the (fresh or last) report. A wrong tag is a Source
  // concept (the original validated and positioned the Source cursor): positioned errors open
  // the Source view; errors known only by node go to the Body node.
  let report = store.getState().validation;
  if (!report) report = await runValidation(ctx, registry);
  if (!report) return false;
  const issue = firstErrorIssue(report);
  if (!issue) {
    reportNothingToGoTo(ctx, report);
    return false;
  }
  if (issue.line !== undefined) return navigateToSourcePosition(ctx, issue.line, issue.column);
  return navigateToIssue(ctx, issue);
}

function reportNothingToGoTo(ctx: CommandContext, report: ValidationReport): void {
  actions.setStatusMessage(
    ctx.store,
    report.errorCount === 0 ? ctx.t('status.noErrors') : ctx.t('source.noWrongTag'),
  );
}

/** Go to matching tag (Source view). */
export function gotoMatchingTag(ctx: CommandContext): boolean {
  const { store } = ctx;
  const editor = getSourceEditor(store);
  if (!editor || store.getState().activeView !== 'source') return false;
  if (editor.gotoMatchingTag()) return true;
  actions.setStatusMessage(store, ctx.t('source.noMatchingTag'));
  return false;
}

/** Navigates to an issue through the shared navigator (Body node or Source line/column). */
export function navigateToIssue(ctx: CommandContext, issue: ValidationIssue): Promise<boolean> {
  return createIssueNavigator(ctx)(issue);
}

/** FBE "Collapse N tree levels" in the Source view. */
export function collapseSourceLevel(store: AppStore, level: number): number {
  return getSourceEditor(store)?.collapseLevel(level) ?? 0;
}

/** FBE "Expand N tree levels" in the Source view. */
export function expandSourceLevel(store: AppStore, level: number): number {
  return getSourceEditor(store)?.expandLevel(level) ?? 0;
}

/** The `edit.gotoWrongTag` / `edit.gotoMatchTag` / `source.collapse<N>` / `source.expand<N>` commands. */
export function createSourceCommands(registry: CommandRegistry): Command[] {
  const keys = (id: string, labelKey?: string) => ({
    labelKey,
    tooltipKey: `cmd.${id}.tooltip`,
    descriptionKey: `cmd.${id}.description`,
  });
  const commands: Command[] = [
    {
      id: 'edit.gotoWrongTag',
      group: 'navigation',
      ...keys('edit.gotoWrongTag', 'menu.edit.gotoWrongTag'),
      enabled: canGotoWrongTag,
      async run(ctx) {
        await gotoWrongTag(ctx, registry);
      },
    },
    {
      id: 'edit.gotoMatchTag',
      group: 'navigation',
      ...keys('edit.gotoMatchTag', 'menu.edit.gotoMatchTag'),
      enabled: inSourceView,
      run(ctx) {
        gotoMatchingTag(ctx);
      },
    },
  ];
  for (let level = 1; level <= 9; level += 1) {
    commands.push({
      id: `source.collapse${level}`,
      group: 'navigation',
      ...keys('source.collapse'),
      labelParams: { count: level },
      enabled: inSourceView,
      run(ctx) {
        collapseSourceLevel(ctx.store, level);
      },
    });
    commands.push({
      id: `source.expand${level}`,
      group: 'navigation',
      ...keys('source.expand'),
      labelParams: { count: level },
      enabled: inSourceView,
      run(ctx) {
        expandSourceLevel(ctx.store, level);
      },
    });
  }
  return commands;
}
