/**
 * The table edit target of the Body view (feature 006, T041; I10; data-model §6.1, §6.2, §9.5):
 * the Body adapter's members, when it is editable, `run` as one undo step, the active target
 * per view, `subscribeTableTargets`, and the hotkey scope resolver giving the Body editor's DOM.
 *
 * US10 (T158; FR-044, FR-048; C6, C30; I10; data-model §6.1, §10.1): the field adapter of
 * `createFieldTarget` - its members, `run` as one discrete dispatch, a dry run, a plain
 * selection dispatch, not editable under the field's lock -; the focus rule of the Description
 * view (focus entering a field makes it active, the chrome keeps it, another rich field replaces
 * it, a plain field clears it, an unmount clears it); the Body adapter in the Body view and none
 * in the Source view whatever the last field was; `subscribeTableTargets` on activation changes
 * and on the active field's changes only; the hotkey scope at the active field; `fieldTargetFor`;
 * and *Table ID* (`nav.selectTableId`) available with a field active. US11 (T173; T180;
 * data-model §6.1, §15.4): focus entering the assistant's panel keeps the active field, so a
 * block of the field still reaches a request sent from there.
 */

import { TextSelection, type Command, type Transaction } from 'prosemirror-state';

import { DISCRETE_STEP } from '@/editor/commands/util';
import { fb2Schema } from '@/editor/schema';
import { CellBlockSelection } from '@/editor/table/selection';
import { registerBarFocus } from '@/features/editing/barFocus';
import {
  activateFieldTarget,
  activeTableTarget,
  bodyTableTarget,
  fieldTargetFor,
  subscribeTableTargets,
} from '@/features/tables/target';
import { actions } from '@/model/store';
import { richFieldIdGenerator } from '@/views/description/richFieldState';

import { fakeRunLock } from './testUtils';
import {
  caretIn,
  fieldCaret,
  fieldHost,
  fieldPos,
  posOf,
  removeHarnessHosts,
  tablesHarness,
} from './tablesHarness';

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

/* ------------------------------------------------------------------------ */
/* US10 (T158): the field adapters and the focus rule                        */
/* ------------------------------------------------------------------------ */

/** An element of the page chrome: a `div` with `attrs` holding a focusable button. */
function chrome(attrs: Record<string, string>): HTMLButtonElement {
  const container = document.createElement('div');
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') container.className = value;
    else container.setAttribute(name, value);
  }
  const button = document.createElement('button');
  container.appendChild(button);
  document.body.appendChild(container);
  chromes.push(container);
  return button;
}

const chromes: HTMLElement[] = [];

afterEach(() => {
  for (const element of chromes.splice(0)) element.remove();
});

