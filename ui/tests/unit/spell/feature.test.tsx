/**
 * T088 - live highlighting in the application shell with a fake core: the plugin is installed
 * into the Body editor (fallback installation), seeded misspellings get `.mfbe-misspelled`
 * decorations, the context menu offers suggestions / "Ignore all" / "Add to dictionary", a
 * suggestion replaces the word as one undo step, and the highlight toggle command persists
 * `view.spellHighlight`.
 *
 * Feature 004, User Story 9 (T072; spec FR-080): the scope of the editor's checker - the
 * Spelling command and the highlighting toggle are enabled under exactly the release 0.0.3
 * conditions in every view (the active view plays no part: the Body-only command of the first
 * draft was removed at the re-alignment of 2026-10-20), and the dialog's walk over the document
 * never yields a description field.
 */

import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

import { App } from '@/app/App';
import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import type { ModelNodeJson } from '@/editor/fromModel';
import { spellPluginKey } from '@/editor/plugins/spellcheck';
import { collectSpellBlocks } from '@/features/spell/dialogController';
import { changeLanguage, initI18n } from '@/i18n';
import type { AnnotationNode, BodyNode, Document } from '@/model/document';
import { actions, createAppStore, type ViewId } from '@/model/store';
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
      sourceTagCompletion: true,
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
      dictionariesFolder: '',
      templateFolder: '',
      askOnNonClearImage: true,
      insertClearImages: false,
      pasteImageFormat: 'jpeg',
      jpegQuality: 90,
      nbspDisplayChar: '\u00B0',
      versionCheck: 'monthly',
      switchKeyboardLayout: false,
      keyboardLayoutId: '',
      keyboardLayoutName: '',
    },
    words: { showExclusionsInWordsDialog: false },
    session: {
      windowGeometry: null,
      toolbars: { commands: true, scripts: true, links: true, table: true, status: true },
      treeVisible: true,
      treeWidth: 260,
      findHistory: [],
      replaceHistory: [],
      toolbarLayouts: {},
      lastFileDialogFolder: '',
      aiPanelWidth: 360,
      aiPanelVisible: true,
    },
    ai: {
      mode: 'free',
      freeServiceId: 'ovhcloud',
      custom: { address: 'https://api.openai.com/v1', key: '', model: '' },
      customVerified: { fingerprint: '', model: '', at: '' },
      agreements: [],
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
    'doc.position': {},
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

/* ------------------------------------------------------------------------ */
/* Feature 004, User Story 9: the scope of the editor's checker (T072)       */
/* ------------------------------------------------------------------------ */

const VIEWS: readonly ViewId[] = ['body', 'description', 'source'];

/** The English words of a Russian book's description (spec SC-009), none of them checked. */
const ENGLISH = {
  publisher: 'Example Publishing House',
  keywords: 'spelling, scope, description, fields, check',
  city: 'London',
  bookName: 'The Great Spelling Scope Test',
  customInfo: 'imported from the example library catalogue by hand',
  srcAnnotation: 'The original English annotation of this little book.',
};

/** A Russian book whose description carries English words in every kind of field. */
function scopeDocument(): Document {
  const doc = spellDocument();
  const annotation = (nodeId: string, text: string): AnnotationNode =>
    ({
      type: 'annotation',
      attrs: { nodeId },
      content: [{ type: 'p', attrs: { nodeId: `${nodeId}P` }, content: [{ type: 'text', text }] }],
    }) as unknown as AnnotationNode;
  doc.description.titleInfo.annotation = annotation('ann', 'В диревне готовились к празнику.');
  doc.description.titleInfo.keywords = ENGLISH.keywords;
  doc.description.srcTitleInfo = {
    genres: [{ code: 'sf' }],
    authors: [{ firstName: 'John', lastName: 'Smith', homePages: [], emails: [] }],
    bookTitle: 'Original title',
    annotation: annotation('srcAnn', ENGLISH.srcAnnotation),
    coverpage: [],
    lang: 'en',
    translators: [],
    sequences: [],
  };
  doc.description.documentInfo.history = annotation('hist', 'Первая версия файла.');
  doc.description.publishInfo = {
    bookName: ENGLISH.bookName,
    publisher: ENGLISH.publisher,
    city: ENGLISH.city,
    sequences: [],
  };
  doc.description.customInfo = [{ infoType: 'catalogue', text: ENGLISH.customInfo }];
  return doc;
}

describe('spelling scope (feature 004 US9)', { timeout: 30_000 }, () => {
  it('enables tools.spellcheck and tools.spellHighlight under the 0.0.3 conditions in every view', async () => {
    const { store, services, ctx } = await renderApp();
    const enabled = (id: string) => services.commands.isEnabled(id, ctx);

    // Connected, a document open, the Source text clean, spell checking on: both commands in
    // every view - the active view plays no part.
    for (const view of VIEWS) {
      act(() => actions.setActiveView(store, view));
      expect(enabled('tools.spellcheck'), `tools.spellcheck in the ${view} view`).toBe(true);
      expect(enabled('tools.spellHighlight'), `tools.spellHighlight in the ${view} view`).toBe(
        true,
      );
    }

    // A dirty Source text: the dialog waits, the toggle does not - in every view alike.
    act(() => actions.setSourceDirty(store, true));
    for (const view of VIEWS) {
      act(() => actions.setActiveView(store, view));
      expect(enabled('tools.spellcheck'), `dirty Source, ${view} view`).toBe(false);
      expect(enabled('tools.spellHighlight'), `dirty Source, ${view} view`).toBe(true);
    }
    act(() => actions.setSourceDirty(store, false));

    // Spell checking off in Settings: no dialog, the toggle stays.
    act(() =>
      actions.setSettings(store, {
        ...store.getState().settings!,
        view: { ...store.getState().settings!.view, spellEnabled: false },
      }),
    );
    for (const view of VIEWS) {
      act(() => actions.setActiveView(store, view));
      expect(enabled('tools.spellcheck'), `spellEnabled off, ${view} view`).toBe(false);
      expect(enabled('tools.spellHighlight'), `spellEnabled off, ${view} view`).toBe(true);
    }
    act(() =>
      actions.setSettings(store, {
        ...store.getState().settings!,
        view: { ...store.getState().settings!.view, spellEnabled: true },
      }),
    );

    // A document shown in the Source view only (a malformed file): no dialog.
    act(() => actions.setDocument(store, spellDocument(), { sourceOnly: true }));
    for (const view of VIEWS) {
      act(() => actions.setActiveView(store, view));
      expect(enabled('tools.spellcheck'), `source only, ${view} view`).toBe(false);
      expect(enabled('tools.spellHighlight'), `source only, ${view} view`).toBe(true);
    }
    act(() => actions.setDocument(store, spellDocument()));
    act(() => actions.setActiveView(store, 'body'));
    expect(enabled('tools.spellcheck')).toBe(true);

    // No document: no dialog, the toggle stays; disconnected: neither.
    act(() => actions.closeDocument(store));
    expect(enabled('tools.spellcheck')).toBe(false);
    expect(enabled('tools.spellHighlight')).toBe(true);
    act(() => actions.setConnection(store, 'disconnected'));
    expect(enabled('tools.spellcheck')).toBe(false);
    expect(enabled('tools.spellHighlight')).toBe(false);
  });

  it('walks the annotation, the history and the bodies only - never a description field', () => {
    const doc = scopeDocument();
    const blocks = collectSpellBlocks(doc);
    // The order of the Body view: the annotation block, the history block, then the bodies.
    expect(blocks.map((block) => `${block.where}:${block.nodeId}`)).toEqual([
      'annotation:annP',
      'history:histP',
      'body:p1',
    ]);
    expect(new Set(blocks.map((block) => block.where))).toEqual(
      new Set(['annotation', 'history', 'body']),
    );
    // Not one English word of the description reaches the walk - the source title info's
    // annotation, edited in the Description view only, included (FR-080).
    const walked = blocks.map((block) => block.text).join('\n');
    for (const [field, value] of Object.entries(ENGLISH)) {
      expect(walked, `${field} is not checked`).not.toContain(value);
      for (const word of value.split(/[\s,.]+/).filter(Boolean)) {
        expect(walked, `"${word}" of ${field} is not checked`).not.toMatch(
          new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u'),
        );
      }
    }
    expect(blocks.some((block) => block.nodeId === 'srcAnnP')).toBe(false);
    expect(walked).toContain('диревне');
    expect(walked).toContain('Первая версия файла.');
  });
});
