/**
 * Settings runtime (T133): Body CSS variables, the `settings.set` patch diff, the session
 * persistence of toolbar / tree flags (the window placement is the shell's since feature 003
 * US3: the UI writes nothing to `session.windowGeometry`), the hotkeys load/save tolerance,
 * and the FBE defaults table of `app/defaultHotkeys.ts` against the engine defaults.
 */

import { createBuiltinCommands } from '@/app/commands';
import { FBE_DEFAULT_HOTKEYS, diffDefaultTables, fbeBoundDefaults } from '@/app/defaultHotkeys';
import { HotkeyMap } from '@/app/hotkeys';
import {
  SettingsFeature,
  applyBodyCssVariables,
  bodyCssVariables,
  loadUserHotkeys,
  normalizeHotkeyBindings,
  quoteFontFamily,
  saveUserHotkeys,
  settingsPatch,
} from '@/features/settings/apply';
import { actions, createAppStore } from '@/model/store';

import { fakeRpc, rpcError } from '../features/testUtils';

import { defaultSettings, mergeSettings } from './fixtures';

describe('Body CSS variables', () => {
  it('maps the View > Body settings onto the layout.css variables', () => {
    const settings = defaultSettings();
    settings.view.bodyFont = 'Noto Serif, serif';
    settings.view.bodyFontSize = 18;
    settings.view.bodyTextColor = '#102030';
    settings.view.bodyBackground = '#fafafa';
    expect(bodyCssVariables(settings)).toEqual({
      '--mfbe-body-font-family': "'Noto Serif', serif",
      '--mfbe-body-font-size': '18px',
      '--mfbe-body-fg': '#102030',
      '--mfbe-body-bg': '#fafafa',
    });
    // Empty font / invalid colour: the stylesheet defaults stay (variable removed).
    settings.view.bodyFont = '';
    settings.view.bodyTextColor = 'red';
    const root = document.createElement('div');
    root.style.setProperty('--mfbe-body-font-family', 'Arial');
    applyBodyCssVariables(settings, root);
    expect(root.style.getPropertyValue('--mfbe-body-font-family')).toBe('');
    expect(root.style.getPropertyValue('--mfbe-body-fg')).toBe('');
    expect(root.style.getPropertyValue('--mfbe-body-bg')).toBe('#fafafa');
    applyBodyCssVariables(null, root);
    expect(root.style.getPropertyValue('--mfbe-body-bg')).toBe('');
  });

  it('quotes families with spaces and keeps generic names', () => {
    expect(quoteFontFamily('Georgia')).toBe('Georgia');
    expect(quoteFontFamily('Times New Roman, serif')).toBe("'Times New Roman', serif");
    expect(quoteFontFamily("'Already quoted', sans-serif")).toBe("'Already quoted', sans-serif");
  });
});

describe('settingsPatch', () => {
  it('contains only the changed leaves of view / other / words', () => {
    const before = defaultSettings();
    const after = defaultSettings();
    after.view.bodyFontSize = 20;
    after.other.jpegQuality = 50;
    after.other.keepEncoding = true;
    after.session.treeVisible = false; // never part of the dialog patch
    expect(settingsPatch(before, after)).toEqual({
      view: { bodyFontSize: 20 },
      other: { jpegQuality: 50, keepEncoding: true },
    });
    expect(settingsPatch(before, defaultSettings())).toEqual({});
  });
});

