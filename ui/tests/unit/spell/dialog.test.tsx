/**
 * T089 - the Spelling dialog inside the application shell with a fake core: walks annotation,
 * history and bodies; Ignore / Ignore All / Change / Change All / Add / Undo last act on the
 * document (each Change one undo entry, Change All one grouped entry); the dictionaries can be
 * switched; the end of the document shows "The spelling check is complete.".
 */

import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

import { App } from '@/app/App';
import type { CommandContext } from '@/app/commands';
import { createAppServices, type AppServices } from '@/app/services';
import type { ModelNodeJson } from '@/editor/fromModel';
import { collectSpellBlocks, replaceTextblockInDocument } from '@/features/spell/dialogController';
import { changeLanguage, initI18n } from '@/i18n';
import type { AnnotationNode, BodyNode, Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';

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

const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const p = (nodeId: string, value: string): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId },
  content: [text(value)],
});

/** Words the fake dictionary accepts; everything else is misspelled. */
const KNOWN = new Set([
  'Привет',
  'привет',
  'приветик',
  'мир',
  'и',
  'снова',
  'Hello',
  'world',
  'аннотация',
  'история',
]);
const SUGGESTIONS: Record<string, string[]> = {
  превет: ['привет', 'приветик'],
  мирр: ['мир'],
  helo: ['hello', 'help'],
  аннотацыя: ['аннотация'],
  исторья: ['история'],
};

function spellDocument(): Document {
  const annotation: ModelNodeJson = {
    type: 'annotation',
    attrs: { nodeId: 'ann' },
    content: [p('annP', 'Это аннотацыя')],
  };
  const history: ModelNodeJson = {
    type: 'annotation',
    attrs: { nodeId: 'hist' },
    content: [p('histP', 'Это исторья')],
  };
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body1' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 's1' },
        content: [p('p1', 'Привет превет мирр'), p('p2', 'и снова превет helo world')],
      },
    ],
  };
  const doc = fakeDocument({ bodies: [body as unknown as BodyNode] });
  doc.description.titleInfo.lang = 'ru';
  doc.description.titleInfo.annotation = annotation as unknown as AnnotationNode;
  doc.description.documentInfo.history = history as unknown as AnnotationNode;
  return doc;
}

