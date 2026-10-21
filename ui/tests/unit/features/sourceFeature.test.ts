/**
 * Source tools feature (T078/T080/T081): the registrar's commands and adapters, "Go to wrong
 * tag" (parse error -> validation report -> next error after the cursor), "Go to matching tag",
 * the fold-level commands, the Source <-> model synchronisation (remap of the Body caret and
 * selection, Body history cleared, blocked switch) and the Source history as its own undo view.
 */

import { createCommandRegistry, type CommandContext } from '@/app/commands';
import { createIssueNavigator, setNodeNavigator } from '@/dialogs/validation';
import { registerFileCommands } from '@/features/file/fileCommands';
import { registerSourceFeature } from '@/features/source';
import { firstErrorIssue, nextErrorIssue } from '@/features/source/navigation';
import type { ValidationReport } from '@/model/document';
import { actions } from '@/model/store';
import { RpcErrorCode } from '@/rpc/types';
import { getSourceEditor, sourceEditorFor } from '@/views/source/sourceEditor';
import {
  commitPendingSource,
  isValidationFresh,
  requestViewSwitch,
  setSourceOnlyText,
  sourceSession,
  updateSourceText,
} from '@/views/source/sync';

import { CLEAN_REPORT, fakeDocument, fakeRpc, makeContext, rpcError } from './testUtils';

const XML = `<?xml version="1.0"?>
<FictionBook>
  <body>
    <section>
      <p>One</p>
      <p>Two</p>
    </section>
  </body>
</FictionBook>
`;

const REPORT: ValidationReport = {
  issues: [
    { severity: 'warning', code: 'genre.unknown', params: { code: 'x' }, line: 2, column: 1 },
    { severity: 'error', code: 'schema.invalid', params: { message: 'b' }, line: 6, column: 7 },
    { severity: 'error', code: 'schema.invalid', params: { message: 'a' }, line: 4, column: 5 },
    { severity: 'error', code: 'schema.invalid', params: { message: 'c' }, nodeId: 'n3' },
  ],
  errorCount: 3,
  warningCount: 1,
  durationMs: 1,
};

/** A command context wired like the application: file + source features on one registry. */
async function setup(responses: Record<string, unknown> = {}) {
  const rpc = fakeRpc({ 'doc.watch': {}, 'doc.position': {}, 'doc.recent': [], ...responses });
  const ctx = await makeContext({ rpc: rpc.client });
  const registry = createCommandRegistry();
  registerFileCommands(registry);
  registerSourceFeature({
    commands: registry,
    undo: ctx.undo,
    carets: ctx.carets!,
    store: ctx.store,
    hotkeys: ctx.hotkeys,
  });
  actions.setConnection(ctx.store, 'connected');
  actions.setDocument(ctx.store, fakeDocument());
  return { ctx, registry, rpc };
}

/** Loads `text` into the (headless) Source editor as the serialisation of the model. */
async function loadSource(ctx: CommandContext, text: string) {
  const controller = sourceEditorFor(ctx.store, ctx.undo);
  const session = sourceSession(ctx.store);
  session.docId = ctx.store.getState().docId;
  session.text = text;
  session.baseline = text;
  session.model = ctx.store.getState().document;
  await controller.load({ ...ctx, rpc: null });
  return controller;
}

afterEach(() => setNodeNavigator(null));

describe('registrar', () => {
  it('replaces the navigation stubs and registers the Source undo/caret adapters', async () => {
    const { ctx, registry } = await setup();
    for (const id of [
      'edit.gotoWrongTag',
      'edit.gotoMatchTag',
      'source.collapse1',
      'source.expand9',
    ]) {
      expect(registry.get(id)?.stub, id).toBeUndefined();
    }
    expect(ctx.undo.hasView('source')).toBe(true);
    expect(ctx.carets!.has('source')).toBe(true);
    // Body view, no report: only Go to wrong tag needs the Source view or a report.
    expect(registry.isEnabled('edit.gotoWrongTag', ctx)).toBe(false);
    expect(registry.isEnabled('edit.gotoMatchTag', ctx)).toBe(false);
    expect(registry.isEnabled('source.collapse2', ctx)).toBe(false);
    actions.setValidation(ctx.store, REPORT);
    expect(registry.isEnabled('edit.gotoWrongTag', ctx)).toBe(true);
    actions.setValidation(ctx.store, null);
    actions.setActiveView(ctx.store, 'source');
    expect(registry.isEnabled('edit.gotoWrongTag', ctx)).toBe(true);
    expect(registry.isEnabled('edit.gotoMatchTag', ctx)).toBe(true);
    expect(registry.isEnabled('source.collapse2', ctx)).toBe(true);
    expect(registry.isEnabled('source.expand5', ctx)).toBe(true);
    expect(registry.get('source.collapse3')?.labelParams).toEqual({ count: 3 });
  });
});