describe('the field table edit target (US10)', () => {
  it('has the members of the field adapter: kind, key, the field’s generator, images in cells only; run is one discrete dispatch, canRun a dry run, setSelection a plain dispatch; not editable while the field is read-only', async () => {
    await tablesHarness();
    const field = fieldHost('documentInfo.history');
    const { target, view } = field;
    expect(target.kind).toBe('description');
    expect(target.key).toBe('documentInfo.history');
    expect(target.state).toBe(view.state);
    expect(target.view).toBe(view);
    expect(target.dom).toBe(view.dom);
    expect(target.imagesOnlyInCells).toBe(true);
    expect(target.editable).toBe(true);
    // The field's generator: the ids `richFieldIdGenerator` gives, one after another.
    const first = target.nextNodeId();
    expect(first).toMatch(/^ui_documentInfo_history_\d+$/);
    const generator = richFieldIdGenerator('documentInfo.history');
    expect(Number(generator().split('_').pop())).toBe(Number(first.split('_').pop()) + 1);

    fieldCaret(field, 'documentInfo-history-t-0-0', 4);
    const seen: Transaction[] = [];
    const write: Command = (state, dispatch) => {
      if (dispatch) dispatch(state.tr.insertText('Z'));
      return true;
    };
    const refuse: Command = () => false;
    // A dry run changes nothing.
    const doc = view.state.doc;
    expect(target.canRun(write)).toBe(true);
    expect(target.canRun(refuse)).toBe(false);
    expect(view.state.doc).toBe(doc);
    // run: the command's answer, its transaction marked DISCRETE_STEP.
    const original = view.props.dispatchTransaction!;
    view.setProps({
      dispatchTransaction: (tr: Transaction) => {
        seen.push(tr);
        original.call(view, tr);
      },
    });
    expect(target.run(refuse)).toBe(false);
    expect(seen).toHaveLength(0);
    expect(target.run(write)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    expect(view.state.doc.nodeAt(fieldPos(field, 'documentInfo-history-t-0-0'))!.textContent).toBe(
      'r0c0Z',
    );
    // setSelection: dispatched as it is, without the discrete mark.
    const at = fieldPos(field, 'documentInfo-history-t-1-1') + 2;
    target.setSelection(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    expect(seen).toHaveLength(2);
    expect(seen[1]!.getMeta(DISCRETE_STEP)).toBeUndefined();
    expect(view.state.selection.head).toBe(at);
    // The field's lock (the run lock): not editable.
    field.lock.readOnly = true;
    expect(target.editable).toBe(false);
    field.lock.readOnly = false;
    expect(target.editable).toBe(true);
  });

  it('the focus rule in the Description view: a field taking the focus becomes active; the Table bar, the menu bar, a menu popup and a dialog keep it; another rich field replaces it; a plain field clears it; an unmount clears it', async () => {
    const { store } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const annotation = fieldHost('titleInfo.annotation');
    const history = fieldHost('documentInfo.history');
    expect(activeTableTarget(store)).toBeNull();
    annotation.view.dom.focus();
    expect(activeTableTarget(store)).toBe(annotation.target);
    const keeping: Record<string, string>[] = [
      { class: 'mfbe-toolbar mfbe-bar mfbe-tablebar' },
      { role: 'menubar' },
      { role: 'menu' },
      { role: 'dialog' },
    ];
    for (const attrs of keeping) {
      chrome(attrs).focus();
      expect(activeTableTarget(store), JSON.stringify(attrs)).toBe(annotation.target);
    }
    history.view.dom.focus();
    expect(activeTableTarget(store)).toBe(history.target);
    const plain = document.createElement('input');
    plain.setAttribute('data-testid', 'description-book-title');
    document.body.appendChild(plain);
    chromes.push(plain);
    plain.focus();
    expect(activeTableTarget(store)).toBeNull();
    // activateFieldTarget sets it explicitly (the field menu).
    activateFieldTarget('titleInfo.annotation');
    expect(activeTableTarget(store)).toBe(annotation.target);
    // An unmount clears the active field; the other one stays registered.
    annotation.unmount();
    expect(activeTableTarget(store)).toBeNull();
    expect(fieldTargetFor(history.view.dom)).toBe(history.target);
  });

  it('the Body view answers with the Body adapter and the Source view with none, whatever the last field was', async () => {
    const { store } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const field = fieldHost('srcTitleInfo.annotation');
    field.view.dom.focus();
    expect(activeTableTarget(store)).toBe(field.target);
    actions.setActiveView(store, 'body');
    expect(activeTableTarget(store)).toBe(bodyTableTarget(store));
    actions.setActiveView(store, 'source');
    expect(activeTableTarget(store)).toBeNull();
    actions.setActiveView(store, 'description');
    expect(activeTableTarget(store)).toBe(field.target);
  });

  it('subscribeTableTargets fires on each activation change and on the active field’s changes, not on another field’s', async () => {
    const { store } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const annotation = fieldHost('titleInfo.annotation');
    const history = fieldHost('documentInfo.history');
    const listener = vi.fn();
    const unsubscribe = subscribeTableTargets(store, listener);
    annotation.view.dom.focus();
    expect(listener).toHaveBeenCalledTimes(1);
    fieldCaret(annotation, 'titleInfo-annotation-t-0-1', 1);
    expect(listener).toHaveBeenCalledTimes(2);
    // Another field's change: nothing.
    fieldCaret(history, 'documentInfo-history-t-1-0', 1);
    expect(listener).toHaveBeenCalledTimes(2);
    history.view.dom.focus();
    expect(listener).toHaveBeenCalledTimes(3);
    fieldCaret(history, 'documentInfo-history-t-1-1', 1);
    expect(listener).toHaveBeenCalledTimes(4);
    fieldCaret(annotation, 'titleInfo-annotation-t-0-0', 1);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    annotation.view.dom.focus();
    fieldCaret(annotation, 'titleInfo-annotation-t-1-1', 1);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('the hotkey scope resolver gives the active field’s DOM (C6)', async () => {
    const { store, services } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const field = fieldHost('documentInfo.history');
    const cell = field.view.dom.querySelector('td');
    expect(cell).not.toBeNull();
    expect(services.commands.allowsHotkey('table.insertRowBelow', cell)).toBe(false);
    field.view.dom.focus();
    expect(services.commands.allowsHotkey('table.insertRowBelow', cell)).toBe(true);
    expect(services.commands.allowsHotkey('table.insertRowBelow', document.body)).toBe(false);
  });

  it('fieldTargetFor finds the registered field whose DOM holds the element, active or not', async () => {
    const { store } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const annotation = fieldHost('titleInfo.annotation');
    const history = fieldHost('documentInfo.history');
    const unregistered = fieldHost('srcTitleInfo.annotation', { register: false });
    annotation.view.dom.focus();
    expect(fieldTargetFor(annotation.view.dom.querySelector('td'))).toBe(annotation.target);
    expect(fieldTargetFor(history.view.dom.querySelector('td'))).toBe(history.target);
    expect(fieldTargetFor(history.view.dom)).toBe(history.target);
    expect(fieldTargetFor(unregistered.view.dom.querySelector('td'))).toBeNull();
    expect(fieldTargetFor(document.body)).toBeNull();
    expect(fieldTargetFor(null)).toBeNull();
  });

  it('Table ID (nav.selectTableId) is available with a field adapter active and the bar’s field registered', async () => {
    const { store, services, ctx } = await tablesHarness();
    const unregister = registerBarFocus('tableId', () => true);
    const unregisterId = registerBarFocus('id', () => true);
    try {
      actions.setActiveView(store, 'description');
      const field = fieldHost('titleInfo.annotation');
      expect(services.commands.isEnabled('nav.selectTableId', ctx)).toBe(false);
      field.view.dom.focus();
      expect(services.commands.isEnabled('nav.selectTableId', ctx)).toBe(true);
      // The other navigation commands keep their Body-only rule.
      expect(services.commands.isEnabled('nav.selectId', ctx)).toBe(false);
    } finally {
      unregister();
      unregisterId();
    }
  });
});

describe('the assistant’s panel and the active field (US11, T173)', () => {
  it('focus entering the assistant’s panel keeps the active field and its block; focus leaving for another element clears it', async () => {
    const { store } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const field = fieldHost('titleInfo.annotation');
    field.view.dom.focus();
    const { view } = field;
    view.dispatch(
      view.state.tr.setSelection(
        CellBlockSelection.create(
          view.state.doc,
          fieldPos(field, 'titleInfo-annotation-t-0-0'),
          fieldPos(field, 'titleInfo-annotation-t-0-1'),
        ),
      ),
    );
    expect(activeTableTarget(store)).toBe(field.target);
    // The panel as App renders it: `aside.mfbe-ai-panel` holding the instruction field.
    const panel = document.createElement('aside');
    panel.className = 'mfbe-ai-panel';
    panel.setAttribute('data-testid', 'ai-panel');
    const input = document.createElement('textarea');
    input.setAttribute('data-testid', 'ai-input');
    panel.appendChild(input);
    document.body.appendChild(panel);
    chromes.push(panel);
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(activeTableTarget(store)).toBe(field.target);
    expect(activeTableTarget(store)?.state?.selection).toBeInstanceOf(CellBlockSelection);
    // Any other element - here a plain input outside the chrome - clears it.
    const other = document.createElement('input');
    document.body.appendChild(other);
    chromes.push(other);
    other.focus();
    expect(activeTableTarget(store)).toBeNull();
  });
});
