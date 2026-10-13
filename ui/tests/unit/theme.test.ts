/**
 * Interface theme (Settings > View > Theme): `resolveTheme` matrix, `applyTheme` writing
 * `data-theme` / `color-scheme` on the root, following a (mocked) `prefers-color-scheme` change
 * while the setting is "system" and not otherwise, the `localStorage` mirror, the subscribers,
 * the settings runtime mapping (`themeSettingOf`, default Body colours mean "theme colours") and
 * the CodeMirror theme of the Source editor.
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  THEME_STORAGE_KEY,
  applyStoredTheme,
  applyTheme,
  currentTheme,
  currentThemeSetting,
  isThemeSetting,
  resolveTheme,
  storedThemeSetting,
  subscribeTheme,
  systemPrefersDark,
} from '@/app/theme';
import { bodyCssVariables, isDefaultBodyColor, themeSettingOf } from '@/features/settings/apply';
import { createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { SourceEditorController } from '@/views/source/sourceEditor';
import { sourceHighlightExtension, sourceThemeExtension } from '@/views/source/theme';

import { defaultSettings } from './settings/fixtures';

/** A controllable `matchMedia` for `(prefers-color-scheme: dark)`. */
function fakeMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
  } as unknown as MediaQueryList & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  return {
    query,
    matchMedia: vi.fn(() => query),
    /** Simulates the OS switching its preference. */
    setDark(dark: boolean) {
      matches = dark;
      for (const listener of [...listeners]) {
        listener({ matches: dark, media: query.media } as MediaQueryListEvent);
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  };
}

describe('resolveTheme', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
  ] as const)('%s with systemDark=%s -> %s', (setting, systemDark, expected) => {
    expect(resolveTheme(setting, systemDark)).toBe(expected);
  });

  it('treats unknown or missing settings as "system"', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme('sepia' as never, true)).toBe('dark');
    expect(isThemeSetting('dark')).toBe(true);
    expect(isThemeSetting('sepia')).toBe(false);
    expect(isThemeSetting(undefined)).toBe(false);
  });

  it('asks matchMedia for the OS preference and assumes light without it', () => {
    expect(systemPrefersDark(null)).toBe(false);
    expect(systemPrefersDark(fakeMatchMedia(true).matchMedia)).toBe(true);
    expect(systemPrefersDark(fakeMatchMedia(false).matchMedia)).toBe(false);
    expect(
      systemPrefersDark(() => {
        throw new Error('no media queries');
      }),
    ).toBe(false);
  });
});

