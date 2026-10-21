/** Shared fixtures of the Settings tests: the default settings of resource-formats.md §6. */

import type { Settings } from '@/rpc/types';

export function defaultSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    schemaVersion: 1,
    view: {
      uiLanguage: 'system',
      theme: 'system',
      bodyFont: '',
      bodyFontSize: 14,
      bodyTextColor: '#000000',
      bodyBackground: '#ffffff',
      sourceFont: '',
      sourceWrap: true,
      sourceSyntaxHighlight: true,
      sourceShowEol: false,
      sourceShowWhitespace: false,
      sourceLineNumbers: true,
      sourceMatchTags: true,
      sourceTagCompletion: true,
      spellEnabled: true,
      spellHighlight: true,
      customDictionaryPath: '',
      fastMode: false,
    },
    other: {
      defaultEncoding: 'utf-8',
      keepEncoding: false,
      restorePosition: true,
      scriptsFolder: '',
      genresFolder: '',
      dictionariesFolder: '',
      templateFolder: '',
      askOnNonClearImage: true,
      insertClearImages: false,
      pasteImageFormat: 'jpeg',
      jpegQuality: 90,
      nbspDisplayChar: '\u00B0',
      versionCheck: 'monthly',
      switchKeyboardLayout: false,
      keyboardLayoutId: '',
      keyboardLayoutName: '',
    },
    words: { showExclusionsInWordsDialog: false },
    session: {
      windowGeometry: null,
      toolbars: { commands: true, scripts: true, links: true, table: true, status: true },
      treeVisible: true,
      treeWidth: 260,
      findHistory: [],
      replaceHistory: [],
      toolbarLayouts: {},
      lastFileDialogFolder: '',
    },
    ...overrides,
  };
}

/** Deep-merges a `settings.set` patch the way the core does (objects merge, leaves replace). */
export function mergeSettings<T>(target: T, patch: unknown): T {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch as T;
  const base = (typeof target === 'object' && target !== null ? target : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    out[key] =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      key !== 'windowGeometry'
        ? mergeSettings(base[key], value)
        : value;
  }
  return out as T;
}
