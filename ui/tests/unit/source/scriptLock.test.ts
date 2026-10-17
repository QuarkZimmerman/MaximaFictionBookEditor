/**
 * The Source view's quiet lock while a script runs (feature 003 FR-011, T030): the editor
 * follows `store.scriptRunning` - read-only and not editable while a script runs, back to
 * normal afterwards - mounted or headless, across a text reload, with nothing but the
 * `readOnly` facet and the `editable` facet changed (no styling, the selection untouched).
 */

import { EditorView } from '@codemirror/view';

import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { lockExtension, SourceEditorController } from '@/views/source/sourceEditor';
import { sourceSession } from '@/views/source/sourceSession';

const XML = `<?xml version="1.0"?>
<FictionBook>
  <body>
    <section>
      <p>One</p>
    </section>
  </body>
</FictionBook>
`;

beforeAll(() => {
  // jsdom has no layout: CodeMirror's measuring on focus needs these to exist.
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
});

function setup() {
  const store = createAppStore();
  const undo = new UndoCoordinator();
  const controller = new SourceEditorController({ store, undo });
  return { store, undo, controller };
}

/** The editor's classes without the focus marker (focus moves with the load and the tests). */
const stableClasses = (view: EditorView): string[] =>
  [...view.dom.classList].filter((name) => name !== 'cm-focused').sort();

/** Loads `text` headless as the serialisation of the (absent) model. */
async function load(controller: SourceEditorController, store: ReturnType<typeof createAppStore>) {
  const session = sourceSession(store);
  session.docId = 'doc-1';
  session.text = XML;
  session.baseline = XML;
  await controller.load({ store, rpc: null } as never);
}

describe('Source view quiet lock (feature 003 FR-011)', () => {
  it('is read-only and not editable exactly while a script runs', () => {
    const { store, controller } = setup();
    expect(controller.locked).toBe(false);
    expect(controller.state.facet(EditorView.editable)).toBe(true);

    actions.setScriptRunning(store, true);
    expect(controller.locked).toBe(true);
    expect(controller.state.readOnly).toBe(true);
    expect(controller.state.facet(EditorView.editable)).toBe(false);

    actions.setScriptRunning(store, false);
    expect(controller.locked).toBe(false);
    expect(controller.state.readOnly).toBe(false);
    expect(controller.state.facet(EditorView.editable)).toBe(true);
  });

  it('keeps the lock across a text reload and applies it to a fresh state', async () => {
    const { store, controller } = setup();
    actions.setScriptRunning(store, true);
    await load(controller, store);
    expect(controller.text).toBe(XML);
    expect(controller.locked).toBe(true);
    expect(controller.state.facet(EditorView.editable)).toBe(false);
    // Closing the document resets the text; the fresh state is locked too.
    controller.reset();
    expect(controller.text).toBe('');
    expect(controller.locked).toBe(true);
    actions.setScriptRunning(store, false);
    expect(controller.locked).toBe(false);
  });

  it('applies to a mounted editor: the content stops being contenteditable, nothing else', async () => {
    const { store, controller } = setup();
    await load(controller, store);
    const host = document.createElement('div');
    document.body.appendChild(host);
    controller.mount(host);
    const view = controller.editorView!;
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true');
    const classesBefore = stableClasses(view);

    actions.setScriptRunning(store, true);
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');
    expect(view.state.readOnly).toBe(true);
    expect(stableClasses(view)).toEqual(classesBefore); // no styling change: nothing greyed
    // The user's text input is refused by the browser; the cursor still moves (selection).
    view.dispatch({ selection: { anchor: 3 } });
    expect(view.state.selection.main.head).toBe(3);

    actions.setScriptRunning(store, false);
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true');
    controller.destroy();
    host.remove();
  });

  it('lockExtension yields the two facets when locked and nothing otherwise', () => {
    expect(lockExtension(false)).toEqual([]);
    const locked = lockExtension(true) as unknown[];
    expect(Array.isArray(locked)).toBe(true);
    expect(locked).toHaveLength(2);
  });
});
