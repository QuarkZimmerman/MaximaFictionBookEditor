/**
 * Feature 003, User Story 1 - The editor speaks Ukrainian (T012; spec FR-001, FR-002, FR-005;
 * quickstart row "1 Ukrainian").
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); the
 * menu walk and the About dialog also run core-less.
 *
 * The walk: started with `?lang=uk`, every visible text of the menu bar (every menu and
 * submenu), the context menus of the Body, Source and Description views and of the Document
 * Tree, the toolbar tooltips, every Settings page, About, the dialogs of a new document, the
 * Description form, a file dialog request and a script's message box is collected and judged
 * by one rule: it must be a value of `uk.json` / `*.uk.json` (placeholders resolved, `&`
 * markers removed, white space and edge punctuation normalised) or stand in
 * `fixtures/uk-allowlist.json` (proper names, hotkey chords, file names, identifiers, versions,
 * paths, URLs, the scripts' own texts). A text found verbatim in the English or Russian
 * catalogues and not in the Ukrainian ones fails the walk whatever the allowlist says. Access
 * keys: every label whose English text has one has one in Ukrainian (catalogues), and the
 * underlined letters are unique within each menu and within each dialog's buttons (page). The
 * genre and language names of the Description form come from the resources, not the
 * catalogues: they are checked against the original editor's Ukrainian lists (`genres.ukr.txt`,
 * `ukr.xsl`). System language: a fresh installation (`uiLanguage: "system"`) whose core runs
 * under `LANG=uk_UA.UTF-8` reports `app.info.systemLanguage === 'uk'` and renders in Ukrainian.
 *
 * The Russian interface, complete since feature 002, walks the same way first as a control:
 * a failure there is a fault of the walk, not of the translation.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fileNew,
  NodeRpcClient,
  parseReadyLine,
  test,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import {
  acceleratorOf,
  catalogueEntries,
  plainText,
  uiText,
  UI_LANGS,
  type UiLang,
} from './fixtures/i18n';

const UI_DIR = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = path.resolve(UI_DIR, '..');
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');

const LANGUAGE_NAMES: Record<UiLang, string> = { en: 'English', ru: 'Russian', uk: 'Ukrainian' };

/* ------------------------------------------------------------------------ */
/* Catalogue model: what the interface may say in a language                 */
/* ------------------------------------------------------------------------ */

interface Allowlist {
  texts: string[];
  patterns: string[];
}

const ALLOWLIST = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/uk-allowlist.json', import.meta.url)), 'utf8'),
) as Allowlist;

/** Punctuation the normalisation strips at both ends (quotes and dashes included). */
const EDGE =
  /^[\s.:;,!?\u2026\u00ab\u00bb"\u201c\u201d\u201e\u2014\u2013-]+|[\s.:;,!?\u2026\u00ab\u00bb"\u201c\u201d\u201e\u2014\u2013-]+$/gu;
const PLACEHOLDER = /\{\{\s*\w+\s*\}\}/u;
const PLACEHOLDERS = /\{\{\s*\w+\s*\}\}/gu;
const LETTERS = /\p{L}/u;
const CYRILLIC = /[\u0400-\u04ff]/u;
const LATIN_WORD = /[A-Za-z]{2,}/u;

/** One comparable form for catalogue values and page texts. */
function normalise(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').replace(EDGE, '').trim();
}

const ALLOWED_TEXTS = new Set(ALLOWLIST.texts.map(normalise));
const ALLOWED_PATTERNS = ALLOWLIST.patterns.map((source) => new RegExp(source, 'u'));

interface Template {
  pattern: RegExp;
  key: string;
}

