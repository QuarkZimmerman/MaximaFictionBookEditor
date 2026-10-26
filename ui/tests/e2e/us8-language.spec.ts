/**
 * User Story 8 - Use the editor in English or Russian (T095, FR-100, SC-004).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); the menu
 * walk, the About dialog and the system-language start also run core-less.
 *
 * Scenarios (spec.md US8):
 *  1. started in Russian (`?lang=ru`), every menu and submenu item, every dialog reachable
 *     without a document and with a new document (Find, Replace, Settings with all pages, Words,
 *     About, Spelling, Table, Link, the clear-image prompt, the Validation panel) shows Russian
 *     captions, labels and buttons - no label equals the English catalogue text of a key whose
 *     Russian text differs, and the genre / language names of the Description view are Russian;
 *  2. switching the language in Settings asks for a restart (in Russian), the menus switch live
 *     and the choice survives a reload; a fresh installation (`uiLanguage: "system"`) follows a
 *     Russian system language on first start.
 *
 * Feature 003 (T014, FR-001): the language choice offers Ukrainian as the fourth entry, the
 * switch journey goes on to Ukrainian (restart prompt in Ukrainian, live switch, reload), and a
 * fresh installation follows a Ukrainian system language. The Ukrainian walk of every menu,
 * dialog and message is us1-ukrainian.spec.ts.
 *
 * Feature 003 US3 (T037, FR-020 to FR-022): "Restart now?" really restarts. Headless there is no
 * shell, so `app.restart` answers 1070 after the test provider recorded it and the page reloads
 * itself: Yes with a saved book records the path and reloads with `?open=<path>` in the new
 * language; Yes with a never-saved document (Don't save) carries no path and shows a new
 * document; Cancel in the save prompt abandons the restart; No changes nothing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { uiText } from './fixtures/i18n';
import type { Locator, Page } from '@playwright/test';

/* ------------------------------------------------------------------------ */
/* Catalogues (merged like ui/src/i18n/index.ts)                             */
/* ------------------------------------------------------------------------ */

const I18N_DIR = fileURLToPath(new URL('../../src/i18n/', import.meta.url));

type Language = 'en' | 'ru';
type Flat = Map<string, string>;

function flatten(value: unknown, prefix: string, out: Flat): Flat {
  if (value === null || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(full, child);
    else flatten(child, full, out);
  }
  return out;
}

function loadCatalogue(language: Language): Flat {
  const files = [
    `${language}.json`,
    ...readdirSync(I18N_DIR)
      .filter((name) => name.endsWith(`.${language}.json`) && name !== `${language}.json`)
      .sort(),
  ];
  const flat: Flat = new Map();
  for (const name of files) {
    flatten(JSON.parse(readFileSync(path.join(I18N_DIR, name), 'utf8')), '', flat);
  }
  return flat;
}

