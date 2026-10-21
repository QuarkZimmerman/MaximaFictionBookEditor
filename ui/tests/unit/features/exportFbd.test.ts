/**
 * File > Export > Export as FBD... (feature 004 US5, T045; spec FR-040 to FR-043; research
 * R3.3, R6.4): the save dialog's request - the single descriptors type, no encoding choice,
 * `<folder>/<stem>.fbd` for a saved document and the bare proposed name for a never-saved one -
 * the `doc.exportDescription` loop with Save's "export anyway?" prompt, the messages of the
 * refused own file (1006) and of a failed write (1002), the status line, and what the export
 * never touches: the document's path, kind, encoding and modified state.
 */

import { exportDefaultPath, exportFbd, exportFileTypes } from '@/features/transfer/exportFbd';
import { actions } from '@/model/store';
import { RpcErrorCode } from '@/rpc/types';

import {
  CLEAN_REPORT,
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  makeContext,
  rpcError,
} from './testUtils';

const ERRORS = { issues: [], errorCount: 2, warningCount: 0, durationMs: 1 };

async function setup(
  responses: Record<string, unknown>,
  answers: Parameters<typeof fakeDialogs> = [],
  document = fakeDocument(),
) {
  const rpc = fakeRpc(responses);
  const dialogs = fakeDialogs(...answers);
  const ctx = await makeContext({ rpc: rpc.client, dialogs });
  actions.setConnection(ctx.store, 'connected');
  actions.setDocument(ctx.store, document);
  return { rpc, dialogs, ctx };
}

