/**
 * Vitest UI tests for Description view Maxima Library Lookup Service v2 autocomplete, paging,
 * tabbed narrowing, blur exact-match confirmation, advisory disambiguation, stale-response
 * discard, run-lock dismissal, and 429 cooldown suppression (feature 021, T022, T027, T042).
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AppServicesContext, createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import type {
  MaximaAuthorSeriesItem,
  MaximaLookupExistsParams,
  MaximaLookupExistsResult,
  MaximaLookupSearchParams,
  MaximaLookupSearchResult,
  MaximaPersonItem,
  MaximaPublisherItem,
  MaximaPublisherSeriesItem,
} from '@/rpc/types';
import { DescriptionView } from '@/views/description/DescriptionView';
import { emptyTitleInfo } from '@/views/description/model';

import { fakeDocument, fakeRpc } from './features/testUtils';
import { defaultSettings } from './settings/fixtures';

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

afterEach(() => {
  vi.useRealTimers();
});

async function mountDescription(options: {
  enabled: boolean;
  document?: Document;
  onSearch?: (
    params: MaximaLookupSearchParams,
  ) => Promise<MaximaLookupSearchResult> | MaximaLookupSearchResult;
  onExists?: (
    params: MaximaLookupExistsParams,
  ) => Promise<MaximaLookupExistsResult> | MaximaLookupExistsResult;
}) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');

  const searchCalls: MaximaLookupSearchParams[] = [];
  const existsCalls: MaximaLookupExistsParams[] = [];
  const rpc = fakeRpc({
    'doc.position': {},
    'binary.list': [],
    'resources.genres': { entries: [], groups: [] },
    'resources.languages': { groups: [] },
    'maximaLookup.search': (raw: unknown) => {
      const p = raw as MaximaLookupSearchParams;
      searchCalls.push(p);
      return options.onSearch
        ? options.onSearch(p)
        : ({
            ok: true,
            page: p.page,
            hasMore: false,
            items: [],
          } satisfies MaximaLookupSearchResult);
    },
    'maximaLookup.exists': (raw: unknown) => {
      const p = raw as MaximaLookupExistsParams;
      existsCalls.push(p);
      return options.onExists
        ? options.onExists(p)
        : ({ ok: true, kind: 'person', matchedIds: [] } satisfies MaximaLookupExistsResult);
    },
  });

  const store = createAppStore();
  const settings = defaultSettings();
  settings.maximaLibrary = {
    enabled: options.enabled,
    domain: 'https://maxima-library.com',
    verifiedFingerprint: options.enabled ? 'a'.repeat(64) : '',
  };
  actions.setConnection(store, 'connected');
  actions.setSettings(store, settings);

  const doc = options.document ?? fakeDocument();
  actions.setDocument(store, doc);
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });

  const view = render(
    <AppServicesContext.Provider value={services}>
      <DescriptionView />
    </AppServicesContext.Provider>,
  );
  // Flush async genre/language catalog loads from DescriptionView mount so tests run without act warnings.
  await act(async () => {
    await Promise.resolve();
  });

  return { store, rpc, searchCalls, existsCalls, view };
}

describe('Description view Maxima Library lookup (T022, T027, T042)', () => {
  it('stays completely silent with zero UI or network requests when disabled or on file open', async () => {
    const doc = fakeDocument();
    doc.description.titleInfo.authors = [
      { lastName: 'Толстой', firstName: 'Лев', middleName: '', homePages: [], emails: [] },
    ];
    doc.description.customInfo = [{ infoType: 'mlauthorid', text: '101 Толстой Лев' }];

    const { searchCalls, existsCalls } = await mountDescription({ enabled: false, document: doc });
    expect(screen.queryByTestId('description-author-0-lookup-confirmed')).toBeNull();

    vi.useFakeTimers();
    fireEvent.change(screen.getByTestId('description-author-0-last'), {
      target: { value: 'Толст' },
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(searchCalls).toHaveLength(0);
    expect(existsCalls).toHaveLength(0);
    expect(screen.queryByTestId('description-author-0-lookup-dropdown')).toBeNull();
  });

  it('restores confirmed badges locally on open with 0 network calls and ignores srcTitleInfo & documentInfo', async () => {
    const doc = fakeDocument();
    doc.description.titleInfo.authors = [
      { lastName: 'Толстой', firstName: 'Лев', middleName: '', homePages: [], emails: [] },
    ];
    doc.description.srcTitleInfo = emptyTitleInfo();
    doc.description.srcTitleInfo.authors = [
      { lastName: 'Original', firstName: 'Author', middleName: '', homePages: [], emails: [] },
    ];
    doc.description.documentInfo.authors = [
      { lastName: 'Doc', firstName: 'Maker', middleName: '', homePages: [], emails: [] },
    ];
    doc.description.customInfo = [{ infoType: 'mlauthorid', text: '101 Толстой Лев' }];

    const { searchCalls, existsCalls } = await mountDescription({ enabled: true, document: doc });
    expect(searchCalls).toHaveLength(0);
    expect(existsCalls).toHaveLength(0);
    expect(screen.getByTestId('description-author-0-lookup-confirmed')).toHaveTextContent('#101');
    expect(screen.getByTestId('description-author-0-lookup-site-link')).toBeInTheDocument();

    // Typing in srcTitleInfo and documentInfo authors sends zero requests.
    vi.useFakeTimers();
    fireEvent.change(screen.getByTestId('description-sti-author-0-last'), {
      target: { value: 'Tolstoy' },
    });
    fireEvent.change(screen.getByTestId('description-doc-author-0-last'), {
      target: { value: 'Tolstoy' },
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(searchCalls).toHaveLength(0);
    expect(existsCalls).toHaveLength(0);
  });

  it('debounces person search by 1000 ms, allows first-name-only search, pages, picks clearing middleName, handles blur exists, and withdraws on edit', async () => {
    const personItemsPage0: MaximaPersonItem[] = [
      {
        id: 101,
        lastName: 'Толстой',
        firstName: 'Лев',
        middleName: '',
        fullName: 'Толстой Лев',
        url: 'https://maxima-library.com/index.php?option=com_maxlib&view=maxlibbookslist&layout=author&id=101',
      },
    ];
    const personItemsPage1: MaximaPersonItem[] = [
      {
        id: 102,
        lastName: 'Толстой',
        firstName: 'Алексей',
        middleName: 'Николаевич',
        fullName: 'Толстой Алексей Николаевич',
        url: 'https://maxima-library.com/index.php?option=com_maxlib&view=maxlibbookslist&layout=author&id=102',
      },
    ];

    const doc = fakeDocument();
    doc.description.titleInfo.authors = [
      {
        lastName: '',
        firstName: '',
        middleName: 'OldMiddle',
        nickname: 'LevNick',
        homePages: [],
        emails: [],
      },
    ];

    const { store, searchCalls, existsCalls } = await mountDescription({
      enabled: true,
      document: doc,
      onSearch: (p) => {
        if (p.kind === 'person') {
          return {
            ok: true,
            page: p.page,
            hasMore: p.page === 0,
            items: p.page === 0 ? personItemsPage0 : personItemsPage1,
          };
        }
        return { ok: true, page: 0, hasMore: false, items: [] };
      },
      onExists: (p) => {
        if (
          p.kind === 'person' &&
          p.lastName === 'Толстой' &&
          p.firstName === 'Лев' &&
          p.middleName === ''
        ) {
          return { ok: true, kind: 'person', matchedIds: [101] };
        }
        return { ok: true, kind: 'person', matchedIds: [101, 102] }; // ambiguous -> stay unconfirmed
      },
    });

    vi.useFakeTimers();

    // First-name-only search (min 2 chars, empty lastName).
    const firstInput = screen.getByTestId('description-author-0-first');
    fireEvent.change(firstInput, { target: { value: 'Л' } });
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(searchCalls).toHaveLength(0);

    fireEvent.change(firstInput, { target: { value: 'Ле' } });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(searchCalls).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]).toMatchObject({
      kind: 'person',
      role: 'author',
      lastName: '',
      firstName: 'Ле',
      page: 0,
      pageSize: 30,
    });

    // Next page -> page 1, Prev -> page 0.
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-author-0-lookup-next'));
    });
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[1]).toMatchObject({ page: 1 });
    expect(screen.getByTestId('description-author-0-lookup-item-102')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('description-author-0-lookup-prev'));
    });
    expect(screen.getByTestId('description-author-0-lookup-item-101')).toBeInTheDocument();

    // Pick item 101: fills all 3 parts (explicitly clearing OldMiddle), preserves nickname, binds mlauthorid.
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-author-0-lookup-item-101'));
    });
    expect(screen.getByTestId('description-author-0-last')).toHaveValue('Толстой');
    expect(screen.getByTestId('description-author-0-first')).toHaveValue('Лев');
    expect(screen.getByTestId('description-author-0-middle')).toHaveValue('');
    expect(screen.getByTestId('description-author-0-nickname')).toHaveValue('LevNick');
    expect(screen.getByTestId('description-author-0-lookup-confirmed')).toHaveTextContent('#101');
    expect(store.getState().document!.description.customInfo).toContainEqual({
      infoType: 'mlauthorid',
      text: '101 Толстой Лев',
    });

    // Editing nickname preserves confirmation.
    fireEvent.change(screen.getByTestId('description-author-0-nickname'), {
      target: { value: 'NewNick' },
    });
    expect(screen.getByTestId('description-author-0-lookup-confirmed')).toBeInTheDocument();

    // Editing lastName withdraws confirmation; blur with ambiguous match stays unconfirmed.
    fireEvent.change(screen.getByTestId('description-author-0-last'), {
      target: { value: 'Толстой2' },
    });
    expect(screen.queryByTestId('description-author-0-lookup-confirmed')).toBeNull();
    await act(async () => {
      fireEvent.blur(screen.getByTestId('description-author-0-last'));
    });
    expect(existsCalls).toHaveLength(1);
    expect(existsCalls[0]).toEqual({
      kind: 'person',
      role: 'author',
      lastName: 'Толстой2',
      firstName: 'Лев',
      middleName: '',
    });
    expect(screen.queryByTestId('description-author-0-lookup-confirmed')).toBeNull();

    // Exact unique match on blur auto-confirms and binds mlauthorid.
    fireEvent.change(screen.getByTestId('description-author-0-last'), {
      target: { value: 'Толстой' },
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId('description-author-0-last'));
    });
    expect(screen.getByTestId('description-author-0-lookup-confirmed')).toHaveTextContent('#101');

    // Focus/click reopens dropdown, and activating runLock dismisses it immediately.
    await act(async () => {
      fireEvent.focus(screen.getByTestId('description-author-0-last'));
    });
    expect(screen.getByTestId('description-author-0-lookup-dropdown')).toBeInTheDocument();
    act(() => {
      actions.setRunLock(store, { kind: 'script', label: 'test', startedAt: Date.now() });
    });
    expect(screen.queryByTestId('description-author-0-lookup-dropdown')).toBeNull();
  });

  it('discards stale out-of-order person search responses', async () => {
    let resolveFirst!: (val: MaximaLookupSearchResult) => void;
    let resolveSecond!: (val: MaximaLookupSearchResult) => void;
    let callNum = 0;

    const { searchCalls } = await mountDescription({
      enabled: true,
      onSearch: () => {
        callNum += 1;
        return new Promise((resolve) => {
          if (callNum === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        });
      },
    });

    vi.useFakeTimers();
    const lastInput = screen.getByTestId('description-author-0-last');
    fireEvent.change(lastInput, { target: { value: 'Пу' } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(searchCalls).toHaveLength(1);

    fireEvent.change(lastInput, { target: { value: 'Пуш' } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(searchCalls).toHaveLength(2);

    // Second resolves first with ID 222, then stale first resolves with ID 111 -> 222 wins.
    await act(async () => {
      resolveSecond({
        ok: true,
        page: 0,
        hasMore: false,
        items: [
          {
            id: 222,
            lastName: 'Пушкин',
            firstName: 'Александр',
            middleName: '',
            fullName: 'Пушкин Александр',
            url: 'https://maxima-library.com/p/222',
          },
        ],
      });
    });
    expect(screen.getByTestId('description-author-0-lookup-item-222')).toBeInTheDocument();

    await act(async () => {
      resolveFirst({
        ok: true,
        page: 0,
        hasMore: false,
        items: [
          {
            id: 111,
            lastName: 'Пугачёв',
            firstName: 'Емельян',
            middleName: '',
            fullName: 'Пугачёв Емельян',
            url: 'https://maxima-library.com/p/111',
          },
        ],
      });
    });
    expect(screen.getByTestId('description-author-0-lookup-item-222')).toBeInTheDocument();
    expect(screen.queryByTestId('description-author-0-lookup-item-111')).toBeNull();
  });

  it('implements 3-tab Author Series parity (excluding aboutTheAuthor from Makers, empty-box browse, marks, nested excludedSeriesId/parentSeriesId, focus jump to number)', async () => {
    const doc = fakeDocument();
    doc.description.titleInfo.authors = [
      { lastName: 'Стругацкий', firstName: 'Аркадий', middleName: '', homePages: [], emails: [] },
    ];
    // aboutTheAuthor alone should NOT enable Makers' series tab!
    doc.description.customInfo = [
      { infoType: 'mlauthorid', text: '101 Стругацкий Аркадий' },
      { infoType: 'mlabouttheauthor', text: 'Критик_Иван_' },
    ];
    doc.description.titleInfo.sequences = [{ name: '', children: [] }];

    const authorSeriesItems: MaximaAuthorSeriesItem[] = [
      {
        id: 301,
        name: 'Мир Полдня',
        authors: true,
        makers: true, // authors must outrank makers!
        url: 'https://maxima-library.com/index.php?option=com_maxlib&view=maxlibseries&id=301',
      },
      {
        id: 302,
        name: 'Полдень, XXII век',
        authors: false,
        makers: true,
        parent: { id: 301, name: 'Мир Полдня' },
        url: 'https://maxima-library.com/index.php?option=com_maxlib&view=maxlibseries&id=302',
      },
    ];

    const { searchCalls, existsCalls } = await mountDescription({
      enabled: true,
      document: doc,
      onSearch: (p) => {
        if (p.kind === 'authorSeries') {
          return { ok: true, page: 0, hasMore: false, items: authorSeriesItems };
        }
        return { ok: true, page: 0, hasMore: false, items: [] };
      },
      onExists: (p) => {
        if (
          p.kind === 'authorSeries' &&
          p.parentSeriesId === 301 &&
          p.seriesName === 'Полдень, XXII век'
        ) {
          return { ok: true, kind: 'authorSeries', matchedIds: [302] };
        }
        return { ok: true, kind: 'authorSeries', matchedIds: [] };
      },
    });

    // Focus empty Author Series input: shows local "Type to search..." on All with 0 network calls,
    // and only All + Authors' series tabs (aboutTheAuthor excluded from Makers!).
    const seqInput = screen.getByTestId('description-sequence-0-name');
    await act(async () => {
      fireEvent.focus(seqInput);
    });
    expect(searchCalls).toHaveLength(0);
    expect(screen.getByTestId('description-sequence-0-lookup-type-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('description-sequence-0-lookup-tab-all')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('description-sequence-0-lookup-tab-authors')).toBeInTheDocument();
    expect(screen.queryByTestId('description-sequence-0-lookup-tab-makers')).toBeNull();

    // Clicking Authors' series tab queries with empty seriesName and narrow: 'authors'.
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-sequence-0-lookup-tab-authors'));
    });
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]).toMatchObject({
      kind: 'authorSeries',
      seriesName: '',
      narrow: 'authors',
      authorIds: [101],
    });

    // Verify authors outranks makers on item 301, makers mark + subseries subtitle on item 302.
    expect(screen.getByTestId('description-sequence-0-lookup-item-301')).toHaveAttribute(
      'data-highlight',
      'authors',
    );
    const subItem = screen.getByTestId('description-sequence-0-lookup-item-302');
    expect(subItem).toHaveAttribute('data-highlight', 'makers');
    expect(subItem).toHaveTextContent('(subseries in Мир Полдня)');

    // Picking item 301 binds mlseriesid, resets tab on close, and moves focus to number input!
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-sequence-0-lookup-item-301'));
    });
    expect(screen.getByTestId('description-sequence-0-lookup-confirmed')).toHaveTextContent('#301');
    expect(document.activeElement).toBe(screen.getByTestId('description-sequence-0-number'));

    // Add nested child series: search sends excludedSeriesId: 301 and blur exists sends parentSeriesId: 301.
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-sequence-0-add-nested'));
    });
    vi.useFakeTimers();
    const childInput = screen.getByTestId('description-sequence-0-0-name');
    fireEvent.change(childInput, { target: { value: 'Полдень, XXII век' } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(searchCalls[1]).toMatchObject({
      kind: 'authorSeries',
      excludedSeriesId: 301,
    });
    await act(async () => {
      fireEvent.blur(childInput);
    });
    expect(existsCalls[0]).toEqual({
      kind: 'authorSeries',
      seriesName: 'Полдень, XXII век',
      parentSeriesId: 301,
    });
    expect(screen.getByTestId('description-sequence-0-0-lookup-confirmed')).toHaveTextContent(
      '#302',
    );
  });

  it('implements Publisher (400 ms, bookCount, advisory multi-match) and 2-tab Publisher Series parity (linked/nameMatch, publisher-prioritized blur exists)', async () => {
    const doc = fakeDocument();
    doc.description.publishInfo = { sequences: [{ name: '', children: [] }] };

    const publisherHomonyms: MaximaPublisherItem[] = [
      { id: 401, name: 'АСТ', bookCount: 1500, url: 'https://maxima-library.com/pub/401' },
      { id: 403, name: 'АСТ', bookCount: 42, url: 'https://maxima-library.com/pub/403' },
    ];
    const pubSeriesItems: MaximaPublisherSeriesItem[] = [
      {
        id: 501,
        name: 'Классика',
        publishers: [{ id: 401, name: 'АСТ' }],
        text: '',
        linked: true,
        nameMatch: false,
        url: 'https://maxima-library.com/ps/501',
      },
      {
        id: 502,
        name: 'Классика',
        publishers: [],
        text: 'АСТ (неофициально)',
        linked: false,
        nameMatch: true,
        url: 'https://maxima-library.com/ps/502',
      },
    ];

    const { store, searchCalls, existsCalls } = await mountDescription({
      enabled: true,
      document: doc,
      onSearch: (p) => {
        if (p.kind === 'publisher') {
          return { ok: true, page: 0, hasMore: false, items: publisherHomonyms };
        }
        if (p.kind === 'publisherSeries') {
          return { ok: true, page: 0, hasMore: false, items: pubSeriesItems };
        }
        return { ok: true, page: 0, hasMore: false, items: [] };
      },
      onExists: (p) => {
        if (p.kind === 'publisher') {
          return { ok: true, kind: 'publisher', items: publisherHomonyms };
        }
        if (p.kind === 'publisherSeries') {
          return { ok: true, kind: 'publisherSeries', items: pubSeriesItems };
        }
        return { ok: true, kind: 'person', matchedIds: [] };
      },
    });

    vi.useFakeTimers();

    // Publisher 400 ms debounce + bookCount.
    const pubInput = screen.getByTestId('description-publish-publisher');
    fireEvent.change(pubInput, { target: { value: 'АСТ' } });
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(searchCalls).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(searchCalls).toHaveLength(1);
    expect(screen.getByTestId('description-publish-publisher-lookup-item-401')).toHaveTextContent(
      'Books: 1500',
    );

    // Blur without picking -> multi-match advisory disambiguation prompt & unresolved badge.
    await act(async () => {
      fireEvent.blur(pubInput);
    });
    expect(
      screen.getByTestId('description-publish-publisher-lookup-unresolved'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('description-publish-publisher-lookup-disambiguation'),
    ).toBeInTheDocument();

    // Pick #401 -> confirmed in ephemeral session, zero <custom-info> added!
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-publish-publisher-lookup-item-401'));
    });
    expect(screen.getByTestId('description-publish-publisher-lookup-confirmed')).toHaveTextContent(
      '#401',
    );
    expect(store.getState().document!.description.customInfo).toHaveLength(0);

    // Publisher Series: empty-box focus shows All + By publisher tabs with 0 network calls.
    const psInput = screen.getByTestId('description-publish-sequence-0-name');
    await act(async () => {
      fireEvent.focus(psInput);
    });
    expect(searchCalls).toHaveLength(1);
    expect(
      screen.getByTestId('description-publish-sequence-0-lookup-type-prompt'),
    ).toBeInTheDocument();

    // Click By publisher -> sends restrict: true, publisherIds: [401], shows green linked & yellow nameMatch.
    await act(async () => {
      fireEvent.click(screen.getByTestId('description-publish-sequence-0-lookup-tab-publisher'));
    });
    expect(searchCalls[1]).toMatchObject({
      kind: 'publisherSeries',
      seriesName: '',
      restrict: true,
      publisherIds: [401],
      publisherNames: ['АСТ'],
    });
    expect(screen.getByTestId('description-publish-sequence-0-lookup-item-501')).toHaveAttribute(
      'data-highlight',
      'linked',
    );
    expect(screen.getByTestId('description-publish-sequence-0-lookup-item-502')).toHaveAttribute(
      'data-highlight',
      'nameMatch',
    );

    // Blur exact-match on "Классика" prioritizes the single linked match #501 over unlinked #502.
    fireEvent.change(psInput, { target: { value: 'Классика' } });
    await act(async () => {
      fireEvent.blur(psInput);
    });
    expect(existsCalls[existsCalls.length - 1]).toMatchObject({
      kind: 'publisherSeries',
      seriesName: 'Классика',
      publisherIds: [401],
    });
    expect(screen.getByTestId('description-publish-sequence-0-lookup-confirmed')).toHaveTextContent(
      '#501',
    );
    expect(store.getState().document!.description.customInfo).toHaveLength(0);
  });

  it('suppresses outbound calls during 429 Retry-After cooldown and displays a non-intrusive banner', async () => {
    let returnRateLimit = true;
    const { searchCalls } = await mountDescription({
      enabled: true,
      onSearch: () => {
        if (returnRateLimit) {
          return {
            ok: false,
            code: 'rate_limited',
            message: 'Too many requests',
            retryAfterSeconds: 3,
          };
        }
        return {
          ok: true,
          page: 0,
          hasMore: false,
          items: [
            {
              id: 101,
              lastName: 'Толстой',
              firstName: 'Лев',
              middleName: '',
              fullName: 'Толстой Лев',
              url: 'https://maxima-library.com/p/101',
            },
          ],
        };
      },
    });

    vi.useFakeTimers();
    const lastInput = screen.getByTestId('description-author-0-last');
    fireEvent.change(lastInput, { target: { value: 'Тол' } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(searchCalls).toHaveLength(1);
    const banner = screen.getByTestId('description-maxima-banner');
    expect(banner).toHaveAttribute('data-code', 'rate_limited');
    expect(within(banner).getByTestId('description-maxima-banner-retry')).toBeDisabled();

    // Typing again during 3 s cooldown must send ZERO outbound requests.
    fireEvent.change(lastInput, { target: { value: 'Толс' } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(searchCalls).toHaveLength(1);

    // After cooldown expires, Retry enables and lookup resumes cleanly.
    returnRateLimit = false;
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(within(banner).getByTestId('description-maxima-banner-retry')).toBeEnabled();
    await act(async () => {
      fireEvent.click(within(banner).getByTestId('description-maxima-banner-retry'));
    });
    expect(searchCalls).toHaveLength(2);
    expect(screen.queryByTestId('description-maxima-banner')).toBeNull();
  });
});