describe('issue ordering', () => {
  it('picks the next positioned error after the caret, wrapping, and the first error overall', () => {
    expect(nextErrorIssue(REPORT, null)?.params.message).toBe('a');
    expect(nextErrorIssue(REPORT, { line: 1, column: 1 })?.params.message).toBe('a');
    expect(nextErrorIssue(REPORT, { line: 4, column: 5 })?.params.message).toBe('b');
    expect(nextErrorIssue(REPORT, { line: 6, column: 7 })?.params.message).toBe('a');
    expect(nextErrorIssue(CLEAN_REPORT, null)).toBeNull();
    expect(firstErrorIssue(REPORT)?.params.message).toBe('a');
    const nodeOnly: ValidationReport = {
      ...CLEAN_REPORT,
      errorCount: 1,
      issues: [{ severity: 'error', code: 'x', params: {}, nodeId: 'n2' }],
    };
    expect(firstErrorIssue(nodeOnly)?.nodeId).toBe('n2');
    expect(firstErrorIssue(CLEAN_REPORT)).toBeNull();
  });
});

describe('Go to wrong tag', () => {
  it('parses pending Source text first and positions the cursor on the parse error (no dialog)', async () => {
    const { ctx, registry, rpc } = await setup({
      'doc.fromXml': rpcError(RpcErrorCode.docParseError, 'parse', {
        line: 5,
        column: 9,
        message: 'Opening and ending tag mismatch',
      }),
    });
    const controller = await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');
    updateSourceText(ctx.store, XML.replace('</p>\n      <p>Two', '\n      <p>Two'));
    expect(ctx.store.getState().sourceDirty).toBe(true);

    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toContain('doc.fromXml');
    expect(ctx.store.getState().sourceParseError).toMatchObject({ line: 5, column: 9 });
    expect(controller.getCaret()).toEqual({ view: 'source', line: 5, column: 9 });
    expect(ctx.dialogs.shown).toHaveLength(0); // silent: the cursor position is the answer
    expect(ctx.store.getState().statusMessage).toContain('line 5, column 9');
  });

  it('validates when there is no fresh report and walks the errors after the cursor', async () => {
    const { ctx, registry, rpc } = await setup({ 'doc.validate': REPORT });
    const controller = await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');

    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(rpc.calls.filter((c) => c.method === 'doc.validate')).toHaveLength(1);
    expect(ctx.store.getState().validation).toBe(REPORT); // the panel shows the report
    expect(controller.getCaret()).toEqual({ view: 'source', line: 4, column: 5 });
    expect(isValidationFresh(ctx.store)).toBe(true);

    // The report is fresh for this text: the next error is used without re-validating.
    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(rpc.calls.filter((c) => c.method === 'doc.validate')).toHaveLength(1);
    expect(controller.getCaret()).toEqual({ view: 'source', line: 6, column: 7 });
    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(controller.getCaret()).toEqual({ view: 'source', line: 4, column: 5 }); // wrapped

    // Editing makes the report stale: the next call validates again.
    rpc.responses['doc.fromXml'] = { document: ctx.store.getState().document };
    updateSourceText(ctx.store, XML.replace('One', 'Uno'));
    expect(isValidationFresh(ctx.store)).toBe(false);
    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(rpc.calls.filter((c) => c.method === 'doc.fromXml')).toHaveLength(1);
    expect(rpc.calls.filter((c) => c.method === 'doc.validate')).toHaveLength(2);
  });

  it('reports "No errors found." for a clean document', async () => {
    const { ctx, registry } = await setup({ 'doc.validate': CLEAN_REPORT });
    await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');
    await registry.execute('edit.gotoWrongTag', ctx);
    expect(ctx.store.getState().statusMessage).toBe('No errors found.');
  });

  it('from the Body view goes to the first error of the panel through the issue navigator', async () => {
    const { ctx, registry, rpc } = await setup({ 'doc.validate': REPORT });
    await loadSource(ctx, XML);
    const bodySet = vi.fn(() => true);
    ctx.carets!.register('body', { get: () => null, set: bodySet });
    expect(ctx.store.getState().activeView).toBe('body');
    // Without a report the command is disabled outside the Source view.
    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(false);
    actions.setValidation(ctx.store, REPORT);
    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(rpc.calls.filter((c) => c.method === 'doc.validate')).toHaveLength(0);
    // the first positioned error has no node: it is shown in the Source view
    expect(ctx.store.getState().activeView).toBe('source');
    expect(getSourceEditor(ctx.store)!.getCaret()).toEqual({ view: 'source', line: 4, column: 5 });
  });

  it('without a core uses the editor parser for unclosed tags', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    registerSourceFeature({
      commands: registry,
      undo: ctx.undo,
      carets: ctx.carets!,
      store: ctx.store,
      hotkeys: ctx.hotkeys,
    });
    actions.setDocument(ctx.store, fakeDocument());
    const broken = XML.replace('<p>One</p>', '<p>One');
    const controller = await loadSource(ctx, broken);
    actions.setActiveView(ctx.store, 'source');
    expect(await registry.execute('edit.gotoWrongTag', ctx)).toBe(true);
    expect(controller.getCaret()).toEqual({ view: 'source', line: 5, column: 7 });
  });
});