describe('applyTheme', () => {
  afterEach(() => {
    // Leave the module in the state the other test files expect.
    applyTheme('light', { root: null, matchMedia: null, storage: null });
  });

  it('writes data-theme and color-scheme on the root and mirrors the setting', () => {
    const root = document.createElement('div');
    const storage = fakeStorage();
    const media = fakeMatchMedia(false);
    expect(applyTheme('dark', { root, matchMedia: media.matchMedia, storage })).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(currentThemeSetting()).toBe('dark');
    // An explicit setting does not follow the OS.
    expect(media.listenerCount).toBe(0);

    expect(applyTheme('light', { root, matchMedia: media.matchMedia, storage })).toBe('light');
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows prefers-color-scheme changes while the setting is "system" only', () => {
    const root = document.createElement('div');
    const media = fakeMatchMedia(true);
    const seen: string[] = [];
    const off = subscribeTheme((theme) => seen.push(theme));

    expect(applyTheme('system', { root, matchMedia: media.matchMedia, storage: null })).toBe(
      'dark',
    );
    expect(root.dataset.theme).toBe('dark');
    expect(media.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(media.listenerCount).toBe(1);

    media.setDark(false);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(currentTheme()).toBe('light');
    media.setDark(true);
    expect(root.dataset.theme).toBe('dark');
    expect(seen).toEqual(['dark', 'light', 'dark']);

    // Forcing light detaches the listener: a later OS switch changes nothing.
    applyTheme('light', { root, matchMedia: media.matchMedia, storage: null });
    expect(media.listenerCount).toBe(0);
    media.setDark(false);
    media.setDark(true);
    expect(root.dataset.theme).toBe('light');
    expect(seen).toEqual(['dark', 'light', 'dark', 'light']);

    off();
    applyTheme('dark', { root, matchMedia: media.matchMedia, storage: null });
    expect(seen).toHaveLength(4); // unsubscribed
  });

  it('re-applying the same setting is idempotent and keeps a single OS listener', () => {
    const root = document.createElement('div');
    const media = fakeMatchMedia(false);
    const listener = vi.fn();
    const off = subscribeTheme(listener);
    applyTheme('system', { root, matchMedia: media.matchMedia, storage: null });
    applyTheme('system', { root, matchMedia: media.matchMedia, storage: null });
    applyTheme('system', { root, matchMedia: media.matchMedia, storage: null });
    expect(media.listenerCount).toBe(1);
    expect(root.dataset.theme).toBe('light');
    expect(listener).not.toHaveBeenCalled(); // light -> light: nothing changed
    off();
  });

  it('reads the mirrored setting of the previous session (defaulting to system)', () => {
    expect(storedThemeSetting(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(storedThemeSetting(fakeStorage({ [THEME_STORAGE_KEY]: 'bogus' }))).toBe('system');
    expect(storedThemeSetting(fakeStorage())).toBe('system');
    expect(storedThemeSetting(null)).toBe('system');

    const root = document.createElement('div');
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' });
    expect(applyStoredTheme({ root, matchMedia: null, storage })).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    // Nothing stored and no media queries: light.
    expect(applyStoredTheme({ root, matchMedia: null, storage: fakeStorage() })).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });

  it('survives a storage that throws (privacy mode) and a missing root', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(storedThemeSetting(broken)).toBe('system');
    expect(applyTheme('dark', { root: null, matchMedia: null, storage: broken })).toBe('dark');
    expect(currentTheme()).toBe('dark');
  });
});

describe('settings runtime and theme', () => {
  it('maps view.theme, falls back to system for an older core and to the mirror without settings', () => {
    const settings = defaultSettings();
    settings.view.theme = 'dark';
    expect(themeSettingOf(settings)).toBe('dark');
    settings.view.theme = 'light';
    expect(themeSettingOf(settings)).toBe('light');
    delete (settings.view as { theme?: unknown }).theme;
    expect(themeSettingOf(settings)).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    try {
      expect(themeSettingOf(null)).toBe('dark');
    } finally {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
    expect(themeSettingOf(null)).toBe('system');
  });

  it('writes the Body colours only when they differ from black on white', () => {
    const settings = defaultSettings(); // #000000 / #ffffff
    expect(bodyCssVariables(settings)['--mfbe-body-fg']).toBeNull();
    expect(bodyCssVariables(settings)['--mfbe-body-bg']).toBeNull();
    settings.view.bodyTextColor = '#FFFFFF';
    settings.view.bodyBackground = '#000000';
    expect(bodyCssVariables(settings)['--mfbe-body-fg']).toBe('#FFFFFF');
    expect(bodyCssVariables(settings)['--mfbe-body-bg']).toBe('#000000');
    settings.view.bodyTextColor = ' #000000 ';
    settings.view.bodyBackground = '#FfFfFf';
    expect(bodyCssVariables(settings)['--mfbe-body-fg']).toBeNull();
    expect(bodyCssVariables(settings)['--mfbe-body-bg']).toBeNull();
    expect(isDefaultBodyColor('#000000', '#000000')).toBe(true);
    expect(isDefaultBodyColor('#010101', '#000000')).toBe(false);
  });
});

describe('Source editor theme', () => {
  it('builds a light and a dark CodeMirror theme and highlight style', () => {
    const light = EditorState.create({ extensions: sourceThemeExtension(false) });
    const dark = EditorState.create({ extensions: sourceThemeExtension(true) });
    expect(light.facet(EditorView.darkTheme)).toBe(false);
    expect(dark.facet(EditorView.darkTheme)).toBe(true);
    expect(sourceHighlightExtension(false, true)).toEqual([]);
    expect(sourceHighlightExtension(true, true)).not.toEqual([]);
    expect(sourceHighlightExtension(true, false)).not.toEqual([]);
  });

  it('switches the editor theme live through setDark (mounted and headless)', () => {
    const store = createAppStore();
    const controller = new SourceEditorController({ store, undo: new UndoCoordinator() });
    expect(controller.isDark).toBe(false);
    expect(controller.state.facet(EditorView.darkTheme)).toBe(false);
    controller.setDark(true);
    expect(controller.isDark).toBe(true);
    expect(controller.state.facet(EditorView.darkTheme)).toBe(true);

    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      controller.mount(host);
      const editor = host.querySelector<HTMLElement>('.cm-editor')!;
      expect(controller.editorView!.state.facet(EditorView.darkTheme)).toBe(true);
      // The base theme classes (generated names) differ between dark and light.
      const darkClasses = editor.className;
      controller.setDark(false);
      expect(controller.editorView!.state.facet(EditorView.darkTheme)).toBe(false);
      expect(editor.className).not.toBe(darkClasses);
      controller.setDark(false); // no-op
      expect(controller.state.facet(EditorView.darkTheme)).toBe(false);
    } finally {
      controller.destroy();
      host.remove();
    }
  });
});