describe('SettingsFeature session persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes toolbar / tree changes to session.* (debounced) and nothing when unchanged', async () => {
    let current = defaultSettings();
    const rpc = fakeRpc({
      'hotkeys.get': rpcError(-32601, 'Method not found'),
      'settings.set': (params: unknown) => {
        current = mergeSettings(current, (params as { patch: unknown }).patch);
        return { settings: current, restartRequired: false };
      },
    });
    const store = createAppStore();
    const hotkeys = new HotkeyMap('linux');
    const feature = new SettingsFeature(
      { store, hotkeys },
      { root: null, window: null, search: '' },
    );
    feature.install();
    actions.setSettings(store, current);
    await feature.attach(rpc.client);
    expect(feature.hotkeysLoaded).toBe(true);
    expect(feature.hotkeysPersisted).toBe(false); // the core has no hotkeys store

    actions.toggleToolbar(store, 'links');
    actions.toggleTree(store);
    await vi.advanceTimersByTimeAsync(300);
    const calls = rpc.calls.filter((c) => c.method === 'settings.set');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual({
      patch: {
        session: {
          toolbars: { commands: true, scripts: true, links: false, table: true, status: true },
          treeVisible: false,
        },
      },
    });
    expect(store.getState().settings?.session.treeVisible).toBe(false);

    // The same flags again (e.g. from a settings.changed notification): no second write.
    actions.setSettings(store, current);
    await vi.advanceTimersByTimeAsync(300);
    expect(rpc.calls.filter((c) => c.method === 'settings.set')).toHaveLength(1);
  });

  it('saves a hidden status bar although the core reports the settings before the delayed save', async () => {
    let current = defaultSettings();
    const rpc = fakeRpc({
      'hotkeys.get': rpcError(-32601, 'Method not found'),
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
    actions.setSettings(store, current);
    await feature.attach(rpc.client);

    // View > Status Bar; before the delayed save goes out, the core reports the settings
    // (settings.changed after another settings.set - the start-up version check recording its
    // time, say) with the status bar still shown, as it is in its store at that moment.
    actions.toggleToolbar(store, 'status');
    expect(store.getState().toolbars.status).toBe(false);
    const reported = mergeSettings(current, {
      session: { lastVersionCheck: '2026-10-17T12:00:00.000Z' },
    });
    actions.setSettings(store, reported);
    expect(store.getState().toolbars.status).toBe(false);
    expect(store.getState().settings?.session.lastVersionCheck).toBe('2026-10-17T12:00:00.000Z');

    await vi.advanceTimersByTimeAsync(300);
    const calls = rpc.calls.filter((c) => c.method === 'settings.set');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual({
      patch: {
        session: {
          toolbars: { commands: true, scripts: true, links: true, table: true, status: false },
        },
      },
    });
    expect(current.session.toolbars.status).toBe(false);
    expect(store.getState().toolbars.status).toBe(false);
    expect(store.getState().settings?.session.toolbars.status).toBe(false);
  });

  it('leaves the window placement to the shell: a resize writes nothing (feature 003 US3)', async () => {
    let current = defaultSettings();
    const rpc = fakeRpc({
      'hotkeys.get': [],
      'settings.set': (params: unknown) => {
        current = mergeSettings(current, (params as { patch: unknown }).patch);
        return { settings: current, restartRequired: false };
      },
    });
    const store = createAppStore();
    const listeners = new Map<string, () => void>();
    const fakeWindow = {
      screenX: 10,
      screenY: 20,
      outerWidth: 1200,
      outerHeight: 800,
      location: { search: '' },
      addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name),
    } as unknown as Window;
    const feature = new SettingsFeature(
      { store, hotkeys: new HotkeyMap('linux') },
      { root: null, window: fakeWindow, search: '' },
    );
    const uninstall = feature.install();
    actions.setSettings(store, current);
    await feature.attach(rpc.client);
    // No resize listener is installed any more; a resize of the page changes no setting.
    expect(listeners.has('resize')).toBe(false);
    listeners.get('resize')?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rpc.calls.filter((c) => c.method === 'settings.set')).toEqual([]);
    expect(store.getState().settings?.session.windowGeometry).toBeNull();
    uninstall();
  });

  it('switches the interface language when uiLanguage changes at run time (no ?lang= override)', async () => {
    const store = createAppStore();
    const feature = new SettingsFeature(
      { store, hotkeys: new HotkeyMap('linux') },
      { root: null, window: null, search: '' },
    );
    feature.install();
    const settings = defaultSettings();
    actions.setSettings(store, settings);
    actions.setSettings(store, { ...settings, view: { ...settings.view, uiLanguage: 'ru' } });
    expect(store.getState().uiLanguage).toBe('ru');

    const forced = new SettingsFeature(
      { store, hotkeys: new HotkeyMap('linux') },
      { root: null, window: null, search: '?lang=en' },
    );
    forced.install();
    actions.setUiLanguage(store, 'en');
    actions.setSettings(store, { ...settings, view: { ...settings.view, uiLanguage: 'en' } });
    actions.setSettings(store, { ...settings, view: { ...settings.view, uiLanguage: 'ru' } });
    // Two features are installed on this store; the forced one must not fight, the first one
    // still applies the setting.
    expect(store.getState().uiLanguage).toBe('ru');
  });
});