describe('Go to matching tag and fold levels', () => {
  it('moves between the opening and closing tag of the element under the cursor', async () => {
    const { ctx, registry } = await setup();
    const controller = await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');
    controller.goTo(4, 6); // inside "<section>"
    expect(await registry.execute('edit.gotoMatchTag', ctx)).toBe(true);
    expect(controller.getCaret()).toEqual({ view: 'source', line: 7, column: 7 }); // "</|section>"
    await registry.execute('edit.gotoMatchTag', ctx);
    expect(controller.getCaret()).toEqual({ view: 'source', line: 4, column: 6 }); // "<|section>"
    controller.goTo(5, 11); // in the text "One" (column 10 touches the tag end: FBE counts it)
    await registry.execute('edit.gotoMatchTag', ctx);
    expect(controller.getCaret()).toEqual({ view: 'source', line: 5, column: 11 });
    expect(ctx.store.getState().statusMessage).toBe(
      'The cursor is not on a tag with a matching pair.',
    );
  });

  it('collapse/expand level commands fold the elements of that nesting level', async () => {
    const { ctx, registry } = await setup();
    const controller = await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');
    const { foldedRanges } = await import('@codemirror/language');
    await registry.execute('source.collapse2', ctx); // <body>
    expect(foldedRanges(controller.state).size).toBe(1);
    await registry.execute('source.collapse3', ctx); // <section>
    expect(foldedRanges(controller.state).size).toBe(2);
    await registry.execute('source.expand2', ctx);
    expect(foldedRanges(controller.state).size).toBe(1);
    await registry.execute('source.expand3', ctx);
    expect(foldedRanges(controller.state).size).toBe(0);
  });
});

