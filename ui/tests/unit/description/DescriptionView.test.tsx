/**
 * T075/T076 - the Description forms inside the application shell: every section renders with
 * stable test ids, typing updates the model (and the modified flag), the genre picker lists the
 * effective genre list grouped by category in the interface language, the "new" ID button
 * warns before replacing the id, persons / sequences / custom rows can be added and removed,
 * the rich annotation field edits paragraphs, and the Binary Objects list shows the metadata
 * with previews, badges and the remove flow (reference check -> confirmation -> force).
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { createAppServices, type AppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';

import { fakeDocument, fakeRpc, rpcError } from '../features/testUtils';

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

const GENRES = {
  entries: [
    {
      code: 'sf',
      category: 'sf',
      names: { en: 'Science Fiction', ru: 'Научная фантастика' },
      source: 'standard',
    },
    {
      code: 'sf_history',
      category: 'sf',
      names: { en: 'Alternative history', ru: 'Альтернативная история' },
      source: 'standard',
    },
    {
      code: 'det_classic',
      category: 'det',
      names: { en: 'Classical detectives', ru: 'Классический детектив' },
      source: 'standard',
    },
    {
      code: 'sf_litrpg',
      category: 'sf',
      names: { en: 'LitRPG', ru: 'ЛитРПГ' },
      source: 'user',
      file: '/data/genres/custom.genres.tsv',
    },
  ],
  categories: [
    { key: 'sf', titles: { en: 'SF, Fantasy', ru: 'Фантастика, Фэнтези' } },
    { key: 'det', titles: { en: 'Detectives, Thrillers', ru: 'Детективы и Боевики' } },
  ],
  userFiles: ['/data/genres/custom.genres.tsv'],
  effectiveSources: [
    { source: 'standard', entries: 3 },
    { source: 'user', path: '/data/genres/custom.genres.tsv', entries: 1 },
  ],
  issues: [],
};

const LANGUAGES = {
  groups: [
    {
      key: 'main',
      title: { en: 'Main', ru: 'Основные' },
      languages: [
        { code: 'ru', name: { en: 'Russian', ru: 'Русский' } },
        { code: 'en', name: { en: 'English', ru: 'Английский' } },
      ],
    },
    {
      key: 'europe',
      title: { en: 'Europe', ru: 'Европа' },
      languages: [{ code: 'de', name: { en: 'German', ru: 'Немецкий' } }],
    },
  ],
  entries: [],
};

function richDocument(): Document {
  const base = fakeDocument();
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        genres: [{ code: 'sf' }, { code: 'det_classic', match: 40 }, { code: 'legacy_code' }],
        sequences: [{ name: 'Saga', number: 3, children: [{ name: 'Sub', children: [] }] }],
        date: { text: 'Spring', value: '2020-04-01' },
        coverpage: [{ href: '#c.jpg' }, { href: '#gone.png' }],
        annotation: {
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
        },
      },
      publishInfo: { publisher: 'Press', year: '2020', sequences: [] },
      customInfo: [{ infoType: 'note', text: 'hello' }],
      outputs: [{ type: 'raw-xml', attrs: { nodeId: 'o1', xml: '<output/>', inline: false } }],
    },
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'n1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'n2' },
            content: [
              { type: 'p', attrs: { nodeId: 'n3' }, content: [{ type: 'text', text: 'Hello' }] },
              { type: 'image', attrs: { nodeId: 'n4', href: '#c.jpg' } },
            ],
          },
        ],
      },
    ],
    binaries: [
      {
        id: 'c.jpg',
        contentType: 'image/jpeg',
        size: 10,
        width: 2,
        height: 3,
        decodable: true,
        willConvert: false,
        referenceCount: 2,
      },
      {
        id: 'x.gif',
        contentType: 'image/gif',
        size: 5,
        decodable: true,
        willConvert: true,
        referenceCount: 0,
      },
    ],
  };
}

async function renderDescription(
  document: Document = richDocument(),
  responses: Record<string, unknown> = {},
) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.get': new Error('no settings'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.caret': {},
    'doc.close': {},
    'resources.genres': GENRES,
    'resources.languages': LANGUAGES,
    'binary.list': document.binaries,
    ...responses,
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(<App services={services} startupSearch="" />);
  act(() => {
    actions.setConnection(store, 'connected');
    actions.setDocument(store, document);
    actions.setActiveView(store, 'description');
  });
  await screen.findByTestId('description-view');
  return { store, services, rpc, user };
}

const description = (store: ReturnType<typeof createAppStore>) =>
  store.getState().document!.description;

describe('Description forms (T075)', () => {
  it('renders every section bound to the model with stable test ids', async () => {
    const { store } = await renderDescription();
    expect(screen.getByTestId('description-book-title')).toHaveValue('Alpha');
    expect(screen.getByTestId('description-author-0-first')).toHaveValue('Ivan');
    expect(screen.getByTestId('description-author-0-last')).toHaveValue('Petrov');
    expect(screen.getByTestId('description-genre-0-code')).toHaveTextContent('sf');
    expect(screen.getByTestId('description-genre-1-match')).toHaveValue('40');
    expect(screen.getByTestId('description-genre-0-match')).toHaveValue('');
    expect(screen.getByTestId('description-genre-2-code')).toHaveTextContent('legacy_code');
    expect(screen.getByTestId('description-sequence-0-name')).toHaveValue('Saga');
    expect(screen.getByTestId('description-sequence-0-number')).toHaveValue('3');
    expect(screen.getByTestId('description-sequence-0-0-name')).toHaveValue('Sub');
    expect(screen.getByTestId('description-date-text')).toHaveValue('Spring');
    expect(screen.getByTestId('description-date-value')).toHaveValue('2020-04-01');
    expect(screen.getByTestId('description-lang')).toHaveValue('en');
    expect(screen.getByTestId('description-lang-code')).toHaveValue('en');
    expect(screen.getByTestId('description-annotation')).toHaveTextContent('First line');
    expect(screen.getByTestId('description-id')).toHaveValue('id');
    expect(screen.getByTestId('description-version')).toHaveValue('1.0');
    expect(screen.getByTestId('description-doc-author-0-nickname')).toHaveValue('maker');
    expect(screen.getByTestId('description-doc-date-text')).toHaveValue('2026');
    expect(screen.getByTestId('description-publish-publisher')).toHaveValue('Press');
    expect(screen.getByTestId('description-publish-year')).toHaveValue('2020');
    expect(screen.getByTestId('description-publish-city')).toHaveValue('');
    expect(screen.getByTestId('description-custom-0-type')).toHaveValue('note');
    expect(screen.getByTestId('description-custom-0-text')).toHaveValue('hello');
    expect(screen.getByTestId('description-cover-0-href')).toHaveValue('#c.jpg');
    expect(screen.getByTestId('description-cover-1-dangling')).toBeInTheDocument();
    expect(screen.getByTestId('description-extras-note')).toHaveTextContent('1 preserved element');
    expect(screen.getByTestId('description-encoding')).toHaveTextContent('windows-1251');
    expect(screen.getByTestId('description-bodies-count')).toHaveTextContent('1');
    // Genre names come from the effective list once loaded.
    await waitFor(() =>
      expect(screen.getByTestId('description-genre-0-code')).toHaveTextContent('Science Fiction'),
    );
    expect(screen.getByTestId('description-genre-2-code')).toHaveTextContent(
      'not in the genre list',
    );
    expect(store.getState().modified).toBe(false);
  });

  it('writes typed values to the model, marks it modified and keeps required markers in sync', async () => {
    const { store, user } = await renderDescription();
    const title = screen.getByTestId('description-book-title');
    await user.clear(title);
    expect(description(store).titleInfo.bookTitle).toBe('');
    expect(store.getState().modified).toBe(true);
    expect(title).toHaveAttribute('aria-invalid', 'true');
    await user.type(title, 'Beta');
    expect(description(store).titleInfo.bookTitle).toBe('Beta');
    expect(title).not.toHaveAttribute('aria-invalid');
    await user.type(screen.getByTestId('description-keywords'), 'space opera');
    expect(description(store).titleInfo.keywords).toBe('space opera');
    await user.clear(screen.getByTestId('description-genre-1-match'));
    await user.type(screen.getByTestId('description-genre-1-match'), '100');
    fireEvent.blur(screen.getByTestId('description-genre-1-match'));
    expect(description(store).titleInfo.genres[1]).toEqual({ code: 'det_classic' });
    await user.selectOptions(screen.getByTestId('description-lang'), 'de');
    expect(description(store).titleInfo.lang).toBe('de');
    await user.clear(screen.getByTestId('description-lang-code'));
    await user.type(screen.getByTestId('description-lang-code'), 'xx');
    expect(description(store).titleInfo.lang).toBe('xx');
    expect(screen.getByTestId('description-lang-unknown')).toBeInTheDocument();
  });

  it('adds and removes persons, sequences, custom rows and source title info', async () => {
    const { store, user } = await renderDescription();
    await user.click(screen.getByTestId('description-author-add'));
    await user.type(screen.getByTestId('description-author-1-first'), 'Solo');
    expect(screen.getByTestId('description-author-1-incomplete')).toBeInTheDocument();
    expect(description(store).titleInfo.authors).toHaveLength(2);
    await user.type(screen.getByTestId('description-author-1-last'), 'Act');
    expect(screen.queryByTestId('description-author-1-incomplete')).toBeNull();
    await user.click(screen.getByTestId('description-author-1-email-add'));
    await user.type(screen.getByTestId('description-author-1-email-0'), 'solo@example.org');
    expect(description(store).titleInfo.authors[1]).toEqual({
      firstName: 'Solo',
      lastName: 'Act',
      homePages: [],
      emails: ['solo@example.org'],
    });
    await user.click(screen.getByTestId('description-author-0-remove'));
    expect(description(store).titleInfo.authors[0]?.firstName).toBe('Solo');

    await user.click(screen.getByTestId('description-sequence-0-add-nested'));
    await user.type(screen.getByTestId('description-sequence-0-1-name'), 'Nested 2');
    await user.type(screen.getByTestId('description-sequence-0-1-number'), '7');
    expect(description(store).titleInfo.sequences[0]!.children[1]).toEqual({
      name: 'Nested 2',
      number: 7,
      children: [],
    });
    await user.click(screen.getByTestId('description-sequence-0-0-remove'));
    expect(description(store).titleInfo.sequences[0]!.children).toHaveLength(1);

    await user.click(screen.getByTestId('description-custom-add'));
    await user.type(screen.getByTestId('description-custom-1-text'), 'untyped');
    expect(screen.getByTestId('description-custom-1-type')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByTestId('description-custom-1-type'), 'kind');
    expect(description(store).customInfo[1]).toEqual({ infoType: 'kind', text: 'untyped' });

    expect(screen.queryByTestId('description-sti-book-title')).toBeNull();
    await user.click(screen.getByTestId('description-src-title-info-add'));
    await user.type(screen.getByTestId('description-sti-book-title'), 'A Modern Book');
    expect(description(store).srcTitleInfo?.bookTitle).toBe('A Modern Book');
    await user.click(screen.getByTestId('description-src-title-info-remove'));
    expect(description(store).srcTitleInfo).toBeUndefined();
  });

  it('generates a new UUID id only after the confirmation', async () => {
    const { store, user } = await renderDescription();
    await user.click(screen.getByTestId('description-id-new'));
    const prompt = await screen.findByTestId('dialog-new-id');
    expect(prompt).toHaveTextContent('Are you sure you want to generate a new ID?');
    await user.click(within(prompt).getByTestId('dialog-new-id-button-no'));
    expect(description(store).documentInfo.id).toBe('id');
    await user.click(screen.getByTestId('description-id-new'));
    await user.click(
      within(await screen.findByTestId('dialog-new-id')).getByTestId('dialog-new-id-button-yes'),
    );
    expect(description(store).documentInfo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByTestId('description-id')).toHaveValue(description(store).documentInfo.id);
  });

  it('picks genres from the effective list grouped by category, including user genres', async () => {
    const { store, user, rpc } = await renderDescription();
    await user.click(screen.getByTestId('description-genre-add'));
    const picker = await screen.findByTestId('genre-picker');
    await waitFor(() =>
      expect(within(picker).getByTestId('genre-picker-option-sf_litrpg')).toBeInTheDocument(),
    );
    expect(within(picker).getByTestId('genre-picker-group-sf')).toHaveAttribute(
      'label',
      'SF, Fantasy',
    );
    expect(within(picker).getByTestId('genre-picker-option-sf_litrpg')).toHaveTextContent(
      'LitRPG (sf_litrpg) [user]',
    );
    expect(rpc.calls.filter((c) => c.method === 'resources.genres').length).toBeGreaterThanOrEqual(
      2,
    );
    await user.type(within(picker).getByTestId('genre-picker-filter'), 'detect');
    expect(within(picker).queryByTestId('genre-picker-option-sf')).toBeNull();
    await user.clear(within(picker).getByTestId('genre-picker-filter'));
    await user.selectOptions(within(picker).getByTestId('genre-picker-list'), 'sf_litrpg');
    await user.click(within(picker).getByTestId('genre-picker-button-ok'));
    expect(description(store).titleInfo.genres.at(-1)).toEqual({ code: 'sf_litrpg' });
    expect(screen.getByTestId('description-genre-3-code')).toHaveTextContent('LitRPG');
    await user.click(screen.getByTestId('description-genre-0-remove'));
    expect(description(store).titleInfo.genres[0]).toEqual({ code: 'det_classic', match: 40 });
  });

  it('shows the annotation as paragraphs and toggles inline styles from the toolbar (T076)', async () => {
    const { store, user } = await renderDescription();
    const annotation = screen.getByTestId('description-annotation');
    expect(annotation.querySelectorAll('p')).toHaveLength(2);
    expect(annotation.querySelector('em, .fb-emphasis, [class*="emphasis"]')).not.toBeNull();
    const strong = screen.getByTestId('description-annotation-mark-strong');
    expect(strong).toHaveAttribute('aria-pressed', 'false');
    await user.click(strong);
    // A collapsed caret: the mark is stored for the next typed text and shown as pressed.
    expect(strong).toHaveAttribute('aria-pressed', 'true');
    expect(description(store).titleInfo.annotation?.content).toHaveLength(2);
    expect(store.getState().modified).toBe(false);
    // The history field starts empty and is omitted from the model.
    expect(screen.getByTestId('description-history').querySelectorAll('p')).toHaveLength(1);
    expect(description(store).documentInfo.history).toBeUndefined();
  });

  it('lists binaries with previews and badges and removes them with the reference check', async () => {
    const removeCalls: unknown[] = [];
    const { store, user } = await renderDescription(richDocument(), {
      'binary.remove': (params: unknown) => {
        removeCalls.push(params);
        const p = params as { id: string; force?: boolean };
        if (p.id === 'c.jpg' && !p.force) {
          return rpcError(-32602, 'invalidParams: binary is still referenced', {
            field: 'id',
            referenceCount: 2,
          });
        }
        return {};
      },
    });
    const row = screen.getByTestId('binary-objects-row-x.gif');
    expect(row).toHaveTextContent('image/gif');
    expect(within(row).getByTestId('binary-objects-badge-convert-x.gif')).toBeInTheDocument();
    expect(within(row).getByTestId('binary-objects-badge-unreferenced-x.gif')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('binary-objects-row-c.jpg')).getByTestId(
        'binary-objects-preview-c.jpg',
      ),
    ).toHaveAttribute('src', expect.stringContaining('/binary/doc-1/c.jpg/preview?w=96'));
    expect(screen.getByTestId('binary-objects-row-c.jpg')).toHaveTextContent('2×3');
    expect(screen.getByTestId('binary-objects-dangling')).toHaveTextContent('#gone.png');
    expect(screen.getByTestId('description-binaries-count')).toHaveTextContent('2');

    await user.click(screen.getByTestId('binary-objects-remove-x.gif'));
    await waitFor(() => expect(screen.queryByTestId('binary-objects-row-x.gif')).toBeNull());
    expect(store.getState().document!.binaries.map((b) => b.id)).toEqual(['c.jpg']);

    await user.click(screen.getByTestId('binary-objects-remove-c.jpg'));
    const confirm = await screen.findByTestId('dialog-binary-remove-referenced');
    expect(confirm).toHaveTextContent('still referenced 2 times');
    await user.click(within(confirm).getByTestId('dialog-binary-remove-referenced-button-yes'));
    await waitFor(() => expect(screen.queryByTestId('binary-objects-row-c.jpg')).toBeNull());
    expect(removeCalls).toEqual([
      { docId: 'doc-1', id: 'x.gif', force: false },
      { docId: 'doc-1', id: 'c.jpg', force: false },
      { docId: 'doc-1', id: 'c.jpg', force: true },
    ]);
  });

  it('undoes form edits through Edit > Undo and survives a view switch', async () => {
    const { store, user, services } = await renderDescription();
    await user.type(screen.getByTestId('description-publish-city'), 'Moscow');
    expect(description(store).publishInfo?.city).toBe('Moscow');
    expect(services.undo.peekUndo()?.view).toBe('description');
    await user.click(screen.getByTestId('view-body'));
    await screen.findByTestId('body-view');
    act(() => {
      services.undo.undo();
    });
    expect(description(store).publishInfo?.city).toBeUndefined();
    expect(store.getState().activeView).toBe('description');
    expect(await screen.findByTestId('description-publish-city')).toHaveValue('');
  });
});
