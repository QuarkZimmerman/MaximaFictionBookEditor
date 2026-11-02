/**
 * Feature 008, T043 (FR-030 to FR-035, data-model §5): the dictionaries in use are the base - the
 * book's language when a dictionary serves it, else the interface language's - followed by the
 * extra dictionaries of Settings (English and Russian by default), deduplicated in that order.
 */
import { describe, expect, it, vi } from 'vitest';

import { SpellChecker } from '@/features/spell/checker';
import { SpellSession } from '@/features/spell/session';
import { actions, createAppStore } from '@/model/store';
import type { SpellDictionaryReport } from '@/rpc/types';

import { fakeDocument, fakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

function dictionary(tag: string) {
  return {
    tag,
    lang: tag.split('_')[0]!,
    name: tag,
    path: `/dicts/${tag}.aff`,
    dicPath: `/dicts/${tag}.dic`,
    source: 'bundled',
  };
}

function report(tags: string[]): SpellDictionaryReport {
  return { dictionaries: tags.map(dictionary), rejected: [], folders: [] };
}

async function setup(options: {
  lang: string;
  uiLanguage?: 'system' | 'en' | 'ru' | 'uk';
  extras?: string[];
  installed?: string[];
}) {
  const rpc = fakeRpc({
    'spell.dictionaryReport': () => report(options.installed ?? ['en_US', 'ru_RU', 'uk_UA']),
    'spell.check': { misspelled: [] },
  });
  const store = createAppStore();
  actions.setConnection(store, 'connected');
  const base = defaultSettings();
  actions.setSettings(store, {
    ...base,
    view: {
      ...base.view,
      uiLanguage: options.uiLanguage ?? 'en',
      spellExtraDictionaries: options.extras ?? base.view.spellExtraDictionaries,
    },
  });
  const doc = fakeDocument();
  doc.description.titleInfo.lang = options.lang;
  actions.setDocument(store, doc);
  const onUnavailable = vi.fn();
  const session = new SpellSession();
  const checker = new SpellChecker({ store, session, getRpc: () => rpc.client, onUnavailable });
  await checker.refreshDictionaries();
  return { checker, onUnavailable, session, store };
}

describe('the dictionaries in use (FR-030 to FR-035)', () => {
  it('a Russian book uses Russian, then English; Russian is not listed twice', async () => {
    const { checker } = await setup({ lang: 'ru' });
    expect(checker.activeLangs()).toEqual(['ru_RU', 'en_US']);
  });

  it('a Ukrainian book uses Ukrainian, then English and Russian', async () => {
    const { checker } = await setup({ lang: 'uk' });
    expect(checker.activeLangs()).toEqual(['uk_UA', 'en_US', 'ru_RU']);
  });

  it("a book without a language uses the interface language's dictionary", async () => {
    const { checker } = await setup({ lang: '', uiLanguage: 'ru', extras: [] });
    expect(checker.activeLangs()).toEqual(['ru_RU']);
  });

  it("a language without a dictionary falls back to the interface's, noticed once", async () => {
    const { checker, onUnavailable } = await setup({ lang: 'de', uiLanguage: 'en' });
    expect(checker.activeLangs()).toEqual(['en_US', 'ru_RU']);
    checker.activeLangs();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith('de');
  });

  it('unticking English leaves the base alone; an extra that is not installed is skipped', async () => {
    expect((await setup({ lang: 'ru', extras: ['ru_RU'] })).checker.activeLangs()).toEqual([
      'ru_RU',
    ]);
    expect((await setup({ lang: 'ru', extras: ['pl_PL'] })).checker.activeLangs()).toEqual([
      'ru_RU',
    ]);
  });

  it("the Spelling dialog's choice for the session replaces the set", async () => {
    const { checker, session } = await setup({ lang: 'ru' });
    session.setLanguageOverride(['en_US']);
    expect(checker.activeLangs()).toEqual(['en_US']);
  });
});