/** Strips the `&` accelerator markers (`Save &As...` -> `Save As...`, `&&` -> `&`). */
function plain(label: string): string {
  let text = '';
  let marked = false;
  for (let i = 0; i < label.length; i += 1) {
    const ch = label[i]!;
    if (ch === '&') {
      const next = label[i + 1];
      if (next === '&') {
        text += '&';
        i += 1;
      } else if (next !== undefined && !marked) {
        marked = true;
      }
    } else {
      text += ch;
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

const EN = loadCatalogue('en');
const RU = loadCatalogue('ru');

/** English texts of keys whose Russian text differs -> the keys (what must never show up in RU). */
const ENGLISH_ONLY = new Map<string, string[]>();
for (const [key, text] of EN) {
  const ru = RU.get(key);
  if (ru === undefined) continue;
  const en = plain(text);
  if (en === '' || plain(ru) === en) continue;
  if (!ENGLISH_ONLY.has(en)) ENGLISH_ONLY.set(en, []);
  ENGLISH_ONLY.get(en)!.push(key);
}

/** Values that legitimately contain no Cyrillic letters (identical-allowlist.json + hotkeys). */
const TECHNICAL = new Set<string>();
{
  const allow = JSON.parse(
    readFileSync(path.join(I18N_DIR, 'identical-allowlist.json'), 'utf8'),
  ) as {
    keys: string[];
  };
  for (const key of allow.keys) {
    const value = EN.get(key);
    if (value) TECHNICAL.add(plain(value));
  }
}

const CYRILLIC = /[\u0400-\u04FF]/;
const LATIN_WORD = /[A-Za-z]{2,}/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*$/; // en_US, utf-8, image/png-ish

/** Collects the reasons why `text` is not Russian (empty when it is fine). */
function russianProblems(text: string, where: string, strict: boolean): string[] {
  const value = text.replace(/\s+/g, ' ').trim();
  if (value === '') return [];
  const keys = ENGLISH_ONLY.get(value);
  if (keys) return [`${where}: "${value}" is the English text of ${keys.join(', ')}`];
  if (!strict) return [];
  if (!LATIN_WORD.test(value) || CYRILLIC.test(value)) return [];
  if (TECHNICAL.has(value) || IDENTIFIER.test(value)) return [];
  return [`${where}: "${value}" contains no Cyrillic letters`];
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

const MENUS = ['file', 'edit', 'view', 'add', 'style', 'tools', 'scripts', 'help'] as const;

/** Items of the Scripts menu that come from the catalogue (the rest are script manifests). */
const STATIC_SCRIPT_ITEMS = new Set([
  'menu-scripts-none',
  'menu-scripts-last',
  'menu-scripts-openFolder',
  'menu-scripts-reload',
]);

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function resetSettings(core: CoreHandle): Promise<void> {
  await core.rpc('settings.set', { patch: { view: null, other: null, words: null } });
}

function appUrl(core: CoreHandle, params: Record<string, string>): string {
  const url = new URL(core.baseURL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

async function openApp(core: CoreHandle, page: Page, params: Record<string, string> = {}) {
  await page.goto(appUrl(core, params));
  await page.getByTestId('app-root').waitFor();
  if (core.hasCore) {
    await expect(page.getByTestId('status-message')).toHaveText(/Готово|Ready/);
  }
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** File > New; returns the editable Body editor. */
async function newDocument(page: Page): Promise<Locator> {
  await menu(page, 'file', 'new');
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

function firstParagraph(page: Page): Locator {
  return page.getByTestId('body-editor').locator('.fb-body > .fb-section > p.fb-p').first();
}

/**
 * Puts a collapsed caret into the first paragraph and lets the editor publish it (quick repeated
 * clicks would count as double/triple clicks and select a word or the paragraph; ArrowLeft
 * collapses such a selection to its start).
 */
async function caretIntoParagraph(page: Page): Promise<void> {
  await firstParagraph(page).click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(80);
  // A collapsed caret at the paragraph's start stepped into the history block above the body
  // (feature 004, one editing surface): step back to the paragraph.
  if (!/^body\[/.test(await page.getByTestId('status-path').innerText())) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.getByTestId('status-path')).toHaveText(/^body\[1\]\/section\[1\]\/p\[\d+\]$/);
  await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', '');
  await page.waitForTimeout(80);
}

/** Selects `length` characters of the first paragraph (from the caret put near its start). */
async function selectInParagraph(page: Page, length: number): Promise<void> {
  await caretIntoParagraph(page);
  await page.keyboard.down('Shift');
  for (let i = 0; i < length; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('body-view')).toHaveAttribute(
    'data-selected-text',
    new RegExp(`^.{${length}}$`),
  );
}

/**
 * Texts of the strict elements (title, buttons, tabs, labels, legends, headers) of the element
 * with `testId`. Browser-side snippet (the e2e tsconfig has no DOM lib, hence a string).
 */
async function strictTexts(page: Page, testId: string): Promise<{ where: string; text: string }[]> {
  const snippet = `(() => {
    const root = document.querySelector('[data-testid="${testId}"]');
    if (!root) return [];
    const selector = '.mfbe-dialog-title, button, [role="tab"], label, legend, th, dt';
    const out = [];
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (element.closest('[hidden]')) continue;
      if (element.offsetParent === null && element.tagName !== 'LEGEND') continue;
      const className = typeof element.className === 'string' ? element.className.split(' ')[0] : '';
      const where =
        element.getAttribute('data-testid') ??
        element.tagName.toLowerCase() + (className ? '.' + className : '');
      out.push({ where, text: element.innerText });
    }
    return out;
  })()`;
  return (await page.evaluate(snippet)) as { where: string; text: string }[];
}

/**
 * Every visible text line of the element `testId` (catalogue-based check, no Cyrillic
 * requirement) minus the lines of data regions (word lists, table bodies, code, the keyboard
 * layouts under the names the system gives them - feature 004 FR-090), which show the
 * document's or the system's own words.
 */
async function textLines(page: Page, testId: string): Promise<string[]> {
  const snippet = `(() => {
    const root = document.querySelector('[data-testid="${testId}"]');
    if (!root) return [];
    const lines = (text) => text.split('\\n').map((line) => line.trim()).filter((line) => line);
    const data = new Set();
    const selector =
      '[role="grid"], [role="listbox"], tbody, textarea, pre, code, [data-testid="settings-other-layout"]';
    for (const element of Array.from(root.querySelectorAll(selector))) {
      for (const line of lines(element.innerText)) data.add(line);
    }
    return lines(root.innerText).filter((line) => !data.has(line));
  })()`;
  return (await page.evaluate(snippet)) as string[];
}

/** Asserts that the dialog (or panel) `testId` is rendered in Russian. */
async function expectRussianDialog(page: Page, testId: string, name: string): Promise<void> {
  const root = page.getByTestId(testId);
  await expect(root).toBeVisible();
  const problems: string[] = [];
  const strict = await strictTexts(page, testId);
  expect(strict.length, `${name}: strict elements found`).toBeGreaterThan(0);
  for (const { where, text } of strict) {
    problems.push(...russianProblems(text, `${name} ${where}`, true));
  }
  for (const line of await textLines(page, testId)) {
    problems.push(...russianProblems(line, `${name} text`, false));
  }
  expect(problems, `${name} must be Russian`).toEqual([]);
}

/** Closes an open menu (a hovered submenu takes the first Escape). */
async function closeMenu(page: Page, popup: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3 && (await popup.isVisible()); attempt += 1) {
    await page.keyboard.press('Escape');
  }
  await expect(popup).toBeHidden();
}

/* ------------------------------------------------------------------------ */
/* Scenario 1: everything is Russian                                        */
/* ------------------------------------------------------------------------ */

test.describe('US8 - the interface in Russian (?lang=ru)', () => {
  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('1a. every menu and submenu item is Russian', async ({ core, page }) => {
    await openApp(core, page, { lang: 'ru' });
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByTestId('panel-tree-caption')).toHaveText('Структура документа');
    await expect(page.getByTestId('status-insmode')).toHaveText('ВСТ');

    const problems: string[] = [];
    let itemCount = 0;
    for (const menuId of MENUS) {
      const top = page.getByTestId(`menu-${menuId}`);
      problems.push(...russianProblems(await top.innerText(), `menu-${menuId}`, true));
      await top.click();
      const popup = page.getByTestId(`menu-${menuId}-popup`);
      await expect(popup).toBeVisible();
      const items = popup.locator(':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]');
      const count = await items.count();
      for (let index = 0; index < count; index += 1) {
        const item = items.nth(index);
        const testId = (await item.getAttribute('data-testid')) ?? `${menuId}#${index}`;
        const label = await item.locator('.mfbe-menu-label').first().innerText();
        const strict = menuId !== 'scripts' || STATIC_SCRIPT_ITEMS.has(testId);
        // Script group/script names are user data (manifests), not catalogue strings: a test
        // fixture group called "Dialogs" must not count as an English fallback.
        if (menuId !== 'scripts' || STATIC_SCRIPT_ITEMS.has(testId)) {
          problems.push(...russianProblems(label, testId, strict));
        }
        itemCount += 1;
        if ((await item.getAttribute('aria-haspopup')) === 'true') {
          await item.hover();
          const submenu = page.getByTestId(`${testId}-popup`);
          await expect(submenu).toBeVisible();
          const subItems = submenu.locator('[role="menuitem"], [role="menuitemcheckbox"]');
          const subCount = await subItems.count();
          for (let sub = 0; sub < subCount; sub += 1) {
            const subItem = subItems.nth(sub);
            const subId = (await subItem.getAttribute('data-testid')) ?? `${testId}#${sub}`;
            const subLabel = await subItem.locator('.mfbe-menu-label').first().innerText();
            // Recent files and scripts carry user data (file names, manifest names): only
            // catalogue-driven submenus are checked.
            if (menuId !== 'scripts' && !subId.startsWith('menu-file-recent')) {
              problems.push(...russianProblems(subLabel, subId, false));
            }
            itemCount += 1;
          }
        }
      }
      await closeMenu(page, popup);
    }
    expect(itemCount).toBeGreaterThan(50);
    expect(problems).toEqual([]);

    // Toolbar tooltips follow the language too.
    await expect(page.getByTestId('toolbar-file.new')).toHaveAttribute('title', /^Новый/);
  });

  test('1b. the About dialog (reachable without a document or core) is Russian', async ({
    core,
    page,
  }) => {
    await openApp(core, page, { lang: 'ru' });
    await menu(page, 'help', 'about');
    const about = page.getByTestId('dialog-about');
    await expectRussianDialog(page, 'dialog-about', 'About');
    await expect(about.getByTestId('dialog-about-title')).toContainText('О программе');
    await expect(about.getByTestId('dialog-about-button-close')).toHaveText('Закрыть');
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
  });

  test('1c. every page of the Settings dialog (reachable without a document) is Russian', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'the Settings dialog needs mfbe-core (MFBE_CORE_BIN)');
    await openApp(core, page, { lang: 'ru' });
    await menu(page, 'tools', 'settings');
    const settings = page.getByTestId('dialog-settings');
    await expect(settings.getByTestId('dialog-settings-title')).toContainText('Настройки');
    await expect(settings.getByTestId('settings-page-view')).toBeVisible();
    for (const id of ['view', 'other', 'hotkeys', 'words'] as const) {
      await settings.getByTestId(`settings-tab-${id}`).click();
      await expect(settings.getByTestId(`settings-page-${id}`)).toBeVisible();
      await expectRussianDialog(page, 'dialog-settings', `Settings/${id}`);
    }
    // `?lang=ru` forces this session only: the stored choice is still "system" (in Russian).
    const language = settings.getByTestId('settings-view-language');
    await expect(language).toHaveValue('system');
    await expect(language.locator('option:checked')).toHaveText('Как в системе');
    await expect(language.locator('option[value="ru"]')).toHaveText('Русский');
    await expect(language.locator('option[value="en"]')).toHaveText('Английский');
    // Feature 003 FR-001: System default, English, Russian and Ukrainian - the original's three.
    await expect(language.locator('option[value="uk"]')).toHaveText('Украинский');
    expect(
      await language
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(['system', 'en', 'ru', 'uk']);
    await settings.getByTestId('dialog-settings-button-cancel').click();
    await expect(settings).toBeHidden();
  });

  test('1d. dialogs of a new document are Russian; genre and language names are localised', async ({
    core,
    page,
  }) => {
    test.skip(!(await supportsDocuments(core)), 'needs mfbe-core with doc.* (MFBE_CORE_BIN)');
    await resetSettings(core);
    await openApp(core, page, { lang: 'ru' });
    await newDocument(page);
    await expect(page).toHaveTitle(/^Без имени/);

    // Find / Replace (the Find fields are shared).
    await menu(page, 'edit', 'find');
    const find = page.getByTestId('dialog-find');
    await expectRussianDialog(page, 'dialog-find', 'Find');
    await expect(find.getByTestId('dialog-find-title')).toContainText('Поиск');
    await find.getByTestId('dialog-find-button-cancel').click();
    await expect(find).toBeHidden();

    await menu(page, 'edit', 'replace');
    const replace = page.getByTestId('dialog-replace');
    await expectRussianDialog(page, 'dialog-replace', 'Replace');
    await expect(replace.getByTestId('dialog-replace-title')).toContainText('Заменить');
    await replace.getByTestId('dialog-replace-button-cancel').click();
    await expect(replace).toBeHidden();

    // Words.
    await menu(page, 'tools', 'words');
    const words = page.getByTestId('dialog-words');
    await expect(words.getByTestId('dialog-words-title')).toContainText('Слова');
    await expect(words.getByTestId('words-loading')).toHaveCount(0);
    await expectRussianDialog(page, 'dialog-words', 'Words');
    await words.getByTestId('dialog-words-button-cancel').click();
    await expect(words).toBeHidden();

    // Spelling (when the core ships dictionaries and the checker is enabled). A misspelled word
    // keeps the dialog open at its first stop instead of reporting completion right away.
    await caretIntoParagraph(page);
    await page.keyboard.type('превет ');
    await expect(firstParagraph(page)).toContainText('превет');
    await page.getByTestId('menu-tools').click();
    const spellItem = page.getByTestId('menu-tools-spellcheck');
    const spellEnabled = (await spellItem.getAttribute('aria-disabled')) !== 'true';
    if (spellEnabled) {
      await spellItem.click();
      const spelling = page.getByTestId('dialog-spelling');
      await expect(spelling.getByTestId('dialog-spelling-title')).toContainText('Орфография');
      await expect(spelling.getByTestId('spelling-not-in-dictionary')).not.toHaveValue('');
      await expectRussianDialog(page, 'dialog-spelling', 'Spelling');
      await spelling.getByTestId('dialog-spelling-button-close').click();
      await expect(spelling).toBeHidden();
    } else {
      await page.keyboard.press('Escape');
    }

    // Table properties (caret in a paragraph).
    await caretIntoParagraph(page);
    await menu(page, 'add', 'table');
    const table = page.getByTestId('dialog-table');
    await expectRussianDialog(page, 'dialog-table', 'Table');
    await expect(table.getByTestId('dialog-table-title')).toContainText('Параметры таблицы');
    // The four fields of feature 006 (FR-001) with their Russian labels.
    for (const key of ['rowCount', 'columns', 'headerRow', 'headerColumn']) {
      await expect(
        table.getByText(uiText('ru', `dialog.table.${key}`), { exact: true }),
      ).toBeVisible();
    }
    await table.getByTestId('dialog-table-button-cancel').click();
    await expect(table).toBeHidden();

    // Link... (needs a selection).
    await selectInParagraph(page, 4);
    await menu(page, 'style', 'link');
    const link = page.getByTestId('dialog-link');
    await expectRussianDialog(page, 'dialog-link', 'Link');
    await expect(link.getByTestId('dialog-link-title')).toContainText('Ссылка');
    await link.getByTestId('dialog-link-button-cancel').click();
    await expect(link).toBeHidden();

    // "Insert clear image?" prompt; "No" opens the (pre-answered, cancelled) file dialog.
    await caretIntoParagraph(page);
    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await menu(page, 'add', 'image');
    const prompt = page.getByTestId('dialog-insert-clear-image');
    await expectRussianDialog(page, 'dialog-insert-clear-image', 'Insert clear image');
    await expect(prompt).toContainText('Вставить пустую картинку?');
    await expect(prompt.getByTestId('dialog-insert-clear-image-dontask')).toBeAttached();
    await prompt.getByTestId('dialog-insert-clear-image-button-no').click();
    await expect(prompt).toBeHidden();

    // Validation panel.
    await menu(page, 'file', 'validate');
    const validation = page.getByTestId('validation-panel');
    await expectRussianDialog(page, 'validation-panel', 'Validation');
    await expect(validation.getByTestId('validation-title')).toContainText('Проверка');
    await expect(validation.getByTestId('validation-summary')).toContainText(/ошиб|предупрежд/i);
    await validation.getByTestId('validation-close').click();
    await expect(validation).toBeHidden();

    // Description view: language names and genre names in Russian.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-view')).toBeVisible();
    const lang = page.getByTestId('description-lang');
    await expect(lang).toHaveValue('ru');
    await expect(lang.locator('option:checked')).toHaveText('Русский (ru)');
    await expect(lang.locator('option[value="en"]')).toHaveText('Английский (en)');
    await page.getByTestId('description-genre-add').click();
    const picker = page.getByTestId('genre-picker');
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('genre-picker-group-sf')).toHaveAttribute(
      'label',
      'Фантастика, Фэнтези',
    );
    await expect(page.getByTestId('genre-picker-option-sf_history')).toHaveText(
      'Альтернативная история (sf_history)',
    );
    await expectRussianDialog(page, 'genre-picker', 'Genre picker');
    await page.getByTestId('genre-picker-button-cancel').click();
    await expect(picker).toBeHidden();
  });
});

/* ------------------------------------------------------------------------ */
/* Scenario 2: switching and the first start                                */
/* ------------------------------------------------------------------------ */

test.describe('US8 - switching the language', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await resetSettings(core);
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('2a. Settings > View > Language asks for a restart in Russian and survives a reload', async ({
    core,
    page,
  }) => {
    // A Russian installation switches to English: the prompt is Russian (the language of the
    // session that opened the dialog, as in the original editor).
    await core.rpc('settings.set', { patch: { view: { uiLanguage: 'ru' } } });
    await openApp(core, page);
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');

    await menu(page, 'tools', 'settings');
    await expect(page.getByTestId('dialog-settings-title')).toContainText('Настройки');
    await page.getByTestId('settings-view-language').selectOption('en');
    await page.getByTestId('dialog-settings-button-ok').click();

    const prompt = page.getByTestId('dialog-restart-prompt');
    await expect(prompt).toBeVisible();
    // The prompt is shown in the language that was just selected (English here); its
    // buttons follow the same language.
    await expect(prompt.getByTestId('dialog-restart-prompt-text')).toHaveText(
      EN.get('msg.needRestart')!,
    );
    await expect(prompt.getByTestId('dialog-restart-prompt-title')).toContainText(
      'Maxima Fiction Book Editor',
    );
    // The buttons re-render live and may already show the new language (see the report).
    await expect(prompt.getByTestId('dialog-restart-prompt-button-yes')).toHaveText(/^(Да|Yes)$/);
    await expect(prompt.getByTestId('dialog-restart-prompt-button-no')).toHaveText(/^(Нет|No)$/);
    await prompt.getByTestId('dialog-restart-prompt-button-no').click();
    await expect(prompt).toBeHidden();

    // Live switch ...
    await expect(page.getByTestId('menu-file')).toHaveText('File');
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    let settings = await core.rpc<{ view: { uiLanguage: string } }>('settings.get');
    expect(settings.view.uiLanguage).toBe('en');

    // ... and after the "restart" the menus come back in English from settings.json.
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.getByTestId('menu-file')).toHaveText('File');
    await expect(page.getByTestId('menu-help')).toHaveText('Help');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Back to Russian through the (English) dialog: prompt in the language of the session.
    await menu(page, 'tools', 'settings');
    await expect(page.getByTestId('dialog-settings-title')).toContainText('Settings');
    await page.getByTestId('settings-view-language').selectOption('ru');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId('dialog-restart-prompt-text')).toHaveText(
      /Restart now\?$|Перезагрузить сейчас\?$/,
    );
    await prompt.getByTestId('dialog-restart-prompt-button-no').click();
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    await expect(page.getByTestId('status-message')).toHaveText('Готово');
    settings = await core.rpc<{ view: { uiLanguage: string } }>('settings.get');
    expect(settings.view.uiLanguage).toBe('ru');
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    await expect(page.getByTestId('menu-help')).toHaveText('Справка');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');

    // On to Ukrainian through the (Russian) dialog (feature 003, FR-001): the prompt in the
    // language just selected, the live switch, the stored choice and the reload. ("Файл" reads
    // the same in Russian and Ukrainian: the Help menu tells them apart.)
    await menu(page, 'tools', 'settings');
    await expect(page.getByTestId('dialog-settings-title')).toContainText('Настройки');
    await expect(
      page.getByTestId('settings-view-language').locator('option[value="uk"]'),
      'the language choice offers Ukrainian (FR-001)',
    ).toHaveCount(1);
    await page.getByTestId('settings-view-language').selectOption('uk');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId('dialog-restart-prompt-text')).toHaveText(
      uiText('uk', 'msg.needRestart'),
    );
    await expect(prompt.getByTestId('dialog-restart-prompt-button-yes')).toHaveText(
      /^(Так|Да|Yes)$/,
    );
    await expect(prompt.getByTestId('dialog-restart-prompt-button-no')).toHaveText(/^(Ні|Нет|No)$/);
    await prompt.getByTestId('dialog-restart-prompt-button-no').click();
    await expect(prompt).toBeHidden();
    await expect(page.getByTestId('menu-help')).toHaveText(uiText('uk', 'menu.help.caption'));
    await expect(page.getByTestId('menu-tools')).toHaveText(uiText('uk', 'menu.tools.caption'));
    await expect(page.getByTestId('status-message')).toHaveText(uiText('uk', 'status.ready'));
    settings = await core.rpc<{ view: { uiLanguage: string } }>('settings.get');
    expect(settings.view.uiLanguage).toBe('uk');
    await page.reload();
    await page.getByTestId('app-root').waitFor();
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page.getByTestId('menu-help')).toHaveText(uiText('uk', 'menu.help.caption'));
    await expect(page.getByTestId('panel-tree-caption')).toHaveText(uiText('uk', 'tree.caption'));
    // The Settings dialog is Ukrainian now and shows the stored choice.
    await menu(page, 'tools', 'settings');
    await expect(page.getByTestId('dialog-settings-title')).toContainText(
      uiText('uk', 'dialog.settings.caption'),
    );
    const language = page.getByTestId('settings-view-language');
    await expect(language).toHaveValue('uk');
    await expect(language.locator('option:checked')).toHaveText(
      uiText('uk', 'dialog.settings.view.languageUk'),
    );
    await page.getByTestId('dialog-settings-button-cancel').click();
  });

  test('2b. "?lang=" of the shell wins over the stored setting for this session only', async ({
    core,
    page,
  }) => {
    await core.rpc('settings.set', { patch: { view: { uiLanguage: 'ru' } } });
    await openApp(core, page, { lang: 'en' });
    await expect(page.getByTestId('menu-file')).toHaveText('File');
    const settings = await core.rpc<{ view: { uiLanguage: string } }>('settings.get');
    expect(settings.view.uiLanguage).toBe('ru');
    await openApp(core, page);
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
  });
});

