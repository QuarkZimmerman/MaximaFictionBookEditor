/**
 * Feature 003 US4 (T043/T048): the dictionary report on the UI side - `SpellChecker`
 * re-reads `spell.dictionaryReport`, resolves tags against the dictionaries in effect (`de-AT`
 * -> `de_DE` by language), forgets its cached verdicts when the set of dictionaries changed and
 * keeps them otherwise, tells `report` listeners, shares one request between concurrent calls
 * and tolerates a core without the method.
 */

import { SpellChecker, dictionarySignature, resolveDictionaryTag } from '@/features/spell/checker';
import { SpellSession } from '@/features/spell/session';
import { actions, createAppStore } from '@/model/store';
import type { SpellDictionaryReport } from '@/rpc/types';

import { fakeDocument, fakeRpc, rpcError } from '../features/testUtils';

function dictionary(tag: string, source: string, folder = '/dicts') {
  return {
    tag,
    lang: tag.split('_')[0]!,
    name: tag,
    path: `${folder}/${tag}.aff`,
    dicPath: `${folder}/${tag}.dic`,
    source,
  };
}

function report(
  dictionaries: SpellDictionaryReport['dictionaries'],
  rejected: SpellDictionaryReport['rejected'] = [],
): SpellDictionaryReport {
  return {
    dictionaries,
    rejected,
    folders: [
      { layer: 'settings', path: '', exists: false, readable: false, writable: false },
      { layer: 'user', path: '/data/dictionaries', exists: true, readable: true, writable: true },
      { layer: 'portable', path: '', exists: false, readable: false, writable: false },
      {
        layer: 'bundled',
        path: '/res/dictionaries',
        exists: true,
        readable: true,
        writable: false,
      },
    ],
  };
}

const BUNDLED = [dictionary('en_US', 'bundled'), dictionary('ru_RU', 'bundled')];

function setup(initial: SpellDictionaryReport | Error) {
  let current = initial;
  const rpc = fakeRpc({
    'spell.dictionaryReport': () => current,
    'spell.check': (params: unknown) => {
      const { words } = params as { words: string[] };
      return { misspelled: words.filter((word) => word.endsWith('x')) };
    },
  });
  const store = createAppStore();
  actions.setConnection(store, 'connected');
  const doc = fakeDocument();
  doc.description.titleInfo.lang = 'de-AT';
  actions.setDocument(store, doc);
  const checker = new SpellChecker({
    store,
    session: new SpellSession(),
    getRpc: () => rpc.client,
  });
  const events: string[] = [];
  checker.subscribe((event) => events.push(event));
  return {
    rpc,
    checker,
    events,
    setReport: (next: SpellDictionaryReport | Error) => {
      current = next;
    },
    reportCalls: () => rpc.calls.filter((call) => call.method === 'spell.dictionaryReport').length,
  };
}

describe('resolveDictionaryTag - exact tag first, then the language', () => {
  const list = [...BUNDLED, dictionary('de_DE', 'user'), dictionary('de_AT', 'user')];
  it('prefers the exact tag and falls back to the language', () => {
    expect(resolveDictionaryTag('de_AT', list)).toBe('de_AT');
    expect(resolveDictionaryTag('de-at', list)).toBe('de_AT');
    expect(resolveDictionaryTag('de-CH', list)).toBe('de_DE');
    expect(resolveDictionaryTag('de', list)).toBe('de_DE');
    expect(resolveDictionaryTag('ru', list)).toBe('ru_RU');
    expect(resolveDictionaryTag('pl', list)).toBeNull();
  });

  it('signs the set by tag, files and origin', () => {
    expect(dictionarySignature(BUNDLED)).toBe(dictionarySignature([...BUNDLED]));
    expect(dictionarySignature(BUNDLED)).not.toBe(
      dictionarySignature([...BUNDLED, dictionary('de_DE', 'user')]),
    );
    expect(dictionarySignature([dictionary('de_DE', 'user')])).not.toBe(
      dictionarySignature([dictionary('de_DE', 'settings', '/chosen')]),
    );
  });
});

