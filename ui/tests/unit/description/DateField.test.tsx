/**
 * Feature 003 US6 (FR-050) - the "Today" button of a date field: the value becomes today's
 * `YYYY-MM-DD` and the text the regional long date the core answers with (`doc.formatDate`),
 * whatever the text contained before; only when the call itself fails does the interface
 * language's long form stand in.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { createAppServices, type AppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { isoDate } from '@/views/description/model';

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
  entries: [{ code: 'sf', category: 'sf', names: { en: 'Science Fiction' }, source: 'standard' }],
  categories: [{ key: 'sf', titles: { en: 'SF, Fantasy' } }],
  userFiles: [],
  effectiveSources: [{ source: 'standard', entries: 1 }],
  issues: [],
};

const LANGUAGES = {
  groups: [
    {
      key: 'main',
      title: { en: 'Main' },
      languages: [{ code: 'en', name: { en: 'English' } }],
    },
  ],
  entries: [],
};

function documentWithDates(): Document {
  const base = fakeDocument();
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: { ...base.description.titleInfo, date: { text: 'Spring', value: '2020-04-01' } },
      documentInfo: { ...base.description.documentInfo, date: { text: '2026' } },
    },
  };
}

async function renderDescription(responses: Record<string, unknown>) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.get': new Error('no settings'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.position': {},
    'doc.close': {},
    'resources.genres': GENRES,
    'resources.languages': LANGUAGES,
    'binary.list': [],
    ...responses,
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(<App services={services} startupSearch="" />);
  act(() => {
    actions.setConnection(store, 'connected');
    actions.setDocument(store, documentWithDates());
    actions.setActiveView(store, 'description');
  });
  await screen.findByTestId('description-view');
  return { store, rpc, user };
}

const description = (store: ReturnType<typeof createAppStore>) =>
  store.getState().document!.description;

describe('Date field "Today" (feature 003 FR-050)', () => {
  it('replaces the text with the regional long date from the core and the value with YYYY-MM-DD', async () => {
    const { store, rpc, user } = await renderDescription({
      'doc.formatDate': ({ value }: { value: string }) => ({ text: `regional ${value}` }),
    });
    const today = isoDate(new Date());
    expect(screen.getByTestId('description-date-text')).toHaveValue('Spring');

    await user.click(screen.getByTestId('description-date-today'));
    await waitFor(() =>
      expect(screen.getByTestId('description-date-text')).toHaveValue(`regional ${today}`),
    );
    expect(screen.getByTestId('description-date-value')).toHaveValue(today);
    expect(description(store).titleInfo.date).toEqual({ text: `regional ${today}`, value: today });
    expect(rpc.calls.filter((c) => c.method === 'doc.formatDate')).toEqual([
      { method: 'doc.formatDate', params: { value: today } },
    ]);

    // The document-info date the same way; the text it had is replaced as well.
    await user.click(screen.getByTestId('description-doc-date-today'));
    await waitFor(() =>
      expect(screen.getByTestId('description-doc-date-text')).toHaveValue(`regional ${today}`),
    );
    expect(screen.getByTestId('description-doc-date-value')).toHaveValue(today);
    expect(store.getState().modified).toBe(true);
  });

  it("writes the interface language's long form only when the call itself fails", async () => {
    const { store, user } = await renderDescription({
      'doc.formatDate': rpcError(-32000, 'connection lost'),
    });
    const now = new Date();
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(now);

    await user.click(screen.getByTestId('description-date-today'));
    await waitFor(() => expect(screen.getByTestId('description-date-text')).toHaveValue(expected));
    expect(description(store).titleInfo.date).toEqual({ text: expected, value: isoDate(now) });
  });
});