/* ------------------------------------------------------------------------ */
/* Scenario 3: "Restart now?" restarts (feature 003 US3, headless path)      */
/* ------------------------------------------------------------------------ */

interface RestartRequest {
  reopen?: string;
  argv: string[];
}

/** Chooses `language` in Settings > View and presses OK; returns the restart prompt. */
async function switchLanguage(page: Page, language: string): Promise<Locator> {
  await menu(page, 'tools', 'settings');
  await page.getByTestId('settings-view-language').selectOption(language);
  await page.getByTestId('dialog-settings-button-ok').click();
  const prompt = page.getByTestId('dialog-restart-prompt');
  await expect(prompt).toBeVisible();
  return prompt;
}

/** Types into the first paragraph so the document counts as modified (title marker `*`). */
async function modifyDocument(page: Page): Promise<void> {
  await caretIntoParagraph(page);
  await page.keyboard.type('restart ');
  await expect(page).toHaveTitle(/\* - /);
}

test.describe('US8 - "Restart now?" restarts the editor (feature 003 US3)', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await resetSettings(core);
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('3a. Yes with a saved book: the path is requested and the page reloads with it in the new language', async ({
    core,
    page,
  }) => {
    await core.rpc('settings.set', { patch: { view: { uiLanguage: 'ru' } } });
    await openApp(core, page);
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    const book = fixtureBook('modern-utf8.fb2');
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await menu(page, 'file', 'open');
    await waitForBook(page, book);
    const before = (await core.rpc<RestartRequest[]>('test.restartRequests')).length;

    const prompt = await switchLanguage(page, 'en');
    await prompt.getByTestId('dialog-restart-prompt-button-yes').click();

    // The restart request names the open document (headless: no shell, so no argv), ...
    await expect
      .poll(() => core.rpc<RestartRequest[]>('test.restartRequests'))
      .toHaveLength(before + 1);
    const requests = await core.rpc<RestartRequest[]>('test.restartRequests');
    expect(requests.at(-1)).toEqual({ reopen: book, argv: [] });

    // ... and the page restarts itself: the same query (token) plus open=<path>, the book
    // open again, the interface in the language just chosen.
    await expect.poll(() => new URL(page.url()).searchParams.get('open')).toBe(book);
    const url = new URL(page.url());
    expect(url.searchParams.get('token')).toBe(core.token);
    expect(url.searchParams.has('lang')).toBe(false);
    expect(url.searchParams.has('new')).toBe(false);
    await page.getByTestId('app-root').waitFor();
    await waitForBook(page, book);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('menu-file')).toHaveText('File');
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    // The reopened book is the one on disk, unmodified.
    await expect(page).not.toHaveTitle(/\* - /);
  });

  test("3b. Yes with a never-saved document (Don't save): no path, the page reloads to a new document", async ({
    core,
    page,
  }) => {
    // `?lang=uk` stands for the shell's one-run override: the reload keeps the query as it is.
    await openApp(core, page, { lang: 'uk' });
    await waitForStartupDocument(page);
    await modifyDocument(page);
    const before = (await core.rpc<RestartRequest[]>('test.restartRequests')).length;

    const prompt = await switchLanguage(page, 'en');
    await prompt.getByTestId('dialog-restart-prompt-button-yes').click();
    // The usual save prompt comes first; "No" (Don't save) restarts without the document.
    const save = page.getByTestId('save-changes-prompt');
    await expect(save).toBeVisible();
    await save.getByTestId('save-changes-prompt-button-no').click();

    await expect
      .poll(() => core.rpc<RestartRequest[]>('test.restartRequests'))
      .toHaveLength(before + 1);
    const requests = await core.rpc<RestartRequest[]>('test.restartRequests');
    expect(requests.at(-1)).toEqual({ argv: [] });
    expect(requests.at(-1)).not.toHaveProperty('reopen');

    // Reloaded without open=, token and lang kept; a fresh document, not the typed text.
    await expect.poll(() => page.url()).not.toContain('open=');
    await page.getByTestId('app-root').waitFor();
    await waitForStartupDocument(page);
    const url = new URL(page.url());
    expect(url.searchParams.get('token')).toBe(core.token);
    expect(url.searchParams.get('lang')).toBe('uk');
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page.getByTestId('body-editor')).not.toContainText('restart ');
  });

  test('3c. Cancel in the save prompt abandons the restart; No leaves the editor as it is', async ({
    core,
    page,
  }) => {
    await core.rpc('settings.set', { patch: { view: { uiLanguage: 'ru' } } });
    await openApp(core, page);
    await waitForStartupDocument(page);
    await modifyDocument(page);
    const urlBefore = page.url();
    const before = (await core.rpc<RestartRequest[]>('test.restartRequests')).length;

    // Yes, then Cancel in the save prompt: nothing restarts, the document keeps its changes;
    // the new language setting is stored and applies at the next start (it switched live).
    let prompt = await switchLanguage(page, 'en');
    await prompt.getByTestId('dialog-restart-prompt-button-yes').click();
    const save = page.getByTestId('save-changes-prompt');
    await expect(save).toBeVisible();
    await save.getByTestId('save-changes-prompt-button-cancel').click();
    await expect(save).toBeHidden();
    await page.waitForTimeout(500);
    expect(await core.rpc<RestartRequest[]>('test.restartRequests')).toHaveLength(before);
    expect(page.url()).toBe(urlBefore);
    await expect(page).toHaveTitle(/\* - /);
    await expect(page.getByTestId('body-editor')).toContainText('restart ');
    expect((await core.rpc<{ view: { uiLanguage: string } }>('settings.get')).view.uiLanguage).toBe(
      'en',
    );

    // No: nothing at all, not even the save prompt.
    prompt = await switchLanguage(page, 'ru');
    await prompt.getByTestId('dialog-restart-prompt-button-no').click();
    await expect(prompt).toBeHidden();
    await page.waitForTimeout(500);
    await expect(save).toBeHidden();
    expect(await core.rpc<RestartRequest[]>('test.restartRequests')).toHaveLength(before);
    expect(page.url()).toBe(urlBefore);
    await expect(page).toHaveTitle(/\* - /);
    await expect(page.getByTestId('body-editor')).toContainText('restart ');
  });
});

