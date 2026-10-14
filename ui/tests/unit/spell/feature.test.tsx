/**
 * T088 - live highlighting in the application shell with a fake core: the plugin is installed
 * into the Body editor (fallback installation), seeded misspellings get `.mfbe-misspelled`
 * decorations, the context menu offers suggestions / "Ignore all" / "Add to dictionary", a
 * suggestion replaces the word as one undo step, and the highlight toggle command persists
 * `view.spellHighlight`.
 */

import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

import { App } from '@/app/App';
import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import type { ModelNodeJson } from '@/editor/fromModel';
import { spellPluginKey } from '@/editor/plugins/spellcheck';
import { changeLanguage, initI18n } from '@/i18n';
import type { BodyNode, Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import type { Settings } from '@/rpc/types';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';

configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  document.elementFromPoint = () => null;
});

const KNOWN = new Set(['Привет', 'мир', 'привет']);

function spellDocument(): Document {
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body1' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 's1' },
        content: [
          {
            type: 'p',
            attrs: { nodeId: 'p1' },
            content: [{ type: 'text', text: 'Привет превет мир' }],
          },
        ],
      },
    ],
  };
  const doc = fakeDocument({ bodies: [body as unknown as BodyNode] });
  doc.description.titleInfo.lang = 'ru';
  return doc;
}

function settings(view: Partial<Settings['view']> = {}): Settings {
  return {
    schemaVersion: 1,
    view: {
      uiLanguage: 'en',
      theme: 'system',
      bodyFont: '',
      bodyFontSize: 14,
      bodyTextColor: '#000',
      bodyBackground: '#fff',
      sourceFont: '',
      sourceWrap: true,
      sourceSyntaxHighlight: true,
      sourceShowEol: false,
      sourceShowWhitespace: false,
      sourceLineNumbers: true,
      sourceMatchTags: true,
      spellEnabled: true,
      spellHighlight: true,
      customDictionaryPath: '',
      fastMode: false,
      ...view,
    },
    other: {
      defaultEncoding: 'utf-8',
      keepEncoding: false,
      restorePosition: true,
      scriptsFolder: '',
      genresFolder: '',
      templateFolder: '',
      askOnNonClearImage: true,
      insertClearImages: false,
      pasteImageFormat: 'jpeg',
      jpegQuality: 90,
      nbspDisplayChar: '\u00B0',
    },
    words: { showExclusionsInWordsDialog: false },
    session: {
      windowGeometry: null,
      toolbars: { commands: true, scripts: true, links: true, table: true, status: true },
      treeVisible: true,
      findHistory: [],
      replaceHistory: [],
      toolbarLayouts: {},
      lastFileDialogFolder: '',
    },
  };
}