interface LanguageTexts {
  lang: UiLang;
  /** Normalised visible value (whole value and each of its lines) -> keys. */
  values: Map<string, string[]>;
  /** Values with `{{placeholders}}`: a pattern accepting anything in their place. */
  templates: Template[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A template of a value with placeholders: any text where they stand, literal parts kept. */
function templateOf(normalisedValue: string): RegExp | null {
  const parts = normalisedValue.split(PLACEHOLDERS).map((part) => part.trim());
  if (!parts.some((part) => /\p{L}.*\p{L}/u.test(part))) return null;
  return new RegExp(`^${parts.map(escapeRegExp).join('[\\s\\S]*?')}$`, 'u');
}

const languageTexts = new Map<UiLang, LanguageTexts>();

function textsOf(lang: UiLang): LanguageTexts {
  let texts = languageTexts.get(lang);
  if (texts) return texts;
  texts = { lang, values: new Map(), templates: [] };
  for (const [key, raw] of catalogueEntries(lang)) {
    const plain = plainText(raw);
    for (const variant of new Set([plain, ...plain.split('\n')])) {
      const value = normalise(variant);
      if (!LETTERS.test(value)) continue;
      if (PLACEHOLDER.test(value)) {
        const pattern = templateOf(value);
        if (pattern) texts.templates.push({ pattern, key });
      } else {
        if (!texts.values.has(value)) texts.values.set(value, []);
        texts.values.get(value)!.push(key);
      }
    }
  }
  languageTexts.set(lang, texts);
  return texts;
}

function isAllowed(text: string): boolean {
  return ALLOWED_TEXTS.has(text) || ALLOWED_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Why `text` is wrong in the `target` language (null when it is fine). Order: a value or
 * template of the target language passes; a verbatim value of another interface language
 * fails; the allowlist passes; "A (B)" passes when both parts pass (tooltips with their hotkey,
 * file types with their patterns, names with their code); then, strictly, anything else fails
 * - leniently (data the resources bring, not the catalogues) only texts in Latin letters.
 */
function problemOf(text: string, target: LanguageTexts, strict: boolean): string | null {
  const value = normalise(text);
  if (!LETTERS.test(value)) return null;
  if (target.values.has(value)) return null;
  if (target.templates.some(({ pattern }) => pattern.test(value))) return null;
  for (const lang of UI_LANGS) {
    if (lang === target.lang) continue;
    const other = textsOf(lang);
    const keys = other.values.get(value);
    if (keys) return `"${value}" is the ${LANGUAGE_NAMES[lang]} text of ${keys.join(', ')}`;
    const template = other.templates.find(({ pattern }) => pattern.test(value));
    if (template) {
      return `"${value}" is the ${LANGUAGE_NAMES[lang]} text of ${template.key}`;
    }
  }
  if (isAllowed(value)) return null;
  const parenthesised = /^(.*?)\s*\(([^()]*)\)$/su.exec(value);
  if (parenthesised && parenthesised[1]!.trim()) {
    const head = problemOf(parenthesised[1]!, target, strict);
    const tail = problemOf(parenthesised[2]!, target, strict);
    if (!head && !tail) return null;
    if (head?.includes(' text of ')) return head;
    if (tail?.includes(' text of ')) return tail;
  }
  if (!strict && (!LATIN_WORD.test(value) || CYRILLIC.test(value))) return null;
  return `"${value}" is not in the ${LANGUAGE_NAMES[target.lang]} catalogues`;
}

/* ------------------------------------------------------------------------ */
/* Collecting the visible texts of a region (browser side)                   */
/* ------------------------------------------------------------------------ */

interface TextEntry {
  /** data-testid of the element (or of its nearest holder plus the tag), `@attr` for attributes. */
  where: string;
  /** The text run: consecutive text nodes and `<u>` access-key marks of one element. */
  text: string;
  /** The run's text nodes (an access-key `<u>` glued to its neighbours). */
  pieces: string[];
}

/** Regions whose texts are data (the document's words, suggestions, code), not interface. */
const DATA_REGIONS =
  '[role="grid"], [role="listbox"], tbody, textarea, pre, code, script, style, [aria-hidden="true"]';

/**
 * Snippet collecting every visible text of the element `root` (a CSS selector): the text runs of
 * each element (text nodes and `<u>` marks between child elements), `title` and `placeholder`
 * attributes and `optgroup` labels; elements matching `skip`, data regions and decorations
 * (`aria-hidden`) are left out. Options of a select count as visible when their select is.
 * (The e2e tsconfig has no DOM lib, hence a string.)
 */
function collectorSnippet(root: string, skip: string): string {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(root)});
    if (!root) return null;
    const skip = ${JSON.stringify(skip)};
    const DATA = ${JSON.stringify(DATA_REGIONS)};
    const out = [];
    const isVisible = (el) => {
      if (el.tagName === 'OPTION' || el.tagName === 'OPTGROUP') {
        const select = el.closest('select');
        return !!select && select.checkVisibility();
      }
      return el.checkVisibility({ visibilityProperty: true });
    };
    const whereOf = (el) => {
      const own = el.getAttribute('data-testid');
      if (own) return own;
      const holder = el.closest('[data-testid]');
      const tag = el.tagName.toLowerCase();
      return holder ? holder.getAttribute('data-testid') + ' ' + tag : tag;
    };
    const visit = (el) => {
      if (!isVisible(el)) return;
      if (skip && el.matches(skip)) return;
      if (el.matches(DATA)) return;
      for (const attr of ['title', 'placeholder', 'label']) {
        if (attr === 'label' && el.tagName !== 'OPTGROUP') continue;
        const value = el.getAttribute(attr);
        if (value && value.trim()) {
          out.push({ where: whereOf(el) + '@' + attr, text: value, pieces: [value] });
        }
      }
      let run = '';
      let pieces = [];
      let glue = false;
      const flush = () => {
        if (run.trim()) out.push({ where: whereOf(el), text: run, pieces: pieces.slice() });
        run = '';
        pieces = [];
        glue = false;
      };
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          run += node.data;
          if (glue && pieces.length) pieces[pieces.length - 1] += node.data;
          else pieces.push(node.data);
          glue = false;
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'U') {
          const data = node.textContent || '';
          run += data;
          if (pieces.length) pieces[pieces.length - 1] += data;
          else pieces.push(data);
          glue = true;
        } else {
          flush();
          if (node.nodeType === Node.ELEMENT_NODE) visit(node);
        }
      }
      flush();
    };
    visit(root);
    return out;
  })()`;
}

interface WalkOptions {
  /** CSS selector of elements (with their subtrees) to leave out: user data, dynamic entries. */
  skip?: string;
  /** Unknown texts fail (default); false: only verbatim English / Russian and Latin-only texts. */
  strict?: boolean;
}

/** The texts of the region `testId` that are wrong in `lang`, each with where it was found. */
async function walkProblems(
  page: Page,
  lang: UiLang,
  testId: string,
  name: string,
  options: WalkOptions = {},
): Promise<string[]> {
  const entries = await page.evaluate<TextEntry[] | null>(
    collectorSnippet(`[data-testid="${testId}"]`, options.skip ?? ''),
  );
  if (entries === null) return [`${name}: no element with data-testid="${testId}"`];
  if (entries.length === 0) return [`${name}: no visible text found in ${testId}`];
  const target = textsOf(lang);
  const strict = options.strict ?? true;
  const problems: string[] = [];
  for (const entry of entries) {
    const whole = problemOf(entry.text, target, strict);
    if (!whole) continue;
    // A run of several texts ("label: value", a text beside a link): each piece on its own.
    const pieces = entry.pieces.map((piece) => problemOf(piece, target, strict));
    if (entry.pieces.length > 1 && pieces.every((piece) => !piece)) continue;
    const detail = pieces.filter((piece): piece is string => piece !== null);
    problems.push(
      `${name} ${entry.where}: ${detail.length > 0 && entry.pieces.length > 1 ? detail.join('; ') : whole}`,
    );
  }
  return problems;
}

/** Fails with the first problems listed (and how many more there are). */
function expectNoProblems(problems: string[], what: string): void {
  const shown = problems.slice(0, 40);
  if (problems.length > shown.length) shown.push(`... and ${problems.length - shown.length} more`);
  expect(shown, `${what} must be Ukrainian`).toEqual([]);
}

/* ------------------------------------------------------------------------ */
/* Access keys                                                               */
/* ------------------------------------------------------------------------ */

interface AccessKeyEntry {
  id: string;
  label: string;
  letter: string | null;
}

/** Snippet listing the items (`items` selector under `root`) with their underlined letter. */
function accessKeySnippet(root: string, items: string): string {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(root)});
    if (!root) return null;
    return Array.from(root.querySelectorAll(${JSON.stringify(items)}))
      .filter((item) => item.checkVisibility())
      .map((item) => {
        const label =
          item.querySelector('.mfbe-menu-label') ??
          Array.from(item.children).find((child) => child.tagName === 'SPAN' && !child.className) ??
          item;
        const u = label.querySelector('u');
        return {
          id: item.getAttribute('data-testid') ?? item.tagName.toLowerCase(),
          label: label.textContent ?? '',
          letter: u ? (u.textContent ?? '').toLowerCase() : null,
        };
      });
  })()`;
}

