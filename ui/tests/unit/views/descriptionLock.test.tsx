/**
 * The Description view's quiet lock while a script runs (feature 003 FR-011, T030): every text
 * field is read-only (not disabled - the text stays selectable, nothing is greyed), the
 * drop-downs refuse a change, the add / remove / choose / today buttons and the binary and cover
 * controls are unavailable, the rich fields refuse edits; everything returns when the run ends,
 * and the lock marks the form (`data-locked`) for styling hooks and tests.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { createAppServices, type AppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';

import { fakeDocument, fakeRpc, fakeRunLock } from '../features/testUtils';

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

const LANGUAGES = {
  groups: [
    {
      key: 'main',
      title: { en: 'Main', ru: 'Main' },
      languages: [
        { code: 'ru', name: { en: 'Russian', ru: 'Russian' } },
        { code: 'en', name: { en: 'English', ru: 'English' } },
        { code: 'de', name: { en: 'German', ru: 'German' } },
      ],
    },
  ],
  entries: [],
};

function lockedDocument(): Document {
  const base = fakeDocument();
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        genres: [{ code: 'sf', match: 40 }],
        sequences: [{ name: 'Saga', number: 3, children: [] }],
        date: { text: 'Spring', value: '2020-04-01' },
        coverpage: [{ href: '#c.jpg' }],
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'a1' },
          content: [
            { type: 'p', attrs: { nodeId: 'a2' }, content: [{ type: 'text', text: 'Note' }] },
          ],
        },
      },
    },
    binaries: [
      {
        id: 'c.jpg',
        contentType: 'image/jpeg',
        size: 10,
        width: 2,
        height: 3,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
    ],
  };
}

async function renderLocked() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const document = lockedDocument();
  const rpc = fakeRpc({
    'settings.get': new Error('no settings'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.position': {},
    'doc.close': {},
    'resources.genres': {
      entries: [],
      categories: [],
      userFiles: [],
      effectiveSources: [],
      issues: [],
    },
    'resources.languages': LANGUAGES,
    'binary.list': document.binaries,
    'binary.remove': {},
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
  act(() => {
    actions.setRunLock(store, fakeRunLock());
  });
  return { store, services, rpc, user };
}

const description = (store: ReturnType<typeof createAppStore>) =>
  store.getState().document!.description;

describe('Description view quiet lock (feature 003 FR-011)', () => {
  it('makes every text field read-only - not disabled - and refuses typing', async () => {
    const { store, user } = await renderLocked();
    expect(screen.getByTestId('description-view')).toHaveAttribute('data-locked', 'true');
    for (const id of [
      'description-book-title',
      'description-keywords',
      'description-author-0-first',
      'description-sequence-0-name',
      'description-sequence-0-number',
      'description-genre-0-match',
      'description-date-text',
      'description-lang-code',
      'description-id',
      'description-publish-publisher',
    ]) {
      const field = screen.getByTestId(id);
      expect(field, id).toHaveAttribute('readonly');
      expect(field, id).not.toBeDisabled();
    }
    const title = screen.getByTestId('description-book-title');
    await user.type(title, 'X');
    expect(title).toHaveValue('Alpha');
    // Even a change event slipping through (drop, IME) does not reach the model.
    fireEvent.change(title, { target: { value: 'Changed' } });
    fireEvent.change(screen.getByTestId('description-sequence-0-number'), {
      target: { value: '9' },
    });
    fireEvent.change(screen.getByTestId('description-genre-0-match'), {
      target: { value: '55' },
    });
    fireEvent.blur(screen.getByTestId('description-genre-0-match'));
    expect(description(store).titleInfo.bookTitle).toBe('Alpha');
    expect(description(store).titleInfo.sequences[0]!.number).toBe(3);
    expect(description(store).titleInfo.genres[0]).toEqual({ code: 'sf', match: 40 });
    expect(store.getState().modified).toBe(false);
  });

  it('refuses drop-down changes and keeps them readable, not greyed', async () => {
    const { store } = await renderLocked();
    const lang = screen.getByTestId('description-lang');
    expect(lang).toHaveAttribute('aria-readonly', 'true');
    expect(lang).not.toBeDisabled();
    fireEvent.change(lang, { target: { value: 'de' } });
    expect(description(store).titleInfo.lang).toBe('en');
    const cover = screen.getByTestId('description-cover-0-href');
    expect(cover).toHaveAttribute('aria-readonly', 'true');
    expect(cover).not.toBeDisabled();
    expect(store.getState().modified).toBe(false);
  });

  it('makes the add, remove, choose, today, new-id, cover and binary controls unavailable', async () => {
    const { store, user } = await renderLocked();
    for (const id of [
      'description-author-add',
      'description-author-0-remove',
      'description-genre-add',
      'description-genre-0-remove',
      'description-genre-0-choose',
      'description-sequence-add',
      'description-sequence-0-add-nested',
      'description-date-today',
      'description-id-new',
      'description-custom-add',
      'description-src-title-info-add',
      'description-cover-add',
      'description-cover-0-remove',
      'description-cover-0-thumb',
      'binary-objects-add',
      'binary-objects-remove-c.jpg',
      'description-annotation-mark-strong',
    ]) {
      expect(screen.getByTestId(id), id).toBeDisabled();
    }
    // The genre code button stays readable; clicking it opens no picker.
    const code = screen.getByTestId('description-genre-0-code');
    expect(code).toHaveAttribute('aria-disabled', 'true');
    await user.click(code);
    expect(screen.queryByTestId('genre-picker')).toBeNull();
    expect(description(store).titleInfo.genres).toHaveLength(1);
  });

  it('refuses edits of the rich annotation field while keeping it readable', async () => {
    const { store } = await renderLocked();
    const annotation = screen.getByTestId('description-annotation');
    expect(annotation).toHaveTextContent('Note');
    expect(annotation).toHaveAttribute('contenteditable', 'false');
    expect(description(store).titleInfo.annotation?.content).toHaveLength(1);
  });

  it('gives everything back when the run ends', async () => {
    const { store, user } = await renderLocked();
    act(() => {
      actions.setRunLock(store, null);
    });
    await waitFor(() =>
      expect(screen.getByTestId('description-view')).toHaveAttribute('data-locked', 'false'),
    );
    const title = screen.getByTestId('description-book-title');
    expect(title).not.toHaveAttribute('readonly');
    expect(screen.getByTestId('description-author-add')).not.toBeDisabled();
    expect(screen.getByTestId('description-lang')).not.toHaveAttribute('aria-readonly');
    expect(screen.getByTestId('description-annotation')).toHaveAttribute('contenteditable', 'true');
    await user.type(title, '!');
    expect(description(store).titleInfo.bookTitle).toBe('Alpha!');
  });
});
