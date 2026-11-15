/**
 * The check before an export of the book (requester, rc.5): as Save asks before writing an invalid
 * book, the exports ask "export anyway?" - with the last check's count while nothing changed since
 * it, else after a new check; a valid book is exported without a question.
 */

import { confirmBookExport } from '@/features/file/exportCheck';
import { validateBook } from '@/features/file/fileCommands';
import { actions } from '@/model/store';

import { CLEAN_REPORT, fakeDialogs, fakeDocument, fakeRpc, makeContext } from './testUtils';

const ERRORS = { issues: [], errorCount: 3, warningCount: 0, durationMs: 1 };

async function setup(report: unknown, answers: Parameters<typeof fakeDialogs> = []) {
  const rpc = fakeRpc({ 'doc.validate': report });
  const dialogs = fakeDialogs(...answers);
  const ctx = await makeContext({ rpc: rpc.client, dialogs });
  actions.setConnection(ctx.store, 'connected');
  actions.setDocument(ctx.store, fakeDocument());
  const validations = () => rpc.calls.filter((c) => c.method === 'doc.validate').length;
  return { ctx, dialogs, validations };
}

describe('the check before an export (requester, rc.5)', () => {
  it('lets a valid book go without a question', async () => {
    const { ctx, dialogs, validations } = await setup(CLEAN_REPORT);
    expect(await confirmBookExport(ctx)).toBe(true);
    expect(validations()).toBe(1);
    expect(dialogs.shown).toHaveLength(0);
    // The result is the validity pane's; the problem list stays closed and the status line keeps
    // what it said.
    expect(ctx.store.getState().lastCheck?.problems).toBe(0);
    expect(ctx.store.getState().validation).toBeNull();
    expect(ctx.store.getState().statusMessage).toBeNull();
  });

  it('refreshes the problem list when it is open, as a save does', async () => {
    const { ctx } = await setup(ERRORS, [['yes']]);
    actions.setValidation(ctx.store, CLEAN_REPORT);
    expect(await confirmBookExport(ctx)).toBe(true);
    expect(ctx.store.getState().validation?.errorCount).toBe(3);
  });

  it("asks Save's question for an invalid book: No stops the export, Yes lets it go", async () => {
    const declined = await setup(ERRORS, [['no']]);
    expect(await confirmBookExport(declined.ctx)).toBe(false);
    expect(declined.dialogs.shown).toHaveLength(1);
    expect(declined.dialogs.shown[0]).toMatchObject({
      buttons: 'yesNo',
      defaultButton: 'no',
      testId: 'dialog-export-validation-failed',
      caption: 'Validation failed',
    });
    expect(declined.dialogs.shown[0]!.text).toContain('3 errors found.');
    expect(declined.dialogs.shown[0]!.text).toContain('export');

    const accepted = await setup(ERRORS, [['yes']]);
    expect(await confirmBookExport(accepted.ctx)).toBe(true);
    expect(accepted.dialogs.shown).toHaveLength(1);
  });

  it('uses the last check while nothing changed since it, and checks again after a change', async () => {
    const { ctx, dialogs, validations } = await setup(ERRORS, [['yes', 'yes']]);
    actions.setLastCheck(ctx.store, 0);
    expect(await confirmBookExport(ctx)).toBe(true);
    expect(validations()).toBe(0);
    expect(dialogs.shown).toHaveLength(0);

    actions.setLastCheck(ctx.store, 5);
    expect(await confirmBookExport(ctx)).toBe(true);
    expect(validations()).toBe(0);
    expect(dialogs.shown[0]!.text).toContain('5 errors found.');

    // An edit makes the last check stale: a new check gives the count.
    ctx.store.setState((s) => ({ contentRevision: s.contentRevision + 1 }));
    expect(await confirmBookExport(ctx)).toBe(true);
    expect(validations()).toBe(1);
    expect(dialogs.shown[1]!.text).toContain('3 errors found.');
  });
});

describe('the check shared and kept honest (requester, rc.5)', () => {
  it('waits for the check after loading rather than running a second one', async () => {
    const { ctx, dialogs, validations } = await setup(ERRORS, [['no']]);
    const loading = validateBook(ctx, { quiet: true });
    expect(await confirmBookExport(ctx)).toBe(false);
    await loading;
    expect(validations()).toBe(1);
    expect(dialogs.shown).toHaveLength(1);
  });

  it('keeps a check of content that changed while it ran stale', async () => {
    const { ctx } = await setup(ERRORS);
    const checking = validateBook(ctx, { quiet: true });
    ctx.store.setState((s) => ({ contentRevision: s.contentRevision + 1 }));
    await checking;
    const { lastCheck, contentRevision } = ctx.store.getState();
    expect(lastCheck?.problems).toBe(3);
    expect(lastCheck?.revision).not.toBe(contentRevision);
  });
});
