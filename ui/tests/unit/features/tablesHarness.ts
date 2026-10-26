/**
 * A mounted Body editor over a book with tables, for the tables feature's tests (feature 006):
 * the app services (every feature registered, the tables feature included), the Body
 * controller mounted in jsdom, and helpers to place the selection and run commands. US10 adds
 * `fieldHost`: a description field's editor - the rich field's state with its table plugin and
 * clipboard plugin in a jsdom `EditorView` - whose field target (`createFieldTarget`) is
 * registered, as `RichField` registers its own.
 */

import i18next from 'i18next';
import { TextSelection, type Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import { clipboardPlugin } from '@/editor/plugins/clipboard';
import { findNodeById } from '@/editor/schema';
import { createFieldTarget, registerFieldTarget, type FieldTarget } from '@/features/tables/target';
import { initI18n } from '@/i18n';
import type { AnnotationNode, Document, TableNode } from '@/model/document';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { getBodyController, type BodyEditorController } from '@/views/body/bodyEditor';
import type { FieldKey } from '@/views/description/model';
import { createRichFieldState, richFieldIdGenerator } from '@/views/description/richFieldState';

import { fakeDocument, fakeRpc, type FakeRpc } from './testUtils';

/** A model table of `rows` × `columns` cells: node ids `<id>-<row>-<column>`, texts `r<row>c<column>`. */
export function modelTable(nodeId: string, rows: number, columns: number): TableNode {
  return {
    type: 'table',
    attrs: { nodeId },
    content: Array.from({ length: rows }, (_, r) => ({
      type: 'tr',
      attrs: { nodeId: `${nodeId}-r${r}` },
      content: Array.from({ length: columns }, (_, c) => ({
        type: 'td',
        attrs: { nodeId: `${nodeId}-${r}-${c}` },
        content: [{ type: 'text', text: `r${r}c${c}` }],
      })),
    })),
  } as TableNode;
}

/** A book whose first section holds a paragraph `p1`, the 3 × 3 table `t1` and a paragraph `p2`. */
export function tableDocument(overrides: Partial<Document> = {}): Document {
  return fakeDocument({
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 's1' },
            content: [
              { type: 'p', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: 'Before' }] },
              modelTable('t1', 3, 3),
              { type: 'p', attrs: { nodeId: 'p2' }, content: [{ type: 'text', text: 'After' }] },
            ],
          },
        ],
      },
    ],
    ...overrides,
  });
}

export interface TablesHarness {
  store: AppStore;
  services: AppServices;
  rpc: FakeRpc;
  controller: BodyEditorController;
  view: EditorView;
  host: HTMLElement;
  ctx: CommandContext;
}

const hosts: HTMLElement[] = [];
const cleanups: (() => void)[] = [];

/** Removes the hosts of the harnesses and field hosts made so far (call from `afterEach`). */
export function removeHarnessHosts(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const host of hosts.splice(0)) host.remove();
}

/**
 * jsdom measures no range. A command run through the controller gives the Body editor the focus
 * before its transaction is applied, and ProseMirror then measures the selection to scroll it
 * into view (as `images.test.ts` and the description tests stub these too).
 */
function measureNoRanges(): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
}