test.describe('US8 - first start follows the system language', () => {
  test.use({ locale: 'ru-RU' });

  test.beforeEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core);
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('2c. a fresh installation on a Russian system starts in Russian', async ({ core, page }) => {
    await openApp(core, page);
    await expect(page.getByTestId('menu-file')).toHaveText('Файл');
    await expect(page.getByTestId('menu-tools')).toHaveText('Сервис');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByTestId('panel-tree-caption')).toHaveText('Структура документа');
    if (core.hasCore) {
      await expect(page.getByTestId('status-message')).toHaveText('Готово');
      const settings = await core.rpc<{ view: { uiLanguage: string } }>('settings.get');
      expect(settings.view.uiLanguage).toBe('system'); // nothing was written: still "system"
      // The Settings dialog shows the "system" choice in Russian.
      await menu(page, 'tools', 'settings');
      await expect(page.getByTestId('dialog-settings-title')).toContainText('Настройки');
      const language = page.getByTestId('settings-view-language');
      await expect(language).toHaveValue('system');
      await expect(language.locator('option:checked')).toHaveText('Как в системе');
      await page.getByTestId('dialog-settings-button-cancel').click();
    } else {
      await expect(page.getByTestId('status-message')).toHaveText('Нет соединения');
    }
  });
});