describe('SpellChecker.refreshDictionaries', () => {
  it('loads the report, resolves the document language against it and tells listeners', async () => {
    const { checker, events } = setup(report([...BUNDLED, dictionary('de_DE', 'user')]));
    expect(checker.report).toBeNull();
    const result = await checker.refreshDictionaries();
    expect(result?.dictionaries.map((d) => d.tag)).toEqual(['en_US', 'ru_RU', 'de_DE']);
    expect(checker.report).toBe(result);
    expect(checker.dictionaries?.map((d) => d.tag)).toEqual(['en_US', 'ru_RU', 'de_DE']);
    // The de-AT document uses de_DE by language.
    expect(checker.activeLangs()).toEqual(['de_DE']);
    expect(events).toEqual(['invalidate', 'report']);
  });

  it('forgets cached verdicts when the set of dictionaries changed, keeps them otherwise', async () => {
    const harness = setup(report(BUNDLED));
    const { checker, events, rpc } = harness;
    await checker.refreshDictionaries();
    // No German dictionary yet: de-AT resolves to itself, verdicts are cached per word.
    expect(checker.activeLangs()).toEqual(['de-AT']);
    await checker.check(['Haus', 'Hausx']);
    expect(checker.lookup('Haus')).toBe(false);
    expect(checker.lookup('Hausx')).toBe(true);
    events.length = 0;

    // The same report again (Apply without a dictionary change): nothing is forgotten.
    await checker.refreshDictionaries();
    expect(events).toEqual(['report']);
    expect(checker.lookup('Haus')).toBe(false);
    expect(checker.lookup('Hausx')).toBe(true);

    // A German pair copied into the folder: the languages now resolve to de_DE and every
    // verdict is re-evaluated (the cache key changed with the languages; the old entries and
    // the suggestions are dropped too).
    harness.setReport(report([...BUNDLED, dictionary('de_DE', 'user')]));
    await checker.refreshDictionaries();
    expect(events).toEqual(['report', 'invalidate', 'report']);
    expect(checker.activeLangs()).toEqual(['de_DE']);
    expect(checker.lookup('Haus')).toBeUndefined();
    const checks = rpc.calls.filter((call) => call.method === 'spell.check');
    await checker.check(['Haus']);
    expect(rpc.calls.filter((call) => call.method === 'spell.check').length).toBe(
      checks.length + 1,
    );
    expect(rpc.calls[rpc.calls.length - 1]!.params).toEqual({ words: ['Haus'], langs: ['de_DE'] });
  });

  it('shares one request between concurrent calls', async () => {
    const harness = setup(report(BUNDLED));
    const [a, b] = await Promise.all([
      harness.checker.refreshDictionaries(),
      harness.checker.refreshDictionaries(),
    ]);
    expect(a).toBe(b);
    expect(harness.reportCalls()).toBe(1);
    await harness.checker.refreshDictionaries();
    expect(harness.reportCalls()).toBe(2);
  });

  it('resolves with null and keeps the previous report when the core has no such method', async () => {
    const harness = setup(report(BUNDLED));
    await harness.checker.refreshDictionaries();
    harness.setReport(rpcError(-32601, 'Method not found: spell.dictionaryReport'));
    expect(await harness.checker.refreshDictionaries()).toBeNull();
    expect(harness.checker.report?.dictionaries.map((d) => d.tag)).toEqual(['en_US', 'ru_RU']);
    expect(harness.checker.dictionaries?.length).toBe(2);
  });

  it('resolves with null without a client', async () => {
    const store = createAppStore();
    const checker = new SpellChecker({ store, session: new SpellSession(), getRpc: () => null });
    expect(await checker.refreshDictionaries()).toBeNull();
    expect(checker.report).toBeNull();
  });
});