describe('Source <-> model synchronisation (T081)', () => {
  it('applies the remap table to the remembered Body caret and the selection, clears the Body history', async () => {
    const parsed = fakeDocument({
      bodies: [
        {
          type: 'body',
          attrs: { nodeId: 'm1' },
          content: [
            {
              type: 'section',
              attrs: { nodeId: 'm2' },
              content: [
                { type: 'p', attrs: { nodeId: 'm3' }, content: [{ type: 'text', text: 'Uno' }] },
              ],
            },
          ],
        },
      ],
    });
    const { ctx, rpc } = await setup({
      'doc.fromXml': {
        document: parsed,
        warnings: [],
        remap: { map: { n1: 'm1', n2: 'm2', n3: 'm3' }, unmappedOld: [], unmappedNew: [] },
      },
    });
    await loadSource(ctx, XML);
    ctx.undo.record('body', 'Body edit');
    ctx.undo.record('source', 'Source edit');
    actions.setSelection(ctx.store, 'body[1]/section[1]/p[1]', 'n3');
    sourceSession(ctx.store).bodyCaret = { view: 'body', nodeId: 'n3', offset: 2 };
    updateSourceText(ctx.store, XML.replace('One', 'Uno'));

    expect(await commitPendingSource(ctx)).toBe('committed');
    expect(rpc.calls.find((c) => c.method === 'doc.fromXml')?.params).toMatchObject({
      docId: 'doc-1',
    });
    const state = ctx.store.getState();
    expect(state.document).toBe(parsed);
    expect(state.sourceDirty).toBe(false);
    expect(state.modified).toBe(true);
    expect(state.selectionNodeId).toBe('m3');
    expect(state.selectionPath).toBe('body[1]/section[1]/p[1]');
    const session = sourceSession(ctx.store);
    expect(session.bodyCaret).toEqual({ view: 'body', nodeId: 'm3', offset: 2 });
    expect(session.lastRemap?.map.n2).toBe('m2');
    // the Body history is gone, the Source history stays
    expect(ctx.undo.entries().map((e) => e.view)).toEqual(['source']);
  });

  it('drops carets of vanished nodes', async () => {
    const { ctx } = await setup({
      'doc.fromXml': {
        document: fakeDocument(),
        remap: { map: { n1: 'n1' }, unmappedOld: ['n2', 'n3'], unmappedNew: [] },
      },
    });
    await loadSource(ctx, XML);
    actions.setSelection(ctx.store, 'body[1]/section[1]/p[1]', 'n3');
    sourceSession(ctx.store).bodyCaret = { view: 'body', nodeId: 'n3' };
    updateSourceText(ctx.store, XML + '\n');
    expect(await commitPendingSource(ctx)).toBe('committed');
    expect(ctx.store.getState().selectionNodeId).toBeNull();
    expect(sourceSession(ctx.store).bodyCaret).toBeNull();
  });

  it('remembers the Body caret on the way to Source and restores the remapped one on return', async () => {
    const parsed = fakeDocument();
    const { ctx } = await setup({
      'doc.toXml': { text: XML },
      'doc.fromXml': {
        document: parsed,
        remap: { map: { n1: 'n1', n2: 'n2', n3: 'p9' }, unmappedOld: [], unmappedNew: [] },
      },
    });
    const bodyCaret = { view: 'body' as const, nodeId: 'n3', offset: 1 };
    const bodySet = vi.fn(() => true);
    ctx.carets!.register('body', { get: () => bodyCaret, set: bodySet });

    expect(await requestViewSwitch(ctx, 'source')).toBe(true);
    expect(ctx.store.getState().activeView).toBe('source');
    expect(ctx.undo.currentView).toBe('source'); // boundary committed
    expect(sourceSession(ctx.store).bodyCaret).toEqual(bodyCaret);

    const controller = sourceEditorFor(ctx.store, ctx.undo);
    await controller.load(ctx);
    expect(controller.text).toBe(XML);
    updateSourceText(ctx.store, XML.replace('One', 'Uno'));
    expect(await requestViewSwitch(ctx, 'body')).toBe(true);
    expect(ctx.store.getState().activeView).toBe('body');
    await vi.waitFor(() =>
      expect(bodySet).toHaveBeenCalledWith({ view: 'body', nodeId: 'p9', offset: 1 }),
    );
  });

  it('refuses to leave the Source view while the XML is malformed (FR-021)', async () => {
    const { ctx } = await setup({
      'doc.fromXml': rpcError(RpcErrorCode.docParseError, 'parse', {
        line: 3,
        column: 4,
        message: 'bad',
      }),
    });
    await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');
    updateSourceText(ctx.store, '<FictionBook><p>oops</FictionBook>');
    expect(await requestViewSwitch(ctx, 'body')).toBe(false);
    expect(ctx.store.getState().activeView).toBe('source');
    expect(ctx.dialogs.shown[0]?.testId).toBe('dialog-bad-xml');
    expect(ctx.dialogs.shown[0]?.text).toContain('Go to wrong tag');
    expect(ctx.store.getState().sourceParseError).toMatchObject({ line: 3, column: 4 });
    expect(sourceSession(ctx.store).pendingCaret).toEqual({ line: 3, column: 4 });
  });

  it('Source-only text parses back into a model when it becomes well-formed', async () => {
    const { ctx } = await setup({ 'doc.fromXml': { document: fakeDocument() } });
    ctx.store.setState({ sourceOnly: true, activeView: 'source' });
    setSourceOnlyText(ctx.store, 'doc-1', XML);
    expect(await requestViewSwitch(ctx, 'description')).toBe(true);
    expect(ctx.store.getState()).toMatchObject({
      sourceOnly: false,
      activeView: 'description',
      sourceDirty: false,
    });
  });
});

