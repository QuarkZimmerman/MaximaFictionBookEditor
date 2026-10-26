/**
 * A mounted Body editor over a book with tables, for the tables feature's tests (feature 006):
 * the app services (every feature registered, the tables feature included), the Body
 * controller mounted in jsdom, and helpers to place the selection and run commands.
 */

import i18next from 'i18next';
import { TextSelection, type Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import { findNodeById } from '@/editor/schema';
import { initI18n } from '@/i18n';
import type { Document, TableNode } from '@/model/document';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { getBodyController, type BodyEditorController } from '@/views/body/bodyEditor';

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

/** Removes the hosts of the harnesses made so far (call from `afterEach`). */
export function removeHarnessHosts(): void {
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