async function renderApp() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const custom: string[] = [];
  let current = settings();
  const rpc = fakeRpc({
    'settings.get': () => current,
    'settings.set': (params: unknown) => {
      const patch = (params as { patch: { view?: Partial<Settings['view']> } }).patch;
      current = settings({ ...current.view, ...patch.view });
      return { settings: current, restartRequired: false };
    },
    'doc.recent': [],
    'doc.watch': {},
    'doc.caret': {},
    'doc.close': {},
    'spell.dictionaries': [{ tag: 'ru_RU', lang: 'ru', name: 'ru_RU', source: 'bundled' }],
    'spell.check': (params: unknown) => {
      const { words, langs } = params as { words: string[]; langs: string[] };
      return {
        misspelled: words.filter((word) => !KNOWN.has(word) && !custom.includes(word)),
        langs,
      };
    },
    'spell.suggest': () => ({ suggestions: ['привет', 'приветик'] }),
    'spell.addWord': (params: unknown) => {
      custom.push((params as { word: string }).word);
      return { added: true, words: [...custom] };
    },
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(<App services={services} startupSearch="" />);
  act(() => {
    actions.setConnection(store, 'connected');
    actions.setSettings(store, current);
    actions.setDocument(store, spellDocument());
  });
  await screen.findByTestId('body-editor');
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
  return { store, services, rpc, user, ctx, custom };
}

describe('live spell checking', { timeout: 30_000 }, () => {
  it('installs the plugin into the Body editor and underlines the misspelled word', async () => {
    const { store, rpc } = await renderApp();
    const controller = getBodyController(store);
    await waitFor(() => expect(spellPluginKey.getState(controller.editorState!)).toBeDefined());
    const editor = screen.getByTestId('body-editor');
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(1));
    expect(editor.querySelector('.mfbe-misspelled')).toHaveTextContent('превет');
    const check = rpc.calls.find((call) => call.method === 'spell.check');
    expect((check!.params as { langs: string[] }).langs).toEqual(['ru_RU']);
  });

  it('offers suggestions, Ignore all and Add to dictionary in the context menu', async () => {
    const { store, services, user, rpc, custom } = await renderApp();
    const editor = screen.getByTestId('body-editor');
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(1));
    const controller = getBodyController(store);
    act(() => {
      controller.setCaret({ view: 'body', nodeId: 'p1', offset: 9 }); // inside "превет"
    });
    fireEvent.contextMenu(screen.getByTestId('body-view'), { clientX: 5, clientY: 5 });
    const menu = await screen.findByTestId('context-menu');
    // Suggestions arrive asynchronously; the menu re-renders with them.
    await waitFor(() => expect(within(menu).getByTestId('context-menu-spelling-0')).toBeVisible());
    expect(within(menu).getByTestId('context-menu-spelling-0')).toHaveTextContent('привет');
    expect(within(menu).getByTestId('context-menu-spelling-1')).toHaveTextContent('приветик');
    expect(within(menu).getByTestId('context-menu-spelling-ignore-all')).toHaveTextContent(
      'Ignore all',
    );
    expect(within(menu).getByTestId('context-menu-spelling-add')).toHaveTextContent(
      'Add to dictionary',
    );
    const depth = services.undo.undoDepth;
    await user.click(within(menu).getByTestId('context-menu-spelling-0'));
    await waitFor(() => expect(editor).toHaveTextContent('Привет привет мир'));
    expect(services.undo.undoDepth).toBe(depth + 1);
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(0));
    act(() => {
      services.undo.undo();
    });
    await waitFor(() => expect(editor).toHaveTextContent('Привет превет мир'));
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(1));

    // Add to dictionary: the word is accepted and the mark disappears.
    act(() => {
      controller.setCaret({ view: 'body', nodeId: 'p1', offset: 9 });
    });
    fireEvent.contextMenu(screen.getByTestId('body-view'), { clientX: 5, clientY: 5 });
    const again = await screen.findByTestId('context-menu');
    await user.click(within(again).getByTestId('context-menu-spelling-add'));
    await waitFor(() => expect(custom).toEqual(['превет']));
    expect(rpc.calls.some((call) => call.method === 'spell.addWord')).toBe(true);
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(0));
  });

  it('tools.spellHighlight toggles view.spellHighlight through settings.set', async () => {
    const { services, ctx, rpc, store } = await renderApp();
    const editor = screen.getByTestId('body-editor');
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(1));
    expect(services.commands.isChecked('tools.spellHighlight', ctx)).toBe(true);
    await act(async () => {
      await services.commands.execute('tools.spellHighlight', ctx);
    });
    expect(rpc.calls.find((call) => call.method === 'settings.set')?.params).toEqual({
      patch: { view: { spellHighlight: false } },
    });
    expect(store.getState().settings?.view.spellHighlight).toBe(false);
    expect(services.commands.isChecked('tools.spellHighlight', ctx)).toBe(false);
    await waitFor(() => expect(editor.querySelectorAll('.mfbe-misspelled')).toHaveLength(0));
  });
});