describe('Source history as its own undo view', () => {
  it('records Source edits in the coordinator and undoes/redoes them headless', async () => {
    const { ctx } = await setup();
    const controller = await loadSource(ctx, XML);
    actions.setActiveView(ctx.store, 'source');
    controller.target.dispatch({
      changes: { from: XML.indexOf('One'), to: XML.indexOf('One') + 3, insert: 'Uno' },
      userEvent: 'input.type',
    });
    expect(controller.text).toContain('Uno');
    expect(ctx.store.getState()).toMatchObject({ sourceDirty: true, modified: true });
    expect(ctx.undo.peekUndo()).toMatchObject({ view: 'source', label: 'views.source.undoLabel' });
    expect(controller.canUndo).toBe(true);

    // Undo from another view activates Source and restores the text.
    actions.setActiveView(ctx.store, 'body');
    expect(ctx.undo.undo()).toBe(true);
    expect(controller.text).toBe(XML);
    expect(ctx.store.getState().sourceDirty).toBe(false);
    expect(ctx.undo.canRedo).toBe(true);
    expect(ctx.undo.redo()).toBe(true);
    expect(controller.text).toContain('Uno');
    expect(ctx.store.getState().sourceDirty).toBe(true);

    // The caret provider works headless too.
    expect(ctx.carets!.set({ view: 'source', line: 5, column: 3 })).toBe(true);
    expect(ctx.carets!.get('source')).toEqual({ view: 'source', line: 5, column: 3 });
  });

  it('a fresh serialisation of an edited model drops the stale Source history', async () => {
    const { ctx, rpc } = await setup({ 'doc.toXml': { text: XML } });
    const controller = sourceEditorFor(ctx.store, ctx.undo);
    await controller.load(ctx);
    controller.target.dispatch({ changes: { from: 0, insert: ' ' }, userEvent: 'input.type' });
    expect(ctx.undo.undoDepth).toBe(1);
    // the text was committed and the model edited elsewhere: a new serialisation comes back
    sourceSession(ctx.store).baseline = controller.text;
    actions.updateDocument(ctx.store, { ...ctx.store.getState().document! });
    rpc.responses['doc.toXml'] = { text: XML.replace('One', 'Eins') };
    await controller.load(ctx);
    expect(controller.text).toContain('Eins');
    expect(ctx.undo.undoDepth).toBe(0);
    expect(controller.canUndo).toBe(false);
  });
});

describe('issue navigator (T080)', () => {
  it('uses the installed Body node navigator and falls back to the Source position', async () => {
    const { ctx } = await setup();
    const controller = await loadSource(ctx, XML);
    const toNode = vi.fn(async (nodeId: string) => nodeId === 'n3');
    setNodeNavigator(toNode);
    const navigate = createIssueNavigator(ctx);
    expect(ctx.store.getState().activeView).toBe('body');
    expect(
      await navigate({ severity: 'error', code: 'x', params: {}, nodeId: 'n3', line: 4 }),
    ).toBe(true);
    expect(toNode).toHaveBeenCalledWith('n3', ctx);
    expect(ctx.store.getState().activeView).toBe('body');
    // the node vanished: the Source position is used instead (view switched, line highlighted)
    expect(
      await navigate({
        severity: 'error',
        code: 'x',
        params: {},
        nodeId: 'gone',
        line: 6,
        column: 7,
      }),
    ).toBe(true);
    expect(ctx.store.getState().activeView).toBe('source');
    expect(controller.getCaret()).toEqual({ view: 'source', line: 6, column: 7 });
    const { highlightedLine } = await import('@/views/source/extensions');
    expect(highlightedLine(controller.state)).toBe(6);
    // in the Source view a positioned issue stays in the Source view even with a node
    expect(
      await navigate({ severity: 'error', code: 'x', params: {}, nodeId: 'n3', line: 2 }),
    ).toBe(true);
    expect(ctx.store.getState().activeView).toBe('source');
    expect(controller.getCaret()).toEqual({ view: 'source', line: 2, column: 1 });
    // the explicit option wins over the installed navigator
    const custom = vi.fn(() => true);
    await createIssueNavigator(ctx, { navigateToNode: custom })({
      severity: 'error',
      code: 'x',
      params: {},
      nodeId: 'n2',
    });
    expect(custom).toHaveBeenCalledWith('n2', ctx);
  });
});
