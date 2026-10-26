/**
 * The table edit target of the Body view (feature 006, T041; I10; data-model §6.1, §6.2, §9.5):
 * the Body adapter's members, when it is editable, `run` as one undo step, the active target
 * per view, `subscribeTableTargets`, and the hotkey scope resolver giving the Body editor's DOM
 * (US10 adds the fields and the focus rule).
 */

import { TextSelection } from 'prosemirror-state';

import { fb2Schema } from '@/editor/schema';
import {
  activeTableTarget,
  bodyTableTarget,
  subscribeTableTargets,
} from '@/features/tables/target';
import { actions } from '@/model/store';

import { fakeRunLock } from './testUtils';
import { caretIn, posOf, removeHarnessHosts, tablesHarness } from './tablesHarness';

afterEach(() => {
  removeHarnessHosts();
});

describe('the Body table edit target', () => {
  it('has the members of the Body adapter', async () => {
    const harness = await tablesHarness();
    const { store, controller, view } = harness;
    const target = activeTableTarget(store)!;
    expect(target).toBe(bodyTableTarget(store));
    expect(target.kind).toBe('body');
    expect(target.key).toBe('body');
    expect(target.state).toBe(controller.editorState);
    expect(target.view).toBe(view);
    expect(target.dom).toBe(view.dom);
    expect(target.editable).toBe(true);
    expect(target.imagesOnlyInCells).toBe(false);
    // The controller's generator: ids the node-id plugin would also give.
    const first = target.nextNodeId();
    const second = target.nextNodeId();
    expect(first).toMatch(/^ui_\d+$/);
    expect(Number(second.slice(3))).toBe(Number(first.slice(3)) + 1);
    // A dry run and a run of a ProseMirror command.
    caretIn(harness, 't1-0-0', 2);
    const insertY = (state: typeof view.state, dispatch?: (tr: typeof view.state.tr) => void) => {
      if (dispatch) dispatch(state.tr.insertText('Y'));
      return true;
    };
    const doc = view.state.doc;
    expect(target.canRun(insertY)).toBe(true);
    expect(view.state.doc).toBe(doc);
    // setSelection: a selection change only, no undo step.
    const entries = harness.services.undo.entries().length;
    target.setSelection(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, posOf(harness, 't1-2-2') + 1),
      ),
    );
    expect(view.state.selection.head).toBe(posOf(harness, 't1-2-2') + 1);
    expect(harness.services.undo.entries().length).toBe(entries);
  });

  it('run records exactly one undo-coordinator entry', async () => {
    const harness = await tablesHarness();
    const target = activeTableTarget(harness.store)!;
    caretIn(harness, 't1-1-1', 4);
    const before = harness.services.undo.entries().length;
    const write = (
      state: NonNullable<typeof target.state>,
      dispatch?: (tr: ReturnType<NonNullable<typeof target.state>['tr']['insertText']>) => void,
    ) => {
      if (dispatch) dispatch(state.tr.insertText('Z'));
      return true;
    };
    expect(target.run(write)).toBe(true);
    expect(harness.services.undo.entries().length).toBe(before + 1);
    const cell = harness.controller.editorState!.doc.nodeAt(posOf(harness, 't1-1-1'))!;
    expect(cell.textContent).toBe('r1c1Z');
  });

  it('is not editable in another view, with a controller that is not editable, or under the run lock', async () => {
    const harness = await tablesHarness();
    const { store, controller } = harness;
    const target = bodyTableTarget(store)!;
    expect(target.editable).toBe(true);
    actions.setActiveView(store, 'source');
    expect(target.editable).toBe(false);
    actions.setActiveView(store, 'body');
    controller.setEditable(false);
    expect(target.editable).toBe(false);
    controller.setEditable(true);
    actions.setRunLock(store, fakeRunLock('script'));
    expect(target.editable).toBe(false);
    actions.setRunLock(store, fakeRunLock('ai'));
    expect(target.editable).toBe(false);
    actions.setRunLock(store, null);
    expect(target.editable).toBe(true);
  });

  it('activeTableTarget: the Body adapter in the Body view, none in the Source and Description views', async () => {
    const harness = await tablesHarness();
    const { store } = harness;
    expect(activeTableTarget(store)?.kind).toBe('body');
    actions.setActiveView(store, 'source');
    expect(activeTableTarget(store)).toBeNull();
    actions.setActiveView(store, 'description');
    expect(activeTableTarget(store)).toBeNull();
    actions.setActiveView(store, 'body');
    expect(activeTableTarget(store)).toBe(bodyTableTarget(store));
  });

  it('subscribeTableTargets fires on a view switch and on a Body selection change', async () => {
    const harness = await tablesHarness();
    const { store } = harness;
    const listener = vi.fn();
    const unsubscribe = subscribeTableTargets(store, listener);
    actions.setActiveView(store, 'source');
    expect(listener).toHaveBeenCalledTimes(1);
    actions.setActiveView(store, 'body');
    expect(listener).toHaveBeenCalledTimes(2);
    caretIn(harness, 't1-2-0', 1);
    expect(listener.mock.calls.length).toBeGreaterThan(2);
    const calls = listener.mock.calls.length;
    unsubscribe();
    caretIn(harness, 't1-0-1', 1);
    actions.setActiveView(store, 'source');
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('the hotkey scope resolver gives the Body editor DOM', async () => {
    const harness = await tablesHarness();
    const { services, view, store } = harness;
    const cell = view.dom.querySelector('td');
    expect(cell).not.toBeNull();
    expect(services.commands.allowsHotkey('table.insertRowAbove', cell)).toBe(true);
    expect(services.commands.allowsHotkey('table.insertRowAbove', document.body)).toBe(false);
    // Unscoped commands are not affected; in the Source view no scope element exists.
    expect(services.commands.allowsHotkey('insert.table', document.body)).toBe(true);
    actions.setActiveView(store, 'source');
    expect(services.commands.allowsHotkey('table.insertRowAbove', cell)).toBe(false);
    // The schema is the editor's: a table node is what the Body editor shows.
    expect(view.state.doc.nodeAt(posOf(harness, 't1'))!.type).toBe(fb2Schema.nodes.table);
  });
});