export async function tablesHarness(doc: Document = tableDocument()): Promise<TablesHarness> {
  measureNoRanges();
  await initI18n({ language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.set': (params: unknown) => ({ settings: null, restartRequired: false, params }),
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, doc);
  const controller = getBodyController(store);
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  controller.mount(host);
  const ctx: CommandContext = {
    store,
    rpc: rpc.client,
    undo: services.undo,
    dialogs: services.dialogs,
    hotkeys: services.hotkeys,
    carets: services.carets,
    t: i18next.t,
    version: 'test',
  };
  return { store, services, rpc, controller, view: controller.editorView!, host, ctx };
}

/** The position just before the node with `nodeId` in the mounted editor. */
export function posOf(harness: Pick<TablesHarness, 'controller'>, nodeId: string): number {
  const found = findNodeById(harness.controller.editorState!.doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

/** A selection change only, through the controller (no undo step, no scroll). */
export function select(harness: Pick<TablesHarness, 'controller'>, selection: Selection): void {
  const state = harness.controller.editorState!;
  harness.controller.apply(state.tr.setSelection(selection));
}

/** The caret at `offset` in the cell or paragraph `nodeId`. */
export function caretIn(harness: Pick<TablesHarness, 'controller'>, nodeId: string, offset = 0) {
  const state = harness.controller.editorState!;
  select(harness, TextSelection.create(state.doc, posOf(harness, nodeId) + 1 + offset));
}

/* ------------------------------------------------------------------------ */
/* US10: a description field's editor                                       */
/* ------------------------------------------------------------------------ */

/**
 * The annotation of a field host: the paragraph `<prefix>-p` ("Text") and the 2 × 2 table
 * `<prefix>-t`, its cells `<prefix>-t-<row>-<column>` holding `r<row>c<column>`.
 */
export function fieldAnnotation(prefix: string): AnnotationNode {
  const table = modelTable(`${prefix}-t`, 2, 2);
  return {
    type: 'annotation',
    attrs: { nodeId: `${prefix}-a` },
    content: [
      { type: 'p', attrs: { nodeId: `${prefix}-p` }, content: [{ type: 'text', text: 'Text' }] },
      table,
    ],
  } as unknown as AnnotationNode;
}

export interface FieldHost {
  key: FieldKey;
  view: EditorView;
  target: FieldTarget;
  /** The field's read-only lock (the run lock), as `RichField` holds it. */
  lock: { readOnly: boolean };
  /** Messages the field's paste router showed. */
  messages: string[];
  /** Unregisters the target (as an unmount does) and destroys the view. */
  unmount(): void;
}

/**
 * A description field's editor in jsdom: `createRichFieldState` with the clipboard plugin of the
 * field's options, the table node views, a `dispatchTransaction` that refuses document changes
 * under the lock and notifies the target, and the target `createFieldTarget` makes - registered
 * unless `register` is false. Removed by `removeHarnessHosts`.
 */
export function fieldHost(
  key: FieldKey,
  options: { value?: AnnotationNode; register?: boolean; bookIds?: () => ReadonlySet<string> } = {},
): FieldHost {
  // Inside the Description view, as the Edit menu's commands look for its fields there.
  const host = document.createElement('div');
  host.setAttribute('data-testid', 'description-view');
  document.body.appendChild(host);
  hosts.push(host);
  const nextId = richFieldIdGenerator(key);
  const lock = { readOnly: false };
  const messages: string[] = [];
  let target: FieldTarget | null = null;
  const view: EditorView = new EditorView(host, {
    state: createRichFieldState(
      options.value ?? fieldAnnotation(key.replace(/\W+/g, '-')),
      nextId,
      [
        clipboardPlugin({
          bookIds: options.bookIds ?? (() => new Set()),
          nextNodeId: nextId,
          message: (message) => messages.push(message),
        }),
      ],
    ),
    editable: () => !lock.readOnly,
    nodeViews: createTableNodeViews(),
    attributes: { 'data-testid': `field-${key}` },
    dispatchTransaction: (tr) => {
      if (tr.docChanged && lock.readOnly) return;
      view.updateState(view.state.apply(tr));
      target?.notify();
    },
  });
  target = createFieldTarget({
    key,
    view: () => view,
    editable: () => !lock.readOnly,
    nextNodeId: nextId,
  });
  const unregister = options.register === false ? () => {} : registerFieldTarget(target);
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    unregister();
    view.destroy();
  };
  cleanups.push(unmount);
  return { key, view, target, lock, messages, unmount };
}

/** The position just before the node with `nodeId` in a field host's document. */
export function fieldPos(field: Pick<FieldHost, 'view'>, nodeId: string): number {
  const found = findNodeById(field.view.state.doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

/** The field's caret at `offset` in the cell or paragraph `nodeId`: a selection change only. */
export function fieldCaret(field: Pick<FieldHost, 'view'>, nodeId: string, offset = 0): void {
  const { view } = field;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, fieldPos(field, nodeId) + 1 + offset),
    ),
  );
}

/**
 * jsdom has no `isContentEditable`: the rich fields' editors are text fields of the page only
 * with it (`textFieldOf`, `isWritable`). Installs a getter that follows the `contenteditable`
 * attribute of the element and its ancestors.
 */
export function polyfillContentEditable(): void {
  if ('isContentEditable' in HTMLElement.prototype) return;
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      const owner = this.closest('[contenteditable]');
      const value = owner?.getAttribute('contenteditable');
      return !!owner && (value === '' || value === 'true');
    },
  });
}
