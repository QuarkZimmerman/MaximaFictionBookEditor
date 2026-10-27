/**
 * T076 - rich annotation / history field state: the editor document is the FB2 `annotation`
 * node (same content model and marks as the Body view), Enter splits paragraphs and turns an
 * empty paragraph into an empty line + new paragraph, inline marks apply, node ids are
 * assigned, and `richFieldModel()` returns the model (undefined when only empty paragraphs).
 *
 * Feature 006, US10 (T157; FR-044, FR-045, FR-048; C2, C34; I8; U14; data-model §4.6 "The Tab
 * row", §5.4, §6.3, §6.5): `createRichFieldState` installs the table plugin ahead of its keymaps
 * (a selection across two cells becomes a block, appending no step); Tab moves to the next cell
 * and appends a row from the last one as one discrete step, Shift+Tab moves back and gives the
 * key up in the table's first cell, so the focus leaves the field, both give it up outside
 * tables; Enter in a cell does nothing; Delete on a selected table deletes it. Rendered in the
 * Description form's context with a spy controller, the field records a discrete transaction
 * without `coalesce` and typing with it, holds the clipboard plugin with its own options - a
 * pasted table takes the field's node ids - and changes nothing while the form is read-only.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { Fragment, Slice } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createElement } from 'react';

import { AppProvider } from '@/app/AppContext';
import { createAppServices } from '@/app/services';
import type { ClipboardOptions } from '@/editor/clipboard/route';
import { toggleInlineMark } from '@/editor/commands/marks';
import { DISCRETE_STEP } from '@/editor/commands/util';
import { clipboardPluginKey, pasteData, payloadFromSlice } from '@/editor/plugins/clipboard';
import { findNodeById } from '@/editor/schema';
import { tableEditingKey } from '@/editor/table/plugin';
import { CellBlockSelection } from '@/editor/table/selection';
import { fieldTargetFor } from '@/features/tables/target';
import { initI18n } from '@/i18n';
import type { AnnotationNode, Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import type { DescriptionController } from '@/views/description/binding';
import {
  DescriptionFormContext,
  type DescriptionFormContextValue,
} from '@/views/description/formContext';
import { formFromDescription, requiredIssues } from '@/views/description/model';
import { EMPTY_GENRES, EMPTY_LANGUAGES } from '@/views/description/resources';
import { RichField } from '@/views/description/RichField';
import {
  createRichFieldState,
  richEnter,
  richFieldIdGenerator,
  richFieldModel,
  richShiftTab,
  richTab,
} from '@/views/description/richFieldState';

import { fakeDocument, fakeRpc } from '../features/testUtils';

const ANNOTATION: AnnotationNode = {
  type: 'annotation',
  attrs: { nodeId: 'a1' },
  content: [
    {
      type: 'p',
      attrs: { nodeId: 'a2' },
      content: [
        { type: 'text', text: 'First ' },
        { type: 'text', text: 'line', marks: [{ type: 'emphasis' }] },
      ],
    },
    { type: 'p', attrs: { nodeId: 'a3' }, content: [{ type: 'text', text: 'Second' }] },
  ],
};

function run(
  state: EditorState,
  command: (s: EditorState, d: (tr: Transaction) => void) => boolean,
): EditorState {
  let next = state;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  expect(ok).toBe(true);
  return next;
}

describe('rich field state (T076)', () => {
  it('round-trips the annotation model and assigns node ids to new nodes', () => {
    const state = createRichFieldState(ANNOTATION, richFieldIdGenerator('titleInfo.annotation'));
    expect(state.doc.type.name).toBe('annotation');
    expect(richFieldModel(state)).toEqual(ANNOTATION);
    const empty = createRichFieldState(undefined, () => 'ui_x_1');
    expect(empty.doc.childCount).toBe(1);
    expect(empty.doc.attrs.nodeId).toBe('ui_x_1');
    expect(richFieldModel(empty)).toBeUndefined();
  });

  it('Enter splits a paragraph and turns an empty one into an empty line', () => {
    let state = createRichFieldState(ANNOTATION, richFieldIdGenerator('test.annotation'));
    const endOfSecond = state.doc.content.size - 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, endOfSecond)));
    state = run(state, richEnter);
    expect(state.doc.childCount).toBe(3);
    expect(state.doc.child(2).type.name).toBe('p');
    expect(state.doc.child(2).attrs.nodeId).toMatch(/^ui_test_annotation_\d+$/);
    // Enter on the new empty paragraph: <empty-line/> + a fresh paragraph.
    state = run(state, richEnter);
    expect(state.doc.content.content.map((n) => n.type.name)).toEqual([
      'p',
      'p',
      'empty_line',
      'p',
    ]);
    const model = richFieldModel(state)!;
    expect(model.content.map((n) => n.type)).toEqual(['p', 'p', 'empty-line', 'p']);
    expect(model.content[2]!.attrs.nodeId).toBeTruthy();
    // Splitting in the middle keeps both halves.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    state = run(state, richEnter);
    expect(state.doc.child(0).textContent).toBe('Fir');
    expect(state.doc.child(1).textContent).toBe('st line');
  });

  it('applies the Body view inline marks', () => {
    let state = createRichFieldState(ANNOTATION, () => 'id');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
    state = run(state, toggleInlineMark('strong'));
    const first = richFieldModel(state)!.content[0] as {
      content: { text: string; marks?: { type: string }[] }[];
    };
    expect(first.content[0]).toEqual({ type: 'text', text: 'First', marks: [{ type: 'strong' }] });
    state = run(state, toggleInlineMark('strong'));
    expect(richFieldModel(state)).toEqual(ANNOTATION);
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006, US10 (T157): the rich field as a table host                  */
/* ------------------------------------------------------------------------ */