/** The access keys used twice within one menu or dialog (dynamic entries `skipIds` ignored). */
function accessKeyCollisions(
  entries: AccessKeyEntry[],
  group: string,
  skipIds: (id: string) => boolean = () => false,
): string[] {
  const users = new Map<string, string[]>();
  for (const entry of entries) {
    if (skipIds(entry.id) || !entry.letter) continue;
    if (!users.has(entry.letter)) users.set(entry.letter, []);
    users.get(entry.letter)!.push(`${entry.id} "${normalise(entry.label)}"`);
  }
  const problems: string[] = [];
  for (const [letter, items] of users) {
    if (items.length > 1) {
      problems.push(`${group}: access key "${letter}" is used by ${items.join(' and ')}`);
    }
  }
  return problems;
}

/** Access-key collisions among the buttons of the dialog `testId`. */
async function dialogAccessKeyProblems(page: Page, testId: string): Promise<string[]> {
  const entries = await page.evaluate<AccessKeyEntry[] | null>(
    accessKeySnippet(`[data-testid="${testId}"]`, 'button'),
  );
  return accessKeyCollisions(entries ?? [], testId);
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

const MENUS = ['file', 'edit', 'view', 'add', 'style', 'tools', 'scripts', 'help'] as const;

/** Entries of the Scripts menu that come from the catalogue (the rest are script manifests). */
const STATIC_SCRIPT_ITEMS = [
  'menu-scripts-none',
  'menu-scripts-last',
  'menu-scripts-openFolder',
  'menu-scripts-reload',
];

/** Dynamic menu entries - user data, not catalogue texts: script groups and scripts, recent files. */
const DYNAMIC_MENU_ENTRIES = [
  `[data-testid^="menu-scripts-"]:not([data-testid$="-popup"])${STATIC_SCRIPT_ITEMS.map(
    (id) => `:not([data-testid="${id}"])`,
  ).join('')}`,
  '[data-testid^="menu-file-recent-recent"]',
].join(', ');

const isDynamicMenuEntry = (id: string) =>
  (id.startsWith('menu-scripts-') && !id.endsWith('-popup') && !STATIC_SCRIPT_ITEMS.includes(id)) ||
  id.startsWith('menu-file-recent-recent');

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

/** "Ready" in any interface language: the page may not be in the expected one yet. */
const READY_TEXTS = new RegExp(
  `^(${UI_LANGS.map((lang) => escapeRegExp(uiText(lang, 'status.ready'))).join('|')})$`,
);

/** Opens the application with `?lang=` and asserts that the page is in that language. */
async function openApp(core: CoreHandle, page: Page, lang: UiLang): Promise<void> {
  await page.goto(appUrl(core, { lang }));
  await page.getByTestId('app-root').waitFor();
  if (core.hasCore) await expect(page.getByTestId('status-message')).toHaveText(READY_TEXTS);
  await expect(
    page.locator('html'),
    `?lang=${lang} renders the interface in ${LANGUAGE_NAMES[lang]}`,
  ).toHaveAttribute('lang', lang);
  await expect(page.getByTestId('menu-file')).toHaveText(uiText(lang, 'menu.file.caption'));
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Closes an open menu (a hovered submenu takes the first Escape). */
async function closeMenu(page: Page, popup: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3 && (await popup.isVisible()); attempt += 1) {
    await page.keyboard.press('Escape');
  }
  await expect(popup).toBeHidden();
}

/**
 * File > New; returns the editable Body editor. `fileNew` waits for the new document to replace
 * the start-up one (which an assertion on the editor alone would also match).
 */
async function newDocument(page: Page): Promise<Locator> {
  await fileNew(page);
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

function firstParagraph(page: Page): Locator {
  return page.getByTestId('body-editor').locator('.fb-body > .fb-section > p.fb-p').first();
}

/** Puts a collapsed caret into the first paragraph and lets the editor publish it. */
async function caretIntoParagraph(page: Page): Promise<void> {
  await firstParagraph(page).click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ArrowLeft');
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
 * Walks the menu bar: every top-level menu, its items and the items of every catalogue-driven
 * submenu, with the access keys of each popup; returns the problems and the number of items.
 */
async function walkMenus(page: Page, lang: UiLang): Promise<{ problems: string[]; items: number }> {
  const problems: string[] = [];
  let items = 0;
  problems.push(...(await walkProblems(page, lang, 'menubar', 'menu bar')));
  const bar = await page.evaluate<AccessKeyEntry[] | null>(
    accessKeySnippet('[data-testid="menubar"]', 'button[role="menuitem"]'),
  );
  problems.push(...accessKeyCollisions(bar ?? [], 'menu bar'));
  for (const menuId of MENUS) {
    await page.getByTestId(`menu-${menuId}`).click();
    const popupId = `menu-${menuId}-popup`;
    const popup = page.getByTestId(popupId);
    await expect(popup).toBeVisible();
    problems.push(
      ...(await walkProblems(page, lang, popupId, `menu ${menuId}`, {
        skip: DYNAMIC_MENU_ENTRIES,
      })),
    );
    const popupItems = await page.evaluate<AccessKeyEntry[] | null>(
      accessKeySnippet(
        `[data-testid="${popupId}"]`,
        ':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]',
      ),
    );
    problems.push(...accessKeyCollisions(popupItems ?? [], `menu ${menuId}`, isDynamicMenuEntry));
    items += popupItems?.length ?? 0;
    const submenus = popup.locator(':scope > [role="menuitem"][aria-haspopup="true"]');
    const count = await submenus.count();
    for (let index = 0; index < count; index += 1) {
      const item = submenus.nth(index);
      const itemId = (await item.getAttribute('data-testid')) ?? '';
      if (isDynamicMenuEntry(itemId)) continue;
      await item.hover();
      const submenuId = `${itemId}-popup`;
      await expect(page.getByTestId(submenuId)).toBeVisible();
      // The popup's items render a frame after the popup itself (the first entry may also be
      // the "(none)" placeholder of the Recent submenu).
      await expect(page.getByTestId(submenuId).locator('[role="menuitem"]').first()).toBeVisible();
      problems.push(
        ...(await walkProblems(page, lang, submenuId, `submenu ${itemId}`, {
          skip: DYNAMIC_MENU_ENTRIES,
        })),
      );
      const subItems = await page.evaluate<AccessKeyEntry[] | null>(
        accessKeySnippet(
          `[data-testid="${submenuId}"]`,
          '[role="menuitem"], [role="menuitemcheckbox"]',
        ),
      );
      problems.push(
        ...accessKeyCollisions(subItems ?? [], `submenu ${itemId}`, isDynamicMenuEntry),
      );
      items += subItems?.length ?? 0;
    }
    await closeMenu(page, popup);
  }
  return { problems, items };
}

/** Walks the main window's chrome: toolbars (tooltips), view tabs, tree caption, status bar. */
async function walkChrome(page: Page, lang: UiLang): Promise<string[]> {
  const problems: string[] = [];
  for (const [testId, name] of [
    ['toolbars', 'toolbars'],
    ['view-switcher', 'view switcher'],
    ['panel-tree-caption', 'tree caption'],
    ['tree-toolbar', 'tree toolbar'],
    ['statusbar', 'status bar'],
  ] as const) {
    if ((await page.getByTestId(testId).count()) === 0) continue;
    problems.push(...(await walkProblems(page, lang, testId, name)));
  }
  return problems;
}

/** Asserts that the dialog (or panel) `testId` is in `lang`, its buttons' access keys unique. */
async function expectDialogIn(
  page: Page,
  lang: UiLang,
  testId: string,
  name: string,
  options: WalkOptions = {},
): Promise<void> {
  await expect(page.getByTestId(testId)).toBeVisible();
  const problems = [
    ...(await walkProblems(page, lang, testId, name, options)),
    ...(await dialogAccessKeyProblems(page, testId)),
  ];
  expectNoProblems(problems, name);
}

/* ------------------------------------------------------------------------ */
/* The walk in Ukrainian                                                     */
/* ------------------------------------------------------------------------ */

const UK: UiLang = 'uk';

test.describe('US1 (feature 003) - the interface in Ukrainian (?lang=uk)', () => {
  test.afterEach(async ({ core }) => {
    if (core.hasCore) await resetSettings(core).catch(() => {});
  });

  test('0. control: the walk accepts the Russian interface (menus and chrome)', async ({
    core,
    page,
  }) => {
    // The Russian interface is complete (feature 002): a problem here is a fault of the walk.
    await openApp(core, page, 'ru');
    const { problems, items } = await walkMenus(page, 'ru');
    problems.push(...(await walkChrome(page, 'ru')));
    expect(items).toBeGreaterThan(50);
    expect(problems, 'the walk must accept the Russian interface').toEqual([]);
  });

  test('0b. every label with an English access key has a Ukrainian one (catalogues)', () => {
    const english = catalogueEntries('en');
    const ukrainian = catalogueEntries('uk');
    const missing: string[] = [];
    for (const [key, value] of english) {
      if (acceleratorOf(value) === null) continue;
      const uk = ukrainian.get(key);
      if (uk === undefined || acceleratorOf(uk) === null) {
        missing.push(`${key}: "${value}" -> ${uk === undefined ? 'missing' : `"${uk}"`}`);
      }
    }
    expect(missing, 'Ukrainian labels without the access key the English ones have').toEqual([]);
  });

  test('1. every menu, submenu item and the window chrome are Ukrainian with unique access keys', async ({
    core,
    page,
  }) => {
    await openApp(core, page, UK);
    await expect(page.getByTestId('panel-tree-caption')).toHaveText(uiText(UK, 'tree.caption'));
    const { problems, items } = await walkMenus(page, UK);
    problems.push(...(await walkChrome(page, UK)));
    expect(items).toBeGreaterThan(50);
    expectNoProblems(problems, 'the menus and the window chrome');
    // Toolbar tooltips follow the language too.
    await expect(page.getByTestId('toolbar-file.new')).toHaveAttribute(
      'title',
      new RegExp(`^${escapeRegExp(uiText(UK, 'cmd.file.new.tooltip'))}`),
    );
  });

  test('2. the context menus of the Body, Source and Description views and of the tree', async ({
    core,
    page,
  }) => {
    test.skip(!(await supportsDocuments(core)), 'needs mfbe-core with doc.* (MFBE_CORE_BIN)');
    await resetSettings(core);
    await openApp(core, page, UK);
    await newDocument(page);
    const problems: string[] = [];

    // Body: Undo, Cut, Copy, Paste, Select <element>...
    await caretIntoParagraph(page);
    await firstParagraph(page).click({ button: 'right', position: { x: 8, y: 8 } });
    const bodyMenu = page.getByTestId('context-menu');
    await expect(bodyMenu).toBeVisible();
    problems.push(...(await walkProblems(page, UK, 'context-menu', 'Body context menu')));
    await page.keyboard.press('Escape');
    await expect(bodyMenu).toBeHidden();

    // Document Tree: View, View Source, Move..., Merge, Delete.
    const row = page.locator('[data-testid^="tree-row-"]').first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const treeMenu = page.getByTestId('tree-menu');
    await expect(treeMenu).toBeVisible();
    // The tree commands of scripts carry the scripts' own texts (spec FR-002).
    problems.push(
      ...(await walkProblems(page, UK, 'tree-menu', 'tree context menu', {
        skip: '[data-testid^="tree-menu-script-"]',
      })),
    );
    const treeItems = await page.evaluate<AccessKeyEntry[] | null>(
      accessKeySnippet('[data-testid="tree-menu"]', '[role="menuitem"]'),
    );
    problems.push(
      ...accessKeyCollisions(treeItems ?? [], 'tree context menu', (id) =>
        id.startsWith('tree-menu-script-'),
      ),
    );
    await page.keyboard.press('Escape');
    await expect(treeMenu).toBeHidden();

    // Description: the field menu (Undo, Cut, Copy, Paste).
    await page.getByTestId('view-description').click();
    const title = page.getByTestId('description-book-title');
    await expect(title).toBeVisible();
    await title.click({ button: 'right' });
    const fieldMenu = page.getByTestId('context-menu');
    await expect(fieldMenu).toBeVisible();
    problems.push(...(await walkProblems(page, UK, 'context-menu', 'Description field menu')));
    await page.keyboard.press('Escape');
    await expect(fieldMenu).toBeHidden();

    // Source: Undo, Redo, Cut, Copy, Paste, Delete, Select All.
    await page.getByTestId('view-source').click();
    const source = page.getByTestId('source-editor');
    await expect(source).toContainText('FictionBook');
    await source.click({ button: 'right' });
    const sourceMenu = page.getByTestId('source-context-menu');
    await expect(sourceMenu).toBeVisible();
    problems.push(...(await walkProblems(page, UK, 'source-context-menu', 'Source context menu')));
    await page.keyboard.press('Escape');
    await expect(sourceMenu).toBeHidden();

    expectNoProblems(problems, 'the context menus');
  });

  test('3. every page of the Settings dialog; the language choice lists System, English, Russian, Ukrainian', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'the Settings dialog needs mfbe-core (MFBE_CORE_BIN)');
    await resetSettings(core);
    await openApp(core, page, UK);
    await menu(page, 'tools', 'settings');
    const settings = page.getByTestId('dialog-settings');
    await expect(settings).toBeVisible();
    await expect(settings.getByTestId('dialog-settings-title')).toContainText(
      uiText(UK, 'dialog.settings.caption'),
    );
    const problems: string[] = [];
    const tabs = settings.locator('[data-testid^="settings-tab-"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < tabCount; index += 1) {
      const tab = tabs.nth(index);
      const id = ((await tab.getAttribute('data-testid')) ?? '').replace('settings-tab-', '');
      await tab.click();
      await expect(settings.getByTestId(`settings-page-${id}`)).toBeVisible();
      problems.push(...(await walkProblems(page, UK, 'dialog-settings', `Settings/${id}`)));
    }
    problems.push(...(await dialogAccessKeyProblems(page, 'dialog-settings')));
    expectNoProblems(problems, 'the Settings pages');

    // FR-001: the language choice; `?lang=uk` forces this session only, the setting is "system".
    await settings.getByTestId('settings-tab-view').click();
    const language = settings.getByTestId('settings-view-language');
    await expect(language).toHaveValue('system');
    await expect(language.locator('option')).toHaveText([
      uiText(UK, 'dialog.settings.view.languageSystem'),
      uiText(UK, 'dialog.settings.view.languageEn'),
      uiText(UK, 'dialog.settings.view.languageRu'),
      uiText(UK, 'dialog.settings.view.languageUk'),
    ]);
    expect(
      await language
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(['system', 'en', 'ru', 'uk']);
    await settings.getByTestId('dialog-settings-button-cancel').click();
    await expect(settings).toBeHidden();
  });

  test('4. the About dialog is Ukrainian', async ({ core, page }) => {
    await openApp(core, page, UK);
    await menu(page, 'help', 'about');
    const about = page.getByTestId('dialog-about');
    await expectDialogIn(page, UK, 'dialog-about', 'About');
    await expect(about.getByTestId('dialog-about-title')).toContainText(
      uiText(UK, 'dialog.about.caption'),
    );
    await expect(about.getByTestId('dialog-about-button-close')).toHaveText(
      uiText(UK, 'dialog.buttons.close'),
    );
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
  });

  test('5. the dialogs of a new document are Ukrainian', async ({ core, page }) => {
    test.skip(!(await supportsDocuments(core)), 'needs mfbe-core with doc.* (MFBE_CORE_BIN)');
    await resetSettings(core);
    await openApp(core, page, UK);
    await newDocument(page);
    await expect(page).toHaveTitle(new RegExp(`^${escapeRegExp(uiText(UK, 'app.untitled'))}`));

    // Find / Replace (the Find fields are shared).
    await menu(page, 'edit', 'find');
    await expectDialogIn(page, UK, 'dialog-find', 'Find');
    await expect(page.getByTestId('dialog-find-title')).toContainText(
      uiText(UK, 'dialog.find.caption'),
    );
    await page.getByTestId('dialog-find-button-cancel').click();
    await expect(page.getByTestId('dialog-find')).toBeHidden();

    await menu(page, 'edit', 'replace');
    await expectDialogIn(page, UK, 'dialog-replace', 'Replace');
    await expect(page.getByTestId('dialog-replace-title')).toContainText(
      uiText(UK, 'dialog.replace.caption'),
    );
    await page.getByTestId('dialog-replace-button-cancel').click();
    await expect(page.getByTestId('dialog-replace')).toBeHidden();

    // Words (the word list itself is the document's data).
    await menu(page, 'tools', 'words');
    const words = page.getByTestId('dialog-words');
    await expect(words.getByTestId('words-loading')).toHaveCount(0);
    await expectDialogIn(page, UK, 'dialog-words', 'Words');
    await expect(words.getByTestId('dialog-words-title')).toContainText(
      uiText(UK, 'dialog.words.caption'),
    );
    await words.getByTestId('dialog-words-button-cancel').click();
    await expect(words).toBeHidden();

    // Spelling (when the core ships dictionaries and the checker is enabled): a misspelled word
    // keeps the dialog open at its first stop. The dictionary names are tags (`uk_UA`).
    await caretIntoParagraph(page);
    await page.keyboard.type('превет ');
    await expect(firstParagraph(page)).toContainText('превет');
    await page.getByTestId('menu-tools').click();
    const spellItem = page.getByTestId('menu-tools-spellcheck');
    if ((await spellItem.getAttribute('aria-disabled')) !== 'true') {
      await spellItem.click();
      const spelling = page.getByTestId('dialog-spelling');
      await expect(spelling.getByTestId('spelling-not-in-dictionary')).not.toHaveValue('');
      await expectDialogIn(page, UK, 'dialog-spelling', 'Spelling');
      await expect(spelling.getByTestId('dialog-spelling-title')).toContainText(
        uiText(UK, 'dialog.spelling.caption'),
      );
      await spelling.getByTestId('dialog-spelling-button-close').click();
      await expect(spelling).toBeHidden();
    } else {
      await page.keyboard.press('Escape');
    }

    // Table properties (caret in a paragraph).
    await caretIntoParagraph(page);
    await menu(page, 'add', 'table');
    await expectDialogIn(page, UK, 'dialog-table', 'Table');
    await page.getByTestId('dialog-table-button-cancel').click();
    await expect(page.getByTestId('dialog-table')).toBeHidden();

    // Link... (needs a selection).
    await selectInParagraph(page, 4);
    await menu(page, 'style', 'link');
    await expectDialogIn(page, UK, 'dialog-link', 'Link');
    await page.getByTestId('dialog-link-button-cancel').click();
    await expect(page.getByTestId('dialog-link')).toBeHidden();

    // "Insert clear image?" prompt; "No" opens the (pre-answered, cancelled) file dialog.
    await caretIntoParagraph(page);
    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await menu(page, 'add', 'image');
    const prompt = page.getByTestId('dialog-insert-clear-image');
    await expectDialogIn(page, UK, 'dialog-insert-clear-image', 'Insert clear image');
    await expect(prompt).toContainText(uiText(UK, 'dialog.addImage.insertClear').split('\n')[0]!);
    await prompt.getByTestId('dialog-insert-clear-image-button-no').click();
    await expect(prompt).toBeHidden();

    // Validation panel (the issue list is data from the core).
    await menu(page, 'file', 'validate');
    const validation = page.getByTestId('validation-panel');
    await expectDialogIn(page, UK, 'validation-panel', 'Validation');
    await expect(validation.getByTestId('validation-title')).toContainText(
      uiText(UK, 'dialog.validation.caption'),
    );
    await validation.getByTestId('validation-close').click();
    await expect(validation).toBeHidden();
  });

  test('6. the Description form: labels Ukrainian, genre and language names after the original', async ({
    core,
    page,
  }) => {
    test.skip(!(await supportsDocuments(core)), 'needs mfbe-core with doc.* (MFBE_CORE_BIN)');
    await resetSettings(core);
    await openApp(core, page, UK);
    await newDocument(page);
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-view')).toBeVisible();

    // The form's own texts come from the catalogues; the language and genre names from the
    // resources (lenient: no English or Russian text anywhere, not even in the names).
    const problems = await walkProblems(page, UK, 'description-view', 'Description', {
      strict: false,
    });
    await page.getByTestId('description-genre-add').click();
    const picker = page.getByTestId('genre-picker');
    await expect(picker).toBeVisible();
    problems.push(
      ...(await walkProblems(page, UK, 'genre-picker', 'Genre picker', { strict: false })),
      ...(await dialogAccessKeyProblems(page, 'genre-picker')),
    );
    expectNoProblems(problems, 'the Description form');

    // Genre names of the original's Ukrainian list (`genres.ukr.txt`).
    await expect(page.getByTestId('genre-picker-option-sf_history')).toHaveText(
      'Альтернативна історія (sf_history)',
    );
    await expect(page.getByTestId('genre-picker-option-prose_classic')).toHaveText(
      'Класична проза (prose_classic)',
    );
    const sfGroup = page.getByTestId('genre-picker-group-sf');
    await expect(sfGroup).not.toHaveAttribute('label', /Фэнтези|Fantasy/);
    await expect(sfGroup).toHaveAttribute('label', CYRILLIC);
    await page.getByTestId('genre-picker-button-cancel').click();
    await expect(picker).toBeHidden();

    // Language names and groups of the original's Ukrainian form (`ukr.xsl`).
    const lang = page.getByTestId('description-lang');
    await expect(lang.locator('option[value="uk"]')).toHaveText('Українська (uk)');
    await expect(lang.locator('option[value="en"]')).toHaveText('Англійська (en)');
    await expect(lang.locator('option[value="ru"]')).toHaveText('Російська (ru)');
    await expect(lang.locator('optgroup').first()).toHaveAttribute('label', 'Основні');
  });

  test('7. a file dialog request carries Ukrainian type names and title', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const records = await core
      .rpc('test.dialogRequests')
      .then(() => true)
      .catch(() => false);
    test.skip(!records, 'the core does not record dialog requests');
    await openApp(core, page, UK);
    const before = (await core.rpc<unknown[]>('test.dialogRequests')).length;
    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await menu(page, 'file', 'open');
    let requests: { title: string; filters?: { name: string }[] }[] = [];
    await expect
      .poll(async () => {
        requests = await core.rpc('test.dialogRequests');
        return requests.length;
      })
      .toBeGreaterThan(before);
    const request = requests[before]!;
    const names = (request.filters ?? []).map((filter) => filter.name);
    expect(names).toEqual([
      `${uiText(UK, 'fileDialogs.types.fictionBook')} (*.fb2)`,
      `${uiText(UK, 'fileDialogs.types.fictionBookDescriptors')} (*.fbd)`,
      `${uiText(UK, 'fileDialogs.types.all')} (*.*)`,
    ]);
    const problems = [request.title, ...names]
      .map((text) => problemOf(text, textsOf(UK), true))
      .filter((problem): problem is string => problem !== null);
    expect(problems, 'the file dialog request must be Ukrainian').toEqual([]);
  });

  test("8. a script's message box: the script's text as the script has it, the buttons Ukrainian", async ({
    core,
    page,
  }) => {
    test.skip(!(await supportsDocuments(core)), 'needs mfbe-core with doc.* (MFBE_CORE_BIN)');
    // The fixture script (English and Russian texts only) in the per-worker scripts folder.
    const target = path.join(core.dataDir!, 'scripts', '02_Dialogs');
    if (!existsSync(target)) {
      cpSync(path.join(SCRIPT_FIXTURES, '02_Dialogs'), target, { recursive: true });
      await core.rpc('scripts.reload');
    }
    await resetSettings(core);
    await openApp(core, page, UK);
    await newDocument(page);
    await expect
      .poll(
        () =>
          page.evaluate<number>(
            `window.__mfbeTest?.scripts?.list().filter((s) => s.id === 'test.dialogs.message').length ?? -1`,
          ),
        { timeout: 15_000 },
      )
      .toBe(1);
    await page.evaluate(`void window.__mfbeTest.scripts.run('test.dialogs.message')`);

    const message = page.getByTestId('dialog-script-message');
    await expect(message).toBeVisible();
    // FR-002: the script's own text and caption stay as the script has them (English here)...
    await expect(message.getByTestId('dialog-script-message-text')).toHaveText(
      'Insert a paragraph?',
    );
    await expect(message.getByTestId('dialog-script-message-title')).toContainText('Fixture');
    // ... while the standard buttons the editor adds follow the interface language.
    await expect(message.getByTestId('dialog-script-message-button-yes')).toHaveText(
      uiText(UK, 'dialog.buttons.yes'),
    );
    await expect(message.getByTestId('dialog-script-message-button-no')).toHaveText(
      uiText(UK, 'dialog.buttons.no'),
    );
    await expectDialogIn(page, UK, 'dialog-script-message', 'script message');
    await message.getByTestId('dialog-script-message-button-yes').click();

    const prompt = page.getByTestId('dialog-script-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByTestId('dialog-script-prompt-input')).toHaveValue(
      'Hello from InputBox',
    );
    await expect(prompt.getByTestId('dialog-script-prompt-button-ok')).toHaveText(
      uiText(UK, 'dialog.buttons.ok'),
    );
    await expect(prompt.getByTestId('dialog-script-prompt-button-cancel')).toHaveText(
      uiText(UK, 'dialog.buttons.cancel'),
    );
    await expectDialogIn(page, UK, 'dialog-script-prompt', 'script prompt');
    await prompt.getByTestId('dialog-script-prompt-button-cancel').click();
    await expect(prompt).toBeHidden();
  });
});

/* ------------------------------------------------------------------------ */
/* First start on a Ukrainian system                                        */
/* ------------------------------------------------------------------------ */

/**
 * A second core started under a Ukrainian system locale (the worker's core has no hook for the
 * environment); the same `serve` invocation as fixtures/core.ts.
 */
async function startCoreUnderLocale(
  binary: string,
  dataDir: string,
  locale: string,
): Promise<{ url: string; rpc: NodeRpcClient; stop: () => Promise<void> }> {
  const uiDist = process.env.MFBE_UI_DIST ?? path.join(UI_DIR, 'dist');
  const args = ['serve', '--test-hooks', '--data-dir', dataDir, '--ui', uiDist];
  if (process.env.MFBE_RESOURCES) args.push('--resources', process.env.MFBE_RESOURCES);
  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MFBE_E2E: '1',
      LANG: locale,
      LC_ALL: locale,
      LC_MESSAGES: locale,
      LANGUAGE: '',
    },
  });
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));
  const ready = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`core under ${locale} not ready in 30 s\n${stderr.join('')}`)),
      30_000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        const parsed = parseReadyLine(line);
        if (parsed) {
          clearTimeout(timer);
          resolve(parsed);
          return;
        }
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`core under ${locale} exited with ${code}\n${stderr.join('')}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`cannot start ${binary}: ${error.message}`));
    });
  });
  const rpc = new NodeRpcClient(`ws://127.0.0.1:${ready.port}/rpc?token=${ready.token}`);
  return {
    url: `http://127.0.0.1:${ready.port}/?token=${encodeURIComponent(ready.token)}`,
    rpc,
    stop: async () => {
      rpc.close();
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5_000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
  };
}

