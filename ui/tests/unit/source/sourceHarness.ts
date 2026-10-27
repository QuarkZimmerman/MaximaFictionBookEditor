/**
 * The Source view with the app services, for the tests of *Add → Table* in the Source view
 * (feature 006, T055): every feature registered (the tables feature included), a document
 * whose Source text the fake core serialises as `text`, the Source view active, the Source
 * controller mounted in jsdom (unless `mounted: false`) and loaded, its syntax tree complete.
 */

import { ensureSyntaxTree } from '@codemirror/language';
import i18next from 'i18next';

import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { getSourceEditor, type SourceEditorController } from '@/views/source/sourceEditor';

import { fakeDocument, fakeRpc, type FakeRpc, type Responder } from '../features/testUtils';

export const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';

/** A book in the writer's layout: a section with a title, paragraphs and a cite. */
export const SOURCE_BOOK = [
  '<?xml version="1.0" encoding="utf-8"?>',
  `<FictionBook xmlns="${FB2_NS}">`,
  '\t<body>',
  '\t\t<section>',
  '\t\t\t<title>',
  '\t\t\t\t<p>Title</p>',
  '\t\t\t</title>',
  '\t\t\t<epigraph>',
  '\t\t\t\t<p>Epigraph</p>',
  '\t\t\t</epigraph>',
  '\t\t\t<p>First</p>',
  '\t\t\t<p>Second</p>',
  '\t\t\t<cite>',
  '\t\t\t\t<p>Cited</p>',
  '\t\t\t\t<text-author>Author</text-author>',
  '\t\t\t</cite>',
  '\t\t</section>',
  '\t</body>',
  '</FictionBook>',
  '',
].join('\n');

export function offsetIn(text: string, needle: string, nth = 0): number {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) {
    at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`"${needle}" not in the text`);
  }
  return at;
}

export const afterIn = (text: string, needle: string, nth = 0) =>
  offsetIn(text, needle, nth) + needle.length;

/** Points of `SOURCE_BOOK`: allowed, in text, in a tag, refused between elements. */
export const POINTS = {
  between: afterIn(SOURCE_BOOK, '<p>First</p>'),
  between2: afterIn(SOURCE_BOOK, '<p>Second</p>'),
  inText: offsetIn(SOURCE_BOOK, 'Second') + 2,
  inTag: offsetIn(SOURCE_BOOK, '<section>') + 3,
  titleEpigraph: afterIn(SOURCE_BOOK, '</title>'),
  afterAuthor: afterIn(SOURCE_BOOK, '</text-author>'),
  outside: 0,
};

export interface SourceHarness {
  store: AppStore;
  services: AppServices;
  rpc: FakeRpc;
  controller: SourceEditorController;
  host: HTMLElement | null;
  ctx: CommandContext;
}

const hosts: HTMLElement[] = [];

/** Removes the hosts of the harnesses made so far (call from `afterEach`). */
export function removeSourceHosts(): void {
  for (const host of hosts.splice(0)) host.remove();
}

/** jsdom has no layout: CodeMirror's measuring needs these (call from `beforeAll`). */
export function stubRangeRects(): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
}

export async function sourceHarness(
  options: { text?: string; mounted?: boolean; responses?: Record<string, Responder> } = {},
): Promise<SourceHarness> {
  const text = options.text ?? SOURCE_BOOK;
  await initI18n({ language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'doc.toXml': { text },
    'settings.set': (params: unknown) => ({ settings: null, restartRequired: false, params }),
    ...options.responses,
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  store.setState({ activeView: 'source' });
  const controller = getSourceEditor(store);
  if (!controller) throw new Error('the Source feature made no controller');
  let host: HTMLElement | null = null;
  if (options.mounted !== false) {
    host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    controller.mount(host);
  }
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
  await controller.load(ctx);
  ensureSyntaxTree(controller.state, controller.state.doc.length, 10_000);
  return { store, services, rpc, controller, host, ctx };
}

/** A selection change only (no scroll, no focus). */
export function selectSource(controller: SourceEditorController, anchor: number, head = anchor) {
  controller.target.dispatch({ selection: { anchor, head } });
}