/** An annotation holding a paragraph, the 2 × 2 table `ft` (`a b / c d`) and a paragraph. */
function fieldTable(): AnnotationNode {
  const cell = (row: number, column: number, text: string) => ({
    type: 'td',
    attrs: { nodeId: `ft-${row}-${column}` },
    content: [{ type: 'text', text }],
  });
  return {
    type: 'annotation',
    attrs: { nodeId: 'f1' },
    content: [
      { type: 'p', attrs: { nodeId: 'f2' }, content: [{ type: 'text', text: 'Before' }] },
      {
        type: 'table',
        attrs: { nodeId: 'ft' },
        content: [
          { type: 'tr', attrs: { nodeId: 'ft-r0' }, content: [cell(0, 0, 'a'), cell(0, 1, 'b')] },
          { type: 'tr', attrs: { nodeId: 'ft-r1' }, content: [cell(1, 0, 'c'), cell(1, 1, 'd')] },
        ],
      },
      { type: 'p', attrs: { nodeId: 'f3' }, content: [{ type: 'text', text: 'After' }] },
    ],
  } as unknown as AnnotationNode;
}

function at(state: EditorState, nodeId: string): number {
  const found = findNodeById(state.doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

/** The state with the caret at `offset` in the text block or cell `nodeId`. */
function caret(state: EditorState, nodeId: string, offset = 0): EditorState {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, at(state, nodeId) + 1 + offset)),
  );
}

/** Runs `command`; the transactions it dispatched, the state after them. */
function dispatched(state: EditorState, command: Command) {
  const transactions: Transaction[] = [];
  let next = state;
  const handled = command(state, (tr) => {
    transactions.push(tr);
    next = next.apply(tr);
  });
  return { handled, transactions, state: next };
}

function cellTexts(state: EditorState): string[][] {
  const table = state.doc.nodeAt(at(state, 'ft'))!;
  const rows: string[][] = [];
  table.forEach((row) => {
    const texts: string[] = [];
    row.forEach((cell) => texts.push(cell.textContent));
    rows.push(texts);
  });
  return rows;
}

const views: EditorView[] = [];