test.describe('US1 (feature 003) - first start follows a Ukrainian system language', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('9. with the setting "system" and the core under LANG=uk_UA.UTF-8 the editor starts in Ukrainian', async ({
    page,
  }) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us1-uk-'));
    const own = await startCoreUnderLocale(process.env.MFBE_CORE_BIN!, dataDir, 'uk_UA.UTF-8');
    try {
      // Nothing was ever stored: the setting is "system"; the core reports the detected code.
      const info = await own.rpc.call<{ systemLanguage?: string; uiLanguage?: string }>('app.info');
      expect(info.systemLanguage, 'app.info.systemLanguage').toBe('uk');
      expect(info.uiLanguage, 'app.info.uiLanguage stays the stored setting').toBe('system');

      // The browser prefers English (the default of every engine): the core's language decides.
      await page.goto(own.url);
      await page.getByTestId('app-root').waitFor();
      await expect(page.getByTestId('status-message')).toHaveText(READY_TEXTS);
      await expect(
        page.locator('html'),
        'a first start on a Ukrainian system renders the interface in Ukrainian',
      ).toHaveAttribute('lang', 'uk');
      await expect(page.getByTestId('menu-file')).toHaveText(uiText(UK, 'menu.file.caption'));
      await expect(page.getByTestId('menu-tools')).toHaveText(uiText(UK, 'menu.tools.caption'));
      await expect(page.getByTestId('panel-tree-caption')).toHaveText(uiText(UK, 'tree.caption'));
      await expect(page.getByTestId('status-message')).toHaveText(uiText(UK, 'status.ready'));
      const { problems } = await walkMenus(page, UK);
      expectNoProblems(problems, 'the menus of a first start on a Ukrainian system');

      // Nothing was written: the Settings dialog shows the "system" choice, in Ukrainian.
      const settings = await own.rpc.call<{ view: { uiLanguage: string } }>('settings.get');
      expect(settings.view.uiLanguage).toBe('system');
      await menu(page, 'tools', 'settings');
      await expect(page.getByTestId('dialog-settings-title')).toContainText(
        uiText(UK, 'dialog.settings.caption'),
      );
      const language = page.getByTestId('settings-view-language');
      await expect(language).toHaveValue('system');
      await expect(language.locator('option:checked')).toHaveText(
        uiText(UK, 'dialog.settings.view.languageSystem'),
      );
      await page.getByTestId('dialog-settings-button-cancel').click();
    } finally {
      await own.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