async function renderApp(doc: Document) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const custom: string[] = [];
  const rpc = fakeRpc({
    'settings.get': new Error('no settings'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.position': {},
    'doc.close': {},
    'spell.dictionaries': [
      { tag: 'en_US', lang: 'en', name: 'en_US', source: 'bundled' },
      { tag: 'ru_RU', lang: 'ru', name: 'ru_RU', source: 'bundled' },
    ],
    'spell.check': (params: unknown) => {
      const { words, langs } = params as { words: string[]; langs: string[] };
      const latinOk = langs.some((lang) => lang.startsWith('en'));
      return {
        misspelled: words.filter((word) => {
          if (KNOWN.has(word) || custom.includes(word)) return false;
          if (/^[a-z]+$/i.test(word) && !latinOk) return true;
          return !/^[a-z]+$/i.test(word) || !['hello', 'world', 'help'].includes(word);
        }),
        langs,
      };
    },
    'spell.suggest': (params: unknown) => ({
      suggestions: SUGGESTIONS[(params as { word: string }).word] ?? [],
    }),
    'spell.addWord': (params: unknown) => {
      custom.push((params as { word: string }).word);
      return { added: true, words: [...custom] };
    },
    'spell.removeWord': (params: unknown) => {
      const word = (params as { word: string }).word;
      custom.splice(custom.indexOf(word), 1);
      return { removed: true, words: [...custom] };
    },
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(<App services={services} startupSearch="" />);
  act(() => {
    actions.setConnection(store, 'connected');
    actions.setDocument(store, doc);
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

const bodyText = (doc: Document) =>
  collectSpellBlocks(doc)
    .map((block) => `${block.where}:${block.text}`)
    .join(' | ');

describe('Spelling dialog', { timeout: 30_000 }, () => {
  it('walks annotation, history and body; every button acts as named; ends with the completion message', async () => {
    const { store, services, user, ctx, custom } = await renderApp(spellDocument());
    expect(bodyText(store.getState().document!)).toBe(
      'annotation:Это аннотацыя | history:Это исторья | body:Привет превет мирр | body:и снова превет helo world',
    );

    act(() => {
      void services.commands.execute('tools.spellcheck', ctx); // opens the dialog: a render
    });
    const dialog = await screen.findByTestId('dialog-spelling');
    const word = within(dialog).getByTestId('spelling-not-in-dictionary');
    const changeTo = within(dialog).getByTestId('spelling-change-to');

    // 1. annotation: "Это" is unknown to the fake dictionary -> Ignore.
    await waitFor(() => expect(word).toHaveValue('Это'));
    expect(within(dialog).getByTestId('spelling-status')).toHaveTextContent('In: annotation');
    await user.click(within(dialog).getByTestId('spelling-ignore'));

    // 2. "аннотацыя" -> Change to the first suggestion (prefilled).
    await waitFor(() => expect(word).toHaveValue('аннотацыя'));
    expect(changeTo).toHaveValue('аннотация');
    expect(within(dialog).getByTestId('spelling-suggestion-0')).toHaveTextContent('аннотация');
    const depth = services.undo.undoDepth;
    await user.click(within(dialog).getByTestId('spelling-change'));
    await waitFor(() =>
      expect(store.getState().document!.description.titleInfo.annotation).toMatchObject({
        content: [{ content: [{ text: 'Это аннотация' }] }],
      }),
    );
    expect(services.undo.undoDepth).toBe(depth + 1);

    // 3. history: "Это" again -> Ignore All; then "исторья" -> Undo-able Add.
    await waitFor(() => expect(word).toHaveValue('Это'));
    expect(within(dialog).getByTestId('spelling-status')).toHaveTextContent('In: history');
    await user.click(within(dialog).getByTestId('spelling-ignore-all'));
    await waitFor(() => expect(word).toHaveValue('исторья'));
    await user.click(within(dialog).getByTestId('spelling-add'));
    await waitFor(() => expect(custom).toEqual(['исторья']));

    // 4. body: "превет" -> Change All replaces both occurrences as one undo entry.
    await waitFor(() => expect(word).toHaveValue('превет'));
    expect(within(dialog).getByTestId('spelling-status')).toHaveTextContent('In: body');
    expect(changeTo).toHaveValue('привет');
    const before = services.undo.undoDepth;
    await user.click(within(dialog).getByTestId('spelling-change-all'));
    await waitFor(() =>
      expect(bodyText(store.getState().document!)).toBe(
        'annotation:Это аннотация | history:Это исторья | body:Привет привет мирр | body:и снова привет helo world',
      ),
    );
    expect(
      services.undo
        .entries()
        .slice(before)
        .every((e) => e.groupId !== 0),
    ).toBe(true);

    // 5. "мирр" -> type a replacement and press Enter.
    await waitFor(() => expect(word).toHaveValue('мирр'));
    await user.clear(changeTo);
    await user.type(changeTo, 'мир{Enter}');
    await waitFor(() =>
      expect(bodyText(store.getState().document!)).toContain('body:Привет привет мир |'),
    );

    // 6. "helo" (English in a Russian document) -> Undo last reverts the "мир" change first.
    await waitFor(() => expect(word).toHaveValue('helo'));
    expect(within(dialog).getByTestId('spelling-undo')).toBeEnabled();
    await user.click(within(dialog).getByTestId('spelling-undo'));
    await waitFor(() => expect(word).toHaveValue('мирр'));
    expect(bodyText(store.getState().document!)).toContain('body:Привет привет мирр |');
    await user.click(within(dialog).getByTestId('spelling-ignore'));

    // 7. Enabling the English dictionary accepts "world" but not "helo"; Ignore -> complete.
    await waitFor(() => expect(word).toHaveValue('helo'));
    expect(within(dialog).getByTestId('spelling-dictionary-ru_RU')).toBeChecked();
    expect(within(dialog).getByTestId('spelling-dictionary-en_US')).not.toBeChecked();
    await user.click(within(dialog).getByTestId('spelling-dictionary-en_US'));
    await waitFor(() => expect(word).toHaveValue('helo'));
    await user.click(within(dialog).getByTestId('spelling-ignore'));
    const complete = await screen.findByTestId('spelling-complete');
    expect(complete).toHaveTextContent('The spelling check is complete.');
    expect(screen.queryByTestId('dialog-spelling')).toBeNull();
    await user.click(within(complete).getByTestId('spelling-complete-button-ok'));
  });

  it('Undo last after Add removes the word from the custom dictionary and returns to it', async () => {
    const doc = spellDocument();
    doc.description.titleInfo.annotation = undefined;
    doc.description.documentInfo.history = undefined;
    const { services, user, ctx, custom } = await renderApp(doc);
    act(() => {
      void services.commands.execute('tools.spellcheck', ctx); // opens the dialog: a render
    });
    const dialog = await screen.findByTestId('dialog-spelling');
    const word = within(dialog).getByTestId('spelling-not-in-dictionary');
    await waitFor(() => expect(word).toHaveValue('превет'));
    await user.click(within(dialog).getByTestId('spelling-add'));
    await waitFor(() => expect(custom).toEqual(['превет']));
    await waitFor(() => expect(word).toHaveValue('мирр'));
    await user.click(within(dialog).getByTestId('spelling-undo'));
    await waitFor(() => expect(custom).toEqual([]));
    await waitFor(() => expect(word).toHaveValue('превет'));
    await user.click(within(dialog).getByTestId('dialog-spelling-button-close'));
    expect(screen.queryByTestId('dialog-spelling')).toBeNull();
  });

  it('replaceTextblockInDocument reaches annotation, history and body blocks', () => {
    const doc = spellDocument();
    const replacement = p('annP', 'changed');
    const inAnnotation = replaceTextblockInDocument(doc, 'annP', replacement);
    expect(inAnnotation.description.titleInfo.annotation).toMatchObject({
      content: [{ content: [{ text: 'changed' }] }],
    });
    expect(inAnnotation.bodies).toBe(doc.bodies);
    const inHistory = replaceTextblockInDocument(doc, 'histP', p('histP', 'h'));
    expect(inHistory.description.documentInfo.history).toMatchObject({
      content: [{ content: [{ text: 'h' }] }],
    });
    const inBody = replaceTextblockInDocument(doc, 'p2', p('p2', 'b'));
    expect(bodyText(inBody)).toContain('body:b');
    expect(replaceTextblockInDocument(doc, 'nope', p('x', 'x'))).toBe(doc);
  });
});