describe('Export as FBD (feature 004 US5)', () => {
  it('offers the descriptors type alone and proposes the document stem with .fbd', async () => {
    const { ctx } = await setup({});
    expect(exportFileTypes(ctx.t)).toEqual([
      { name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] },
    ]);
    expect(exportDefaultPath(ctx.store.getState(), ctx.t)).toBe('/books/alpha.fbd');
    // The stem is reused whatever the extension's case; a Windows path keeps its separators.
    actions.setDocument(ctx.store, fakeDocument({ path: 'C:\\Книги\\book.FB2' }));
    expect(exportDefaultPath(ctx.store.getState(), ctx.t)).toBe('C:\\Книги\\book.fbd');
    // A never-saved document: the bare proposed name (FR-050), placed by the dialog in the
    // remembered folder.
    actions.setDocument(ctx.store, fakeDocument({ path: undefined }));
    expect(exportDefaultPath(ctx.store.getState(), ctx.t)).toBe('Petrov Ivan - Alpha.fbd');
    const untitled = fakeDocument({ path: undefined });
    untitled.description.titleInfo.authors = [];
    untitled.description.titleInfo.bookTitle = '';
    actions.setDocument(ctx.store, untitled);
    expect(exportDefaultPath(ctx.store.getState(), ctx.t)).toBe('Untitled.fbd');
  });

  it('exports through doc.exportDescription and reports in the status bar; the document is untouched', async () => {
    const { rpc, dialogs, ctx } = await setup({
      'dialog.saveFile': { path: '/out/alpha.fbd' },
      'doc.exportDescription': { path: '/out/alpha.fbd', validation: CLEAN_REPORT, converted: [] },
    });
    actions.setModified(ctx.store, true);
    expect(await exportFbd(ctx)).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toEqual(['dialog.saveFile', 'doc.exportDescription']);
    expect(rpc.calls[0]!.params).toEqual({
      title: 'Export as FBD',
      filters: [{ name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] }],
      selectedFilter: 0,
      defaultPath: '/books/alpha.fbd',
    });
    expect(rpc.calls[0]!.params).not.toHaveProperty('encodingChoices');
    expect(rpc.calls[1]!.params).toEqual({
      docId: 'doc-1',
      document: ctx.store.getState().document,
      path: '/out/alpha.fbd',
      force: false,
    });
    expect(dialogs.shown).toEqual([]);
    const state = ctx.store.getState();
    expect(state.statusMessage).toBe('Description exported to /out/alpha.fbd. No errors found.');
    // A copy, not a save: path, kind, encoding and the modified flag are as before.
    expect(state.path).toBe('/books/alpha.fb2');
    expect(state.fileKind).toBe('fb2');
    expect(state.document?.sourceEncoding).toBe('windows-1251');
    expect(state.modified).toBe(true);
  });

  it("asks with Save's prompt when the exported content has errors: No writes nothing, Yes repeats with force", async () => {
    const calls: { force?: boolean }[] = [];
    const responses = {
      'dialog.saveFile': { path: '/out/alpha.fbd' },
      'doc.exportDescription': (params: { force?: boolean }) => {
        calls.push(params);
        return params.force
          ? { path: '/out/alpha.fbd', validation: ERRORS, converted: [] }
          : { needsConfirmation: true, validation: ERRORS };
      },
    };
    const declined = await setup(responses, [['no']]);
    expect(await exportFbd(declined.ctx)).toBe(false);
    expect(calls).toEqual([{ force: false }].map((c) => expect.objectContaining(c)));
    expect(declined.dialogs.shown).toHaveLength(1);
    expect(declined.dialogs.shown[0]).toMatchObject({
      buttons: 'yesNo',
      defaultButton: 'no',
      testId: 'dialog-export-validation-failed',
      caption: 'Validation failed',
    });
    expect(declined.dialogs.shown[0]!.text).toContain('2 errors found.');
    expect(declined.dialogs.shown[0]!.text).toContain('export');
    expect(declined.ctx.store.getState().statusMessage).toBeNull();

    calls.length = 0;
    const accepted = await setup(responses, [['yes']]);
    expect(await exportFbd(accepted.ctx)).toBe(true);
    expect(calls.map((c) => c.force)).toEqual([false, true]);
    expect(accepted.ctx.store.getState().statusMessage).toBe(
      'Description exported to /out/alpha.fbd. 2 errors found.',
    );
  });

  it("refuses the open document's own file with its message and reports a failed write", async () => {
    const same = await setup({
      'dialog.saveFile': { path: '/books/alpha.fb2' },
      'doc.exportDescription': rpcError(RpcErrorCode.docSameAsOpenFile, 'doc.sameAsOpenFile', {
        path: '/books/alpha.fb2',
      }),
    });
    expect(await exportFbd(same.ctx)).toBe(false);
    expect(same.dialogs.shown).toHaveLength(1);
    expect(same.dialogs.shown[0]).toMatchObject({
      icon: 'error',
      testId: 'dialog-export-same-file',
    });
    expect(same.dialogs.shown[0]!.text).toContain('/books/alpha.fb2');
    expect(same.ctx.store.getState().statusMessage).toBeNull();

    const failed = await setup({
      'dialog.saveFile': { path: '/out/alpha.fbd' },
      'doc.exportDescription': rpcError(RpcErrorCode.docIoError, 'doc.ioError', {
        path: '/out/alpha.fbd',
        reason: 'No space left on device',
      }),
    });
    expect(await exportFbd(failed.ctx)).toBe(false);
    expect(failed.dialogs.shown).toHaveLength(1);
    expect(failed.dialogs.shown[0]).toMatchObject({
      icon: 'error',
      testId: 'dialog-export-failed',
    });
    expect(failed.dialogs.shown[0]!.text).toBe(
      'Cannot save /out/alpha.fbd.\nNo space left on device',
    );
  });

  it('does nothing when the dialog is cancelled or no document is open', async () => {
    const cancelled = await setup({ 'dialog.saveFile': {} });
    expect(await exportFbd(cancelled.ctx)).toBe(false);
    expect(cancelled.rpc.calls.map((c) => c.method)).toEqual(['dialog.saveFile']);

    const { rpc, ctx } = await setup({});
    actions.closeDocument(ctx.store);
    expect(await exportFbd(ctx)).toBe(false);
    expect(rpc.calls).toEqual([]);
  });
});