/** The state in a mounted view; the transactions it dispatched are recorded. */
function mounted(state: EditorState) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const transactions: Transaction[] = [];
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction: (tr) => {
      transactions.push(tr);
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  const press = (key: string, shiftKey = false) =>
    view.someProp('handleKeyDown', (handle) =>
      handle(view, new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })),
    ) ?? false;
  return { view, transactions, press };
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe('rich field state as a table host (feature 006, US10, T157)', () => {
  it('installs the table plugin ahead of its keymaps: a text selection across two cells becomes a block, the appended transaction holding no step', () => {
    const state = createRichFieldState(fieldTable(), richFieldIdGenerator('titleInfo.annotation'));
    expect(state.plugins[0]).toBe(tableEditingKey.get(state));
    const { state: next, transactions } = state.applyTransaction(
      state.tr.setSelection(
        TextSelection.create(state.doc, at(state, 'ft-0-0') + 1, at(state, 'ft-1-1') + 2),
      ),
    );
    expect(next.selection).toBeInstanceOf(CellBlockSelection);
    expect((next.selection as CellBlockSelection).cellPositions()).toHaveLength(4);
    expect(transactions.length).toBeGreaterThan(1);
    for (const appended of transactions.slice(1)) expect(appended.steps).toHaveLength(0);
  });

  it('Tab in a cell selects the next cell’s content; in the table’s last cell it appends a row through planTabRow, one discrete step with the field’s node ids', () => {
    const nextId = richFieldIdGenerator('documentInfo.history');
    let state = caret(createRichFieldState(fieldTable(), nextId), 'ft-0-0');
    const moved = dispatched(state, richTab(nextId));
    expect(moved.handled).toBe(true);
    const selection = moved.state.selection;
    expect(selection.from).toBe(at(moved.state, 'ft-0-1') + 1);
    expect(selection.to).toBe(at(moved.state, 'ft-0-1') + 2);
    expect(moved.transactions.every((tr) => !tr.docChanged)).toBe(true);
    state = caret(state, 'ft-1-1', 1);
    const appended = dispatched(state, richTab(nextId));
    expect(appended.handled).toBe(true);
    expect(appended.transactions).toHaveLength(1);
    expect(appended.transactions[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    expect(cellTexts(appended.state)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['', ''],
    ]);
    const table = appended.state.doc.nodeAt(at(appended.state, 'ft'))!;
    const added = table.child(2);
    expect(added.attrs.nodeId).toMatch(/^ui_documentInfo_history_\d+$/);
    added.forEach((cell) => expect(cell.attrs.nodeId).toMatch(/^ui_documentInfo_history_\d+$/));
    // Through the keymap of a mounted view, too.
    const { view, transactions, press } = mounted(
      caret(createRichFieldState(fieldTable(), nextId), 'ft-1-0'),
    );
    expect(press('Tab')).toBe(true);
    expect(view.state.selection.from).toBe(at(view.state, 'ft-1-1') + 1);
    expect(transactions.every((tr) => !tr.docChanged)).toBe(true);
  });

  it('Tab and Shift+Tab outside tables return false, so the focus moves on', () => {
    const nextId = richFieldIdGenerator('titleInfo.annotation');
    const state = caret(createRichFieldState(fieldTable(), nextId), 'f2', 3);
    expect(dispatched(state, richTab(nextId)).handled).toBe(false);
    expect(dispatched(state, richShiftTab).handled).toBe(false);
    const { press, transactions } = mounted(state);
    expect(press('Tab')).toBe(false);
    expect(press('Tab', true)).toBe(false);
    expect(transactions).toEqual([]);
  });

  it('Shift+Tab in the table’s first cell returns false - for a caret and for a block whose head is that cell (C34, U14) -, and in any other cell moves back', () => {
    const nextId = richFieldIdGenerator('srcTitleInfo.annotation');
    const base = createRichFieldState(fieldTable(), nextId);
    expect(dispatched(caret(base, 'ft-0-0', 1), richShiftTab).handled).toBe(false);
    const block = base.apply(
      base.tr.setSelection(
        CellBlockSelection.create(base.doc, at(base, 'ft-1-1'), at(base, 'ft-0-0')),
      ),
    );
    expect(block.selection).toBeInstanceOf(CellBlockSelection);
    expect(dispatched(block, richShiftTab).handled).toBe(false);
    const back = dispatched(caret(base, 'ft-1-0'), richShiftTab);
    expect(back.handled).toBe(true);
    expect(back.state.selection.from).toBe(at(back.state, 'ft-0-1') + 1);
    expect(back.state.selection.to).toBe(at(back.state, 'ft-0-1') + 2);
    const { press } = mounted(caret(base, 'ft-0-0'));
    expect(press('Tab', true)).toBe(false);
  });

  it('Enter in a cell does nothing', () => {
    const state = caret(
      createRichFieldState(fieldTable(), richFieldIdGenerator('test.cells')),
      'ft-0-1',
      1,
    );
    const entered = dispatched(state, richEnter);
    expect(entered.handled).toBe(true);
    expect(entered.transactions).toEqual([]);
    const { view, press } = mounted(state);
    expect(press('Enter')).toBe(true);
    expect(view.state.doc).toBe(state.doc);
  });

  it('Delete on a selected table runs the Delete table transform, one discrete step', () => {
    const state = createRichFieldState(fieldTable(), richFieldIdGenerator('test.delete'));
    const selected = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, at(state, 'ft'))),
    );
    const { view, transactions, press } = mounted(selected);
    expect(press('Delete')).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    const types: string[] = [];
    view.state.doc.forEach((child) => types.push(child.type.name));
    expect(types).toEqual(['p', 'p']);
  });
});

/* ------------------------------------------------------------------------ */
/* The rendered field (T157): the controller, the clipboard, the run lock    */
/* ------------------------------------------------------------------------ */

