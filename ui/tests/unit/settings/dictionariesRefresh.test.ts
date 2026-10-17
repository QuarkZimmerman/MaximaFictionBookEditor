/**
 * Feature 003 US4 (T048): applied settings refresh the dictionaries - the settings runtime
 * asks the spell feature for `spell.dictionaryReport` after every successful `settings.set` of
 * the dialog's sections (so a pair copied into a folder is used without a restart), but not
 * for the initial load, for session-only changes (toolbar flags) or without a client.
 */

import { HotkeyMap } from '@/app/hotkeys';
import { SettingsFeature } from '@/features/settings/apply';
import { getSpellFeature } from '@/features/spell';
import { actions, createAppStore } from '@/model/store';
import type { SpellDictionaryReport } from '@/rpc/types';

import { fakeRpc } from '../features/testUtils';

import { defaultSettings, mergeSettings } from './fixtures';

const REPORT: SpellDictionaryReport = {
  dictionaries: [
    { tag: 'en_US', lang: 'en', name: 'en_US', source: 'bundled' },
    { tag: 'de_DE', lang: 'de', name: 'de_DE', source: 'user' },
  ],
  rejected: [],
  folders: [],
};

function setup() {
  let current = defaultSettings();
  const rpc = fakeRpc({
    'hotkeys.get': [],
    'spell.dictionaries': REPORT.dictionaries,
    'spell.dictionaryReport': REPORT,
    'settings.set': (params: unknown) => {
      current = mergeSettings(current, (params as { patch: unknown }).patch);
      return { settings: current, restartRequired: false };
    },
  });
  const store = createAppStore();
  const feature = new SettingsFeature(
    { store, hotkeys: new HotkeyMap('linux') },
    { root: null, window: null, search: '' },
  );
  feature.install();
  const reportCalls = () =>
    rpc.calls.filter((call) => call.method === 'spell.dictionaryReport').length;
  return { rpc, store, feature, reportCalls, current: () => current };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('settings runtime - dictionaries refreshed after Apply', () => {
  it('re-reads the report after a change of the dialog sections, not on the initial load', async () => {
    const { rpc, store, feature, reportCalls } = setup();
    await feature.attach(rpc.client);
    // The initial settings (settings.get at start-up): no refresh.
    actions.setSettings(store, defaultSettings());
    await settle();
    expect(reportCalls()).toBe(0);

    // Settings applied (the dialog's settings.set, then actions.setSettings): one refresh,
    // whatever the changed key - files may have been copied into a folder before Apply.
    const changed = defaultSettings();
    changed.view.spellHighlight = false;
    actions.setSettings(store, changed);
    await settle();
    expect(reportCalls()).toBe(1);
    expect(getSpellFeature(store).checker.report).toEqual(REPORT);

    // The dictionaries folder changed: refreshed too.
    const moved = defaultSettings();
    moved.view.spellHighlight = false;
    moved.other.dictionariesFolder = '/home/me/dicts';
    actions.setSettings(store, moved);
    await settle();
    expect(reportCalls()).toBe(2);
  });

  it('ignores session-only changes and an identical settings object', async () => {
    const { rpc, store, feature, reportCalls } = setup();
    await feature.attach(rpc.client);
    actions.setSettings(store, defaultSettings());
    await settle();
    const sessionOnly = defaultSettings();
    sessionOnly.session.treeVisible = !sessionOnly.session.treeVisible;
    actions.setSettings(store, sessionOnly);
    await settle();
    expect(reportCalls()).toBe(0);
    actions.setSettings(store, defaultSettings());
    await settle();
    expect(reportCalls()).toBe(0);
  });

  it('does nothing before the runtime is attached to a client', async () => {
    const { store, reportCalls } = setup();
    actions.setSettings(store, defaultSettings());
    const changed = defaultSettings();
    changed.view.spellEnabled = false;
    actions.setSettings(store, changed);
    await settle();
    expect(reportCalls()).toBe(0);
  });
});
