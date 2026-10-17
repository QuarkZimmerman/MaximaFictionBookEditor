/**
 * User Story 9 - Configure settings and hotkeys (T128).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode or when the core has no `settings.*` methods.
 *
 * Scenarios (spec.md US9):
 *  1. the Settings dialog has the View, Other, Hotkeys and Words pages with the options of
 *     FR-090 to FR-093
 *  2. a shortcut already used by another command is reported ("Assigned to ...") and can be
 *     replaced, deleted or restored to the default
 *  3. every changed setting is preserved across a restart (the core persists `settings.json`;
 *     the page is reloaded and `settings.get` re-read) and takes effect (Body font variables,
 *     Source line numbers, interface language)
 *
 * Feature 003 (T014, FR-001): the language choice offers Ukrainian, and the language journey
 * (4.) switches to Ukrainian as well - restart prompt, live switch, reload, back through the
 * Ukrainian dialog. The interface texts the journeys wait for come from the catalogues
 * (fixtures/i18n.ts), so the journey reads the same in every interface language.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type CoreHandle, type RpcCallError } from './fixtures/core';
import type { Page } from '@playwright/test';
import { pageText, uiText } from './fixtures/i18n';
import { label, MOD, MOD_LABEL, RESERVED_CHORD } from './fixtures/keys';

interface SettingsJson {
  view: Record<string, unknown>;
  other: Record<string, unknown>;
  words: Record<string, unknown>;
  session: Record<string, unknown>;
}

async function supportsSettings(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('settings.get')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** Resets the sections the dialog edits (null = defaults, resource-formats.md §6). */
async function resetSettings(core: CoreHandle): Promise<void> {
  await core.rpc('settings.set', { patch: { view: null, other: null, words: null } });
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function openSettings(page: Page): Promise<void> {
  await menu(page, 'tools', 'settings');
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await expect(page.getByTestId('settings-page-view')).toBeVisible();
}

async function showPage(page: Page, id: 'view' | 'other' | 'hotkeys' | 'words'): Promise<void> {
  await page.getByTestId(`settings-tab-${id}`).click();
  await expect(page.getByTestId(`settings-page-${id}`)).toBeVisible();
}

/** Browser-side snippet (the e2e tsconfig has no DOM lib, hence a string). */
const HTML_VARIABLES = `(() => {
  const style = document.documentElement.style;
  return {
    family: style.getPropertyValue('--mfbe-body-font-family'),
    size: style.getPropertyValue('--mfbe-body-font-size'),
    fg: style.getPropertyValue('--mfbe-body-fg'),
    bg: style.getPropertyValue('--mfbe-body-bg'),
  };
})()`;

const BODY_FONT = `(() => {
  const node = document.querySelector('.mfbe-body-view');
  const style = node ? getComputedStyle(node) : null;
  return style ? { family: style.fontFamily, size: style.fontSize, color: style.color } : null;
})()`;

interface Vars {
  family: string;
  size: string;
  fg: string;
  bg: string;
}

test.describe('US9 - configure settings and hotkeys', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSettings(core)), 'the core does not implement settings.* yet');
    await resetSettings(core);
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('1. the dialog has the View, Other, Hotkeys and Words pages with their options', async ({
    page,
  }) => {
    await openSettings(page);
    for (const id of ['view', 'other', 'hotkeys', 'words'] as const) {
      await expect(page.getByTestId(`settings-tab-${id}`)).toBeVisible();
    }

    // View (FR-090): language; body font / size / colours; source editor options; spelling.
    for (const control of [
      'settings-view-language',
      'settings-view-body-font',
      'settings-view-body-font-size',
      'settings-view-text-color',
      'settings-view-background',
      'settings-view-fast-mode',
      'settings-view-source-font',
      'settings-view-source-wrap',
      'settings-view-source-highlight',
      'settings-view-source-eol',
      'settings-view-source-whitespace',
      'settings-view-source-line-numbers',
      'settings-view-source-match-tags',
      'settings-view-spell-enabled',
      'settings-view-spell-highlight',
      'settings-view-custom-dictionary',
      'settings-view-custom-dictionary-browse',
    ]) {
      await expect(page.getByTestId(control), control).toBeVisible();
    }
    // The interface languages: System default, English, Russian and Ukrainian (feature 003).
    await expect(page.getByTestId('settings-view-language').locator('option')).toHaveText([
      'System default',
      'English',
      'Russian',
      'Ukrainian',
    ]);
    expect(
      await page
        .getByTestId('settings-view-language')
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(['system', 'en', 'ru', 'uk']);

    // Other (FR-091).
    await showPage(page, 'other');
    for (const control of [
      'settings-other-encoding',
      'settings-other-keep-encoding',
      'settings-other-restore-position',
      'settings-other-scripts-default',
      'settings-other-scripts-path',
      'settings-other-scripts-browse',
      'settings-other-scripts-open',
      'settings-other-genres-default',
      'settings-other-genres-path',
      'settings-other-genres-browse',
      'settings-other-genres-open',
      'settings-other-genre-sources',
      'settings-other-ask-non-clear',
      'settings-other-insert-clear',
      'settings-other-image-format',
      'settings-other-jpeg-quality',
      'settings-other-nbsp',
    ]) {
      await expect(page.getByTestId(control), control).toBeVisible();
    }
    await expect(page.getByTestId('settings-other-encoding').locator('option')).toHaveText([
      'utf-8',
      'utf-16',
      'windows-1251',
      'windows-1252',
      'iso-8859-1',
      'iso-8859-2',
      'iso-8859-5',
      'iso-8859-15',
      'koi8-r',
    ]);
    await expect(page.getByTestId('settings-other-encoding')).toHaveValue('utf-8');
    // The effective genre list and where it comes from (FR-127).
    await expect(page.getByTestId('settings-other-genre-sources')).toContainText(
      /standard list \(\d+\)/,
    );

    // Hotkeys (FR-092): the eight groups, commands, shortcut control, actions, description.
    await showPage(page, 'hotkeys');
    await expect(page.getByTestId('settings-hotkeys-groups').locator('[role="option"]')).toHaveText(
      ['File', 'Edit', 'Navigation', 'Style', 'View', 'Tools', 'Symbols', 'Scripts'],
    );
    await expect(page.getByTestId('settings-hotkeys-command-file.save')).toContainText('F2');
    for (const control of [
      'settings-hotkeys-capture',
      'settings-hotkeys-assign',
      'settings-hotkeys-delete',
      'settings-hotkeys-default',
      'settings-hotkeys-description',
    ]) {
      await expect(page.getByTestId(control), control).toBeVisible();
    }

    // Words (FR-093).
    await showPage(page, 'words');
    for (const control of [
      'settings-words-list',
      'settings-words-new',
      'settings-words-add',
      'settings-words-select-all',
      'settings-words-remove',
      'settings-words-show-exclusions',
    ]) {
      await expect(page.getByTestId(control), control).toBeVisible();
    }
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
  });

  test('2. a conflicting hotkey is reported; replace, delete and default work', async ({
    page,
  }) => {
    await openSettings(page);
    await showPage(page, 'hotkeys');
    await page.getByTestId('settings-hotkeys-group-edit').click();
    await page.getByTestId('settings-hotkeys-command-edit.undo').click();
    await expect(page.getByTestId('settings-hotkeys-current')).toContainText(label('Mod+Z'));
    await expect(page.getByTestId('settings-hotkeys-description')).toHaveText(
      'Undo the last action',
    );

    const capture = page.getByTestId('settings-hotkeys-capture');
    await capture.focus();
    await page.keyboard.press(`${MOD}+y`);
    await expect(capture).toHaveValue(label('Mod+Y'));
    await expect(page.getByTestId('settings-hotkeys-collision')).toHaveText(
      'Assigned to "Edit \\ Redo"',
    );
    await expect(page.getByTestId('settings-hotkeys-assign')).toBeEnabled();

    // Platform-reserved chord: "Wrong shortcut!".
    await page.keyboard.press(RESERVED_CHORD);
    await expect(capture).toHaveValue('Wrong shortcut!');
    await expect(page.getByTestId('settings-hotkeys-assign')).toBeDisabled();

    // Replace: Undo takes Ctrl+Y, Redo loses it.
    await page.keyboard.press(`${MOD}+y`);
    await page.getByTestId('settings-hotkeys-assign').click();
    await expect(page.getByTestId('settings-hotkeys-current')).toContainText(label('Mod+Y'));
    await expect(page.getByTestId('settings-hotkeys-command-edit.redo')).not.toContainText(
      label('Mod+Y'),
    );

    // Default on Redo collides with Undo: "Default hotkey ... Replace?" -> Yes.
    await page.getByTestId('settings-hotkeys-command-edit.redo').click();
    await page.getByTestId('settings-hotkeys-default').click();
    const prompt = page.getByTestId('dialog-hotkey-default-collision');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId('dialog-hotkey-default-collision-text')).toHaveText(
      'Default hotkey for this command was assigned to "Edit \\ Undo"! Replace?',
    );
    await prompt.getByTestId('dialog-hotkey-default-collision-button-yes').click();
    await expect(page.getByTestId('settings-hotkeys-current')).toContainText(label('Mod+Y'));
    await expect(page.getByTestId('settings-hotkeys-command-edit.undo')).not.toContainText(
      `${MOD_LABEL}+`,
    );

    // Delete removes the shortcut of the selected command.
    await page.getByTestId('settings-hotkeys-delete').click();
    await expect(page.getByTestId('settings-hotkeys-current')).toContainText('None');

    // Cancel discards all of it: the Edit menu still shows the defaults.
    await page.getByTestId('dialog-settings-button-cancel').click();
    await page.getByTestId('menu-edit').click();
    await expect(page.getByTestId('menu-edit-undo')).toContainText(label('Mod+Z'));
    await expect(page.getByTestId('menu-edit-redo')).toContainText(label('Mod+Y'));
    await page.keyboard.press('Escape');

    // OK applies to the live map (the Edit menu follows); the core without hotkeys.* keeps them
    // for the session only.
    await openSettings(page);
    await showPage(page, 'hotkeys');
    await page.getByTestId('settings-hotkeys-group-edit').click();
    await page.getByTestId('settings-hotkeys-command-edit.undo').click();
    await capture.focus();
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(page.getByTestId('settings-hotkeys-collision')).toHaveText(
      'Not assigned to other command',
    );
    await page.getByTestId('settings-hotkeys-assign').click();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await page.getByTestId('menu-edit').click();
    await expect(page.getByTestId('menu-edit-undo')).toContainText(label('Mod+Shift+Z'));
    await page.keyboard.press('Escape');
  });

  test('3. changed settings take effect and persist across a restart', async ({ core, page }) => {
    await openSettings(page);

    // View: body font / size / colours, source line numbers off, wrap off, spelling off.
    await page.getByTestId('settings-view-body-font').fill('Arial');
    await page.getByTestId('settings-view-body-font-size').fill('18');
    await page.getByTestId('settings-view-text-color').fill('#112233');
    await page.getByTestId('settings-view-background').fill('#fefefe');
    await page.getByTestId('settings-view-source-line-numbers').uncheck();
    await page.getByTestId('settings-view-source-wrap').uncheck();
    await page.getByTestId('settings-view-spell-enabled').uncheck();

    // Other: encoding, keep encoding, restore position, images, JPEG quality, NBSP character.
    await showPage(page, 'other');
    await page.getByTestId('settings-other-encoding').selectOption('windows-1251');
    await page.getByTestId('settings-other-keep-encoding').check();
    await page.getByTestId('settings-other-restore-position').uncheck();
    await page.getByTestId('settings-other-ask-non-clear').uncheck();
    await page.getByTestId('settings-other-insert-clear').check();
    await page.getByTestId('settings-other-image-format').selectOption('png');
    await page.getByTestId('settings-other-jpeg-quality').fill('75');
    await page.getByTestId('settings-other-nbsp').selectOption('\u25A1');

    // Words: show exclusions in the Words dialog.
    await showPage(page, 'words');
    await page.getByTestId('settings-words-show-exclusions').check();

    // Apply keeps the dialog open and the Body variables change at once.
    await page.getByTestId('dialog-settings-button-apply').click();
    await expect
      .poll(() => page.evaluate<Vars>(HTML_VARIABLES))
      .toEqual({
        family: 'Arial',
        size: '18px',
        fg: '#112233',
        bg: '#fefefe',
      });
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);

    const check = async (settings: SettingsJson) => {
      expect(settings.view).toMatchObject({
        bodyFont: 'Arial',
        bodyFontSize: 18,
        bodyTextColor: '#112233',
        bodyBackground: '#fefefe',
        sourceLineNumbers: false,
        sourceWrap: false,
        spellEnabled: false,
      });
      expect(settings.other).toMatchObject({
        defaultEncoding: 'windows-1251',
        keepEncoding: true,
        restorePosition: false,
        askOnNonClearImage: false,
        insertClearImages: true,
        pasteImageFormat: 'png',
        jpegQuality: 75,
        nbspDisplayChar: '\u25A1',
      });
      expect(settings.words).toMatchObject({ showExclusionsInWordsDialog: true });
    };
    await check(await core.rpc<SettingsJson>('settings.get'));

    // The core wrote settings.json (what a real restart would read back).
    const file = path.join(core.dataDir!, 'settings.json');
    expect(existsSync(file)).toBe(true);
    await check(JSON.parse(readFileSync(file, 'utf8')) as SettingsJson);

    // Effect on the editors: body font and colours, Source line numbers / wrap.
    await menu(page, 'file', 'new');
    await expect(page.getByTestId('body-editor')).toBeVisible();
    const font = await page.evaluate<{ family: string; size: string; color: string } | null>(
      BODY_FONT,
    );
    expect(font?.family).toContain('Arial');
    expect(font?.size).toBe('18px');
    expect(font?.color).toBe('rgb(17, 34, 51)');
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-line-numbers', 'false');
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-wrap', 'false');

    // "Restart": reload the page; the UI reads settings.get again and re-applies everything.
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    await expect
      .poll(() => page.evaluate<Vars>(HTML_VARIABLES))
      .toEqual({
        family: 'Arial',
        size: '18px',
        fg: '#112233',
        bg: '#fefefe',
      });
    await check(await core.rpc<SettingsJson>('settings.get'));
    await openSettings(page);
    await expect(page.getByTestId('settings-view-body-font')).toHaveValue('Arial');
    await expect(page.getByTestId('settings-view-body-font-size')).toHaveValue('18');
    await expect(page.getByTestId('settings-view-source-line-numbers')).not.toBeChecked();
    await showPage(page, 'other');
    await expect(page.getByTestId('settings-other-encoding')).toHaveValue('windows-1251');
    await expect(page.getByTestId('settings-other-jpeg-quality')).toHaveValue('75');
    await expect(page.getByTestId('settings-other-image-format')).toHaveValue('png');
    await showPage(page, 'words');
    await expect(page.getByTestId('settings-words-show-exclusions')).toBeChecked();
    await page.getByTestId('dialog-settings-button-cancel').click();
  });

  test('3b. the Words page edits the exclusion list with validation', async ({ core, page }) => {
    const current = await core.rpc<{ words?: string[] } | string[]>('words.exclusions', {});
    const existing = Array.isArray(current) ? current : (current.words ?? []);
    if (existing.length > 0) await core.rpc('words.exclusions', { remove: existing });
    try {
      await openSettings(page);
      await showPage(page, 'words');
      const input = page.getByTestId('settings-words-new');
      await input.fill('ab1');
      await page.getByTestId('settings-words-add').click();
      const error = page.getByTestId('dialog-exclusion-error');
      await expect(error.getByTestId('dialog-exclusion-error-text')).toHaveText(
        "New exclusion word must contain only alpha characters and one '-' between them!",
      );
      await error.getByTestId('dialog-exclusion-error-button-ok').click();

      await input.fill('ibid');
      await input.press('Enter');
      await expect(page.getByTestId('settings-words-row-ibid')).toBeVisible();
      await input.fill('ibid');
      await page.getByTestId('settings-words-add').click();
      await expect(error.getByTestId('dialog-exclusion-error-text')).toHaveText(
        'This word is already in list!',
      );
      await error.getByTestId('dialog-exclusion-error-button-ok').click();

      const stored = await core.rpc<{ words?: string[] } | string[]>('words.exclusions', {});
      expect(Array.isArray(stored) ? stored : stored.words).toEqual(['ibid']);

      await page.getByTestId('settings-words-select-all').check();
      await page.getByTestId('settings-words-remove').click();
      await page.getByTestId('dialog-exclusion-remove-button-yes').click();
      await expect(page.getByTestId('settings-words-empty')).toBeVisible();
      await page.getByTestId('dialog-settings-button-cancel').click();
    } finally {
      const left = await core.rpc<{ words?: string[] } | string[]>('words.exclusions', {});
      const words = Array.isArray(left) ? left : (left.words ?? []);
      if (words.length > 0) await core.rpc('words.exclusions', { remove: words });
    }
  });

  test('4. switching the interface language asks for a restart and persists', async ({
    core,
    page,
  }) => {
    await openSettings(page);
    await page.getByTestId('settings-view-language').selectOption('ru');
    await page.getByTestId('dialog-settings-button-ok').click();
    const prompt = page.getByTestId('dialog-restart-prompt');
    await expect(prompt).toBeVisible();
    // (The prompt may still use the previous language, as the original did.)
    await expect(prompt.getByTestId('dialog-restart-prompt-text')).toContainText(
      /must be restarted|перезагруз/i,
    );
    await prompt.getByTestId('dialog-restart-prompt-button-no').click();
    // The menus switched live ...
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    const settings = await core.rpc<SettingsJson>('settings.get');
    expect(settings.view.uiLanguage).toBe('ru');
    // ... and after the restart the Russian interface comes back from settings.json.
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    await expect(page.getByTestId('status-message')).toHaveText('Готово');

    // On to Ukrainian through the (Russian) dialog (feature 003, FR-001). "Файл" reads the same
    // in Russian and Ukrainian: the Help menu and the tree caption tell them apart.
    await menu(page, 'tools', 'settings');
    await expect(page.getByTestId('dialog-settings-title')).toContainText('Настройки');
    await expect(
      page.getByTestId('settings-view-language').locator('option[value="uk"]'),
      'the language choice offers Ukrainian (FR-001)',
    ).toHaveCount(1);
    await page.getByTestId('settings-view-language').selectOption('uk');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId('dialog-restart-prompt-text')).toContainText(
      /must be restarted|перезагруз|перезапуск/i,
    );
    await prompt.getByTestId('dialog-restart-prompt-button-no').click();
    await expect(page.getByTestId('menu-help')).toHaveText(uiText('uk', 'menu.help.caption'));
    await expect(page.getByTestId('panel-tree-caption')).toHaveText(uiText('uk', 'tree.caption'));
    expect((await core.rpc<SettingsJson>('settings.get')).view.uiLanguage).toBe('uk');
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page.getByTestId('menu-help')).toHaveText(uiText('uk', 'menu.help.caption'));
    await expect(page.getByTestId('status-message')).toHaveText(uiText('uk', 'status.ready'));

    // Back to English through the dialog (its labels are Ukrainian now).
    await menu(page, 'tools', 'settings');
    await expect(page.getByTestId('dialog-settings-title')).toContainText(
      uiText('uk', 'dialog.settings.caption'),
    );
    await expect(page.getByTestId('settings-view-language')).toHaveValue('uk');
    await page.getByTestId('settings-view-language').selectOption('en');
    await page.getByTestId('dialog-settings-button-ok').click();
    await page.getByTestId('dialog-restart-prompt-button-no').click();
    await expect(page.getByTestId('menu-file')).toHaveText('File');
    await expect(page.getByTestId('menu-help')).toHaveText('Help');
  });
});