test.describe('US8 - first start follows the system language (Ukrainian, feature 003)', () => {
  test.use({ locale: 'uk-UA' });

  test.beforeEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core);
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('2d. a fresh installation on a Ukrainian system starts in Ukrainian', async ({
    core,
    page,
  }) => {
    // The browser prefers Ukrainian (`uk-UA`, what the shell derives from a Ukrainian desktop);
    // the start under a Ukrainian core locale (`LANG=uk_UA.UTF-8`) is us1-ukrainian.spec.ts.
    await openApp(core, page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page.getByTestId('menu-file')).toHaveText(uiText('uk', 'menu.file.caption'));
    await expect(page.getByTestId('menu-tools')).toHaveText(uiText('uk', 'menu.tools.caption'));
    await expect(page.getByTestId('menu-help')).toHaveText(uiText('uk', 'menu.help.caption'));
    await expect(page.getByTestId('panel-tree-caption')).toHaveText(uiText('uk', 'tree.caption'));
    if (core.hasCore) {
      await expect(page.getByTestId('status-message')).toHaveText(uiText('uk', 'status.ready'));
      const settings = await core.rpc<{ view: { uiLanguage: string } }>('settings.get');
      expect(settings.view.uiLanguage).toBe('system'); // nothing was written: still "system"
      await menu(page, 'tools', 'settings');
      await expect(page.getByTestId('dialog-settings-title')).toContainText(
        uiText('uk', 'dialog.settings.caption'),
      );
      const language = page.getByTestId('settings-view-language');
      await expect(language).toHaveValue('system');
      await expect(language.locator('option:checked')).toHaveText(
        uiText('uk', 'dialog.settings.view.languageSystem'),
      );
      await page.getByTestId('dialog-settings-button-cancel').click();
    } else {
      await expect(page.getByTestId('status-message')).toHaveText(
        uiText('uk', 'status.notConnected'),
      );
    }
  });
});