describe('hotkeys persistence helpers', () => {
  it('accepts both binding shapes and tolerates a core without hotkeys.*', async () => {
    expect(
      normalizeHotkeyBindings([
        { commandId: 'edit.undo', keys: 'Ctrl+Shift+Z' },
        { command: 'edit.redo', keys: '' },
        { bogus: true },
        'x',
      ]),
    ).toEqual([
      { commandId: 'edit.undo', keys: 'Ctrl+Shift+Z' },
      { commandId: 'edit.redo', keys: '' },
    ]);
    const hotkeys = new HotkeyMap('linux');
    const withStore = fakeRpc({
      'hotkeys.get': [{ commandId: 'edit.undo', keys: 'Ctrl+Shift+Z', source: 'user' }],
      'hotkeys.set': { collisions: [] },
    });
    expect(await loadUserHotkeys(withStore.client, hotkeys)).toBe(true);
    expect(hotkeys.get('edit.undo')).toBe('Ctrl+Shift+Z');
    expect(await saveUserHotkeys(withStore.client, hotkeys)).toBe(true);
    const without = fakeRpc({});
    expect(await loadUserHotkeys(without.client, hotkeys)).toBe(false);
    expect(await saveUserHotkeys(without.client, hotkeys)).toBe(false);
    expect(hotkeys.get('edit.undo')).toBe('Ctrl+Shift+Z'); // a failed load keeps the bindings
  });
});

describe('FBE defaults table (app/defaultHotkeys.ts)', () => {
  it('refers only to registered command ids', () => {
    const ids = new Set(createBuiltinCommands().map((c) => c.id));
    for (const entry of FBE_DEFAULT_HOTKEYS) {
      expect(ids.has(entry.commandId), entry.commandId).toBe(true);
    }
    expect(fbeBoundDefaults().every((entry) => entry.keys !== '')).toBe(true);
  });

  it('differs from the engine defaults only in the documented chords', () => {
    // FBE binds Alt+VK_OEM_1 / Ctrl+VK_OEM_1 (the ';' key without Shift) to the tag navigation.
    const expected = [
      { commandId: 'edit.gotoMatchTag', fbe: 'Alt+;', engine: 'Alt+Shift+;' },
      { commandId: 'edit.gotoWrongTag', fbe: 'Ctrl+;', engine: 'Ctrl+Shift+;' },
    ];
    expect(diffDefaultTables('linux')).toEqual(expected);
    expect(diffDefaultTables('windows')).toEqual(expected);
    expect(diffDefaultTables('mac')).toEqual([
      { commandId: 'edit.gotoMatchTag', fbe: 'Alt+;', engine: 'Alt+Shift+;' },
      { commandId: 'edit.gotoWrongTag', fbe: 'Meta+;', engine: 'Shift+Meta+;' },
    ]);
  });

  it('builds a working HotkeyMap', () => {
    const map = new HotkeyMap('linux', { defaults: fbeBoundDefaults() });
    expect(map.get('file.save')).toBe('F2');
    expect(map.get('edit.removeOuter')).toBe('Ctrl+Alt+Space');
    expect(map.get('scripts.last')).toBe('Ctrl+`');
    expect(map.collisions()).toEqual([]);
  });
});