describe('the rendered rich field (feature 006, US10, T157)', () => {
  async function renderField(readOnly = false) {
    await initI18n({ language: 'en' });
    const store = createAppStore();
    const document = fakeDocument();
    const withTable: Document = {
      ...document,
      description: {
        ...document.description,
        titleInfo: { ...document.description.titleInfo, annotation: fieldTable() },
      },
    };
    const services = createAppServices({ store, rpc: fakeRpc().client, platform: 'linux' });
    actions.setDocument(store, withTable);
    const form = formFromDescription(withTable.description);
    const controller = {
      currentForm: form,
      setValue: vi.fn(),
      closeEntry: vi.fn(),
    } as unknown as DescriptionController;
    const value = (lock: boolean): DescriptionFormContextValue => ({
      controller,
      form,
      issues: requiredIssues(form),
      language: 'en',
      genres: EMPTY_GENRES,
      languages: EMPTY_LANGUAGES,
      reloadGenres: () => {},
      docId: withTable.docId,
      binaries: [],
      readOnly: lock,
    });
    const tree = (lock: boolean) =>
      createElement(AppProvider, {
        services,
        children: createElement(DescriptionFormContext.Provider, {
          value: value(lock),
          children: createElement(RichField, {
            fieldKey: 'titleInfo.annotation',
            testId: 'description-annotation',
            label: 'Annotation',
          }),
        }),
      });
    const rendered = render(tree(readOnly));
    const dom = screen.getByTestId('description-annotation');
    const target = fieldTargetFor(dom)!;
    expect(target).not.toBeNull();
    return {
      store,
      controller,
      target,
      view: target.view!,
      setValue: controller.setValue as unknown as ReturnType<typeof vi.fn>,
      lock: (lock: boolean) => rendered.rerender(tree(lock)),
      unmount: rendered.unmount,
    };
  }

  beforeAll(() => {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    });
  });

  afterEach(() => cleanup());

  it('a DISCRETE_STEP transaction records setValue without coalesce; typing records it with coalesce', async () => {
    const { view, setValue } = await renderField();
    act(() => {
      view.dispatch(
        view.state.tr.insertText('x', at(view.state, 'ft-0-0') + 1).setMeta(DISCRETE_STEP, true),
      );
    });
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue.mock.calls[0]![0]).toBe('titleInfo.annotation');
    expect(setValue.mock.calls[0]).toHaveLength(2);
    expect(JSON.stringify(setValue.mock.calls[0]![1])).toContain('"xa"');
    act(() => {
      view.dispatch(view.state.tr.insertText('y', at(view.state, 'f2') + 1));
    });
    expect(setValue).toHaveBeenCalledTimes(2);
    expect(setValue.mock.calls[1]![2]).toEqual({ coalesce: true });
  });

  it('holds the clipboard plugin with the field’s options; a pasted table takes the field’s node ids', async () => {
    const { view, setValue } = await renderField();
    const plugin = clipboardPluginKey.get(view.state);
    expect(plugin).toBeDefined();
    const options = (plugin!.spec as { clipboardOptions?: ClipboardOptions }).clipboardOptions!;
    expect(typeof options.bookIds).toBe('function');
    expect(typeof options.nextNodeId).toBe('function');
    expect(typeof options.message).toBe('function');
    expect(options.nextNodeId()).toMatch(/^ui_titleInfo_annotation_\d+$/);
    act(() => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at(view.state, 'f3') + 6)),
      );
    });
    const table = view.state.doc.nodeAt(at(view.state, 'ft'))!;
    const slice = new Slice(Fragment.from(table), 0, 0);
    act(() => {
      pasteData(view, { json: JSON.stringify(payloadFromSlice(slice)) });
    });
    const tables: string[] = [];
    view.state.doc.forEach((child) => {
      if (child.type.name === 'table') tables.push(String(child.attrs.nodeId));
    });
    expect(tables).toHaveLength(2);
    expect(tables[0]).toBe('ft');
    expect(tables[1]).toMatch(/^ui_titleInfo_annotation_\d+$/);
    view.state.doc.child(view.state.doc.childCount - 1).descendants((node) => {
      if (!node.isText) expect(String(node.attrs.nodeId)).toMatch(/^ui_titleInfo_annotation_\d+$/);
      return true;
    });
    // A table paste is one discrete step: setValue without coalesce.
    expect(setValue.mock.calls.at(-1)).toHaveLength(2);
  });

  it('changes no document while the form is read-only (the run lock)', async () => {
    const { view, setValue, lock } = await renderField();
    act(() => lock(true));
    const doc = view.state.doc;
    act(() => {
      view.dispatch(
        view.state.tr.insertText('z', at(view.state, 'f2') + 1).setMeta(DISCRETE_STEP, true),
      );
    });
    expect(view.state.doc).toBe(doc);
    expect(setValue).not.toHaveBeenCalled();
    expect(view.editable).toBe(false);
  });
});
