/**
 * Feature 004, User Story 9 - Spell checking leaves the description alone (T071; spec FR-080,
 * FR-081, SC-009; research R1.4).
 *
 * Tagged `@platform`: the dictionaries ship in `resources/` and the hooks-enabled core of each
 * e2e leg runs them, so the Russian marks, the dialog's stops and the attribute checks hold on
 * Windows and macOS as SC-009 asks, not only on Linux. Runs against the real core
 * (`MFBE_CORE_BIN`); skipped in core-less mode.
 *
 * The book `tests/fixtures/books/spelling-scope-ru.fb2` (`spelling-scope-ru.expected.json`):
 * a Russian book with 30 English words spread over its description - publisher, keywords,
 * city, book name, a plain custom-info row and the source title info's annotation - and 10
 * misspelt Russian words, 6 in the body and 4 in the annotation. The scenarios:
 *
 *  1. with highlighting on, the Body view marks exactly the 10 words (4 in the annotation
 *     block, 6 in the bodies) and the Description view marks nothing - no field of it is
 *     checked, the source title info's annotation included (FR-080);
 *  2. the Spelling dialog stops 10 times, at the annotation words (with suggestions) and the
 *     body words, never at a description field - also when it is started from the Description
 *     view, where it is available as on release 0.0.3 (FR-080, scenario 4);
 *  3. `tools.spellcheck` (menu item and toolbar button) and `tools.spellHighlight` (Shift+F7)
 *     are available in every view exactly as on 0.0.3 - pinned: the Body-only command of the
 *     first draft was removed at the re-alignment of 2026-10-20;
 *  4. the browser engine's own checker is kept off the page: `spellcheck="false"` on the app
 *     root and every input, text area and editable element in every view and with Find,
 *     Replace, Words, Settings and Spelling open; a dialog field with pasted book text shows no
 *     mark (FR-081 - the engine's marks are not part of the page, so the attribute and the
 *     shell's preference line are what the automated checks verify).
 *
 * Nothing here assumes a Linux path, a locale or a shell tool (ui/README.md).
 */

import { readFileSync } from 'node:fs';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageLang, uiText } from './fixtures/i18n';

interface Expectations {
  lang: string;
  misspelled: { word: string; correct: string; path: string }[];
  bodyCount: number;
  annotationCount: number;
  english: { count: number; fields: Record<string, string> };
}

const BOOK = fixtureBook('spelling-scope-ru.fb2');
const EXPECTED = JSON.parse(
  readFileSync(fixtureBook('spelling-scope-ru.expected.json'), 'utf8'),
) as Expectations;
const MISSPELLED = EXPECTED.misspelled.map((entry) => entry.word);

type View = 'body' | 'description' | 'source';
const VIEWS: readonly View[] = ['body', 'description', 'source'];

/** The dialog's "In:" element of a misspelt word, from the structural path of its paragraph. */
function whereOf(path: string): 'annotation' | 'history' | 'body' {
  if (path.startsWith('title-info/annotation')) return 'annotation';
  if (path.startsWith('document-info/history')) return 'history';
  return 'body';
}

/** Description fields of the fixture that carry the English words (test id -> value). */
const ENGLISH_FIELDS: Record<string, string> = {
  'description-publish-publisher': EXPECTED.english.fields['publishInfo.publisher']!,
  'description-keywords': EXPECTED.english.fields['titleInfo.keywords']!,
  'description-publish-city': EXPECTED.english.fields['publishInfo.city']!,
  'description-publish-book-name': EXPECTED.english.fields['publishInfo.bookName']!,
  'description-custom-0-text': EXPECTED.english.fields['customInfo.0']!,
};

/**
 * Browser-side snippet (the e2e tsconfig has no DOM lib, hence a string): the engine's
 * spell-check state of the page - the app root's attribute and every input, text area and
 * editable element whose resolved `spellcheck` state is not false (the HTML `spellcheck` state
 * is inherited, so `element.spellcheck` reports the resolved state).
 */
const ENGINE_STATE = `(() => {
  const root = document.querySelector('[data-testid="app-root"]');
  const fields = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')];
  const describe = (e) => (e.getAttribute('data-testid') || e.tagName.toLowerCase() + '.' + e.className);
  return {
    root: root ? root.getAttribute('spellcheck') : null,
    fields: fields.length,
    allOff: fields.every((e) => e.spellcheck === false),
    offenders: fields.filter((e) => e.spellcheck !== false).map(describe),
    marks: document.querySelectorAll('.mfbe-misspelled').length,
  };
})()`;

interface EngineState {
  root: string | null;
  fields: number;
  allOff: boolean;
  offenders: string[];
  marks: number;
}

async function engineState(page: Page): Promise<EngineState> {
  return page.evaluate<EngineState>(ENGINE_STATE);
}

/** FR-081: the root attribute and every editable field refuse the engine's checker. */
async function expectEngineOff(page: Page, what: string): Promise<void> {
  const state = await engineState(page);
  expect(state.root, `${what}: app-root spellcheck`).toBe('false');
  expect(state.fields, `${what}: editable fields present`).toBeGreaterThan(0);
  expect(state.offenders, `${what}: fields the engine may check`).toEqual([]);
  expect(state.allOff, `${what}: every field off`).toBe(true);
}

async function supportsSpelling(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('spell.dictionaries')
    .then((list) => Array.isArray(list) && list.length >= 2)
    .catch((error: RpcCallError) => error.code !== -32601 && false);
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function openBook(core: CoreHandle, page: Page): Promise<Locator> {
  await core.openApp(page);
  const lang = await pageLang(page);
  await expect(page.getByTestId('status-message')).toHaveText(uiText(lang, 'status.ready'));
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await menu(page, 'file', 'open');
  await waitForBook(page, BOOK);
  const editor = page.getByTestId('body-editor');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

async function showView(page: Page, view: View): Promise<void> {
  await page.getByTestId(`view-${view}`).click();
  await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', view);
  if (view === 'body') {
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  } else if (view === 'description') {
    await expect(page.getByTestId('description-view')).toBeVisible();
  } else {
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  }
}

const misspelled = (scope: Locator | Page) => scope.locator('.mfbe-misspelled');

async function misspelledWords(scope: Locator | Page): Promise<string[]> {
  return misspelled(scope).evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
}

async function spellHighlight(core: CoreHandle): Promise<boolean> {
  const settings = await core.rpc<{ view: { spellHighlight: boolean } }>('settings.get');
  return settings.view.spellHighlight;
}

/**
 * Shift+F7 (`tools.spellHighlight`) and the setting's new value as the core records it. The
 * page applies the answer of its own `settings.set` a moment after the core recorded it: a
 * short settle keeps the next press from reading the previous value.
 */
async function toggleHighlight(
  page: Page,
  core: CoreHandle,
  expected: boolean,
  what: string,
): Promise<void> {
  await page.keyboard.press('Shift+F7');
  await expect.poll(() => spellHighlight(core), { message: what }).toBe(expected);
  await page.waitForTimeout(250);
}

/**
 * Walks the Spelling dialog from its first stop to the completion message with Ignore,
 * asserting the 10 stops of the fixture in order: the word, the "In:" text (never a
 * description field) and, at the annotation words, the suggestions.
 */
async function walkDialog(page: Page, lang: Awaited<ReturnType<typeof pageLang>>): Promise<void> {
  const dialog = page.getByTestId('dialog-spelling');
  await expect(dialog).toBeVisible();
  const word = dialog.getByTestId('spelling-not-in-dictionary');
  const status = dialog.getByTestId('spelling-status');
  const suggestions = () => dialog.locator('[data-testid^="spelling-suggestion-"]').allInnerTexts();
  let stops = 0;
  for (const entry of EXPECTED.misspelled) {
    await expect(word).toHaveValue(entry.word);
    const where = whereOf(entry.path);
    expect(['annotation', 'history', 'body']).toContain(where);
    await expect(status).toHaveText(
      uiText(lang, 'spell.dialog.location', { where: uiText(lang, `spell.dialog.where.${where}`) }),
    );
    if (where === 'annotation') {
      // A word of the annotation block is offered suggestions like a body word (scenario 3).
      await expect(dialog.getByTestId('spelling-suggestion-0')).toBeVisible();
      expect((await suggestions()).length).toBeGreaterThan(0);
    }
    stops += 1;
    await dialog.getByTestId('spelling-ignore').click();
  }
  expect(stops).toBe(10);
  const complete = page.getByTestId('spelling-complete');
  await expect(complete).toBeVisible();
  await expect(complete).toContainText(uiText(lang, 'msg.spellingComplete'));
  await complete.getByTestId('spelling-complete-button-ok').click();
  await expect(dialog).toHaveCount(0);
}

test.describe('US9 (004) - spell checking leaves the description alone @platform', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsSpelling(core)), 'the core has no spell.* / dictionaries');
    // Highlighting on, an empty custom dictionary: every scenario starts the same way (the
    // worker's core is shared).
    await core.rpc('settings.set', {
      patch: { view: { spellEnabled: true, spellHighlight: true } },
    });
    const words = await core.rpc<string[]>('spell.customWords');
    for (const word of words) await core.rpc('spell.removeWord', { word });
  });

  test('1. the 10 misspelt words are marked in the Body view, 4 of them in the annotation block; the Description view marks nothing', async ({
    core,
    page,
  }) => {
    expect(EXPECTED.lang).toBe('ru');
    expect(MISSPELLED).toHaveLength(10);
    expect(EXPECTED.annotationCount + EXPECTED.bodyCount).toBe(10);
    expect(EXPECTED.english.count).toBe(30);

    const editor = await openBook(core, page);
    // The Russian dictionary is opened on its first use; from the first mark the whole set is
    // there within the budget of a second.
    await expect
      .poll(async () => (await misspelledWords(editor)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const shownAt = Date.now();
    await expect.poll(() => misspelledWords(editor), { timeout: 1000 }).toEqual(MISSPELLED);
    expect(Date.now() - shownAt).toBeLessThan(1500);
    // 4 in the annotation block above the bodies, 6 in the book text (SC-009).
    await expect(misspelled(page.getByTestId('body-block-annotation'))).toHaveCount(
      EXPECTED.annotationCount,
    );
    await expect(misspelled(editor.locator('.fb-body'))).toHaveCount(EXPECTED.bodyCount);
    expect(await misspelledWords(page.getByTestId('body-block-annotation'))).toEqual(
      EXPECTED.misspelled.filter((e) => whereOf(e.path) === 'annotation').map((e) => e.word),
    );
    // The history block holds correct Russian only: no mark.
    await expect(misspelled(page.getByTestId('body-block-history'))).toHaveCount(0);
    // A marked annotation word offers suggestions in the context menu, like a body word.
    await page
      .getByTestId('body-block-annotation')
      .locator('.mfbe-misspelled', { hasText: MISSPELLED[0]! })
      .click({ button: 'right' });
    const contextMenu = page.getByTestId('context-menu');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.getByTestId('context-menu-spelling-0')).toBeVisible({
      timeout: 3000,
    });
    await page.keyboard.press('Escape');
    await expect(contextMenu).toHaveCount(0);

    // The Description view: the English words are there, in their fields, and nothing is
    // marked - not the fields, not the rich annotation of the source title info.
    await showView(page, 'description');
    for (const [testId, value] of Object.entries(ENGLISH_FIELDS)) {
      await expect(page.getByTestId(testId), testId).toHaveValue(value);
    }
    await expect(page.getByTestId('description-sti-annotation')).toContainText(
      EXPECTED.english.fields['srcTitleInfo.annotation']!,
    );
    // The Russian misspellings of the annotation are shown in the Description view's own
    // annotation field too - and not marked there either (FR-080: the Body view alone).
    await expect(page.getByTestId('description-annotation')).toContainText(MISSPELLED[0]!);
    expect((await engineState(page)).marks).toBe(0);
    await expect(misspelled(page)).toHaveCount(0);
    await page.waitForTimeout(1200); // the checker's one-second budget: still nothing
    await expect(misspelled(page)).toHaveCount(0);

    // The Source view marks nothing either; back in the Body view the 10 marks are there.
    await showView(page, 'source');
    await expect(misspelled(page)).toHaveCount(0);
    await showView(page, 'body');
    await expect.poll(() => misspelledWords(page.getByTestId('body-editor'))).toEqual(MISSPELLED);
  });

  test('2. the Spelling dialog stops 10 times and never at a description field - from the Body view and from the Description view', async ({
    core,
    page,
  }) => {
    const editor = await openBook(core, page);
    const lang = await pageLang(page);
    await expect.poll(() => misspelledWords(editor), { timeout: 10_000 }).toEqual(MISSPELLED);

    // From the Body view (Tools > Spelling).
    await menu(page, 'tools', 'spellcheck');
    await walkDialog(page, lang);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'body');

    // From the Description view: the command is available as on release 0.0.3, the dialog
    // checks the Body text - the blocks and the bodies - and the view stays (scenario 4).
    await showView(page, 'description');
    await menu(page, 'tools', 'spellcheck');
    await walkDialog(page, lang);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'description');
    await expect(misspelled(page)).toHaveCount(0);

    // ... and from the Source view, by its key.
    await showView(page, 'source');
    await page.keyboard.press('F7');
    await walkDialog(page, lang);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'source');
  });

  test('3. the Spelling command and the highlighting toggle are available in every view as on 0.0.3', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    for (const view of VIEWS) {
      await showView(page, view);
      // The menu item and the toolbar button of tools.spellcheck.
      await page.getByTestId('menu-tools').click();
      const item = page.getByTestId('menu-tools-spellcheck');
      await expect(item, `${view}: Tools > Spelling`).toBeVisible();
      await expect(item, `${view}: Tools > Spelling`).not.toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('menu-tools-spellcheck')).toHaveCount(0);
      await expect(page.getByTestId('toolbar-tools.spellcheck'), `${view}: toolbar`).toBeEnabled();
      // tools.spellHighlight (Shift+F7) toggles the setting in this view too.
      expect(await spellHighlight(core)).toBe(true);
      await toggleHighlight(page, core, false, `${view}: Shift+F7 off`);
      if (view === 'body') await expect(misspelled(page)).toHaveCount(0);
      await toggleHighlight(page, core, true, `${view}: Shift+F7 on`);
      if (view === 'body') await expect(misspelled(page)).toHaveCount(10);
      // The dialog opens from the toolbar in this view and is closed again.
      await page.getByTestId('toolbar-tools.spellcheck').click();
      const dialog = page.getByTestId('dialog-spelling');
      await expect(dialog, `${view}: dialog from the toolbar`).toBeVisible();
      await expect(dialog.getByTestId('spelling-not-in-dictionary')).toHaveValue(MISSPELLED[0]!);
      await dialog.getByTestId('dialog-spelling-button-close').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', view);
    }
  });

  test('4. the engine is kept off every editable field, in every view and with every dialog open; pasted book text in a dialog shows no mark', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    // Every view: the root attribute, the ProseMirror roots and the inputs.
    for (const view of VIEWS) {
      await showView(page, view);
      await expectEngineOff(page, `${view} view`);
    }
    await expect(page.getByTestId('source-view').locator('.cm-content')).toHaveAttribute(
      'spellcheck',
      'false',
    );
    await showView(page, 'description');
    await expect(page.getByTestId('description-annotation')).toHaveAttribute('spellcheck', 'false');
    await expect(page.getByTestId('description-sti-annotation')).toHaveAttribute(
      'spellcheck',
      'false',
    );
    await showView(page, 'body');
    await expect(page.getByTestId('body-editor')).toHaveAttribute('spellcheck', 'false');

    // Find: with the book's misspelt words pasted into its field - no mark anywhere.
    await menu(page, 'edit', 'find');
    const find = page.getByTestId('dialog-find');
    await expect(find).toBeVisible();
    await find.getByTestId('dialog-find-query').fill(`${MISSPELLED[0]} ${MISSPELLED[4]}`);
    await expect(find.getByTestId('dialog-find-query')).toHaveAttribute('spellcheck', 'false');
    await expectEngineOff(page, 'Find open');
    await page.waitForTimeout(1200);
    await expect(misspelled(find)).toHaveCount(0);
    await find.getByTestId('dialog-find-button-cancel').click();
    await expect(find).toHaveCount(0);

    // Replace.
    await menu(page, 'edit', 'replace');
    const replace = page.getByTestId('dialog-replace');
    await expect(replace).toBeVisible();
    await replace.getByTestId('dialog-replace-with').fill(MISSPELLED[1]!);
    await expectEngineOff(page, 'Replace open');
    await expect(misspelled(replace)).toHaveCount(0);
    await replace.getByTestId('dialog-replace-button-cancel').click();
    await expect(replace).toHaveCount(0);

    // Words.
    await menu(page, 'tools', 'words');
    const words = page.getByTestId('dialog-words');
    await expect(words).toBeVisible();
    await expect(page.getByTestId('words-table')).toHaveAttribute('data-status', 'ready');
    await expectEngineOff(page, 'Words open');
    await page.getByTestId('dialog-words-button-cancel').click();
    await expect(words).toHaveCount(0);

    // Settings.
    await menu(page, 'tools', 'settings');
    const settings = page.getByTestId('dialog-settings');
    await expect(settings).toBeVisible();
    await expectEngineOff(page, 'Settings open');
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(settings).toHaveCount(0);

    // Spelling: its own fields are the editor's, not the engine's.
    await menu(page, 'tools', 'spellcheck');
    const spelling = page.getByTestId('dialog-spelling');
    await expect(spelling).toBeVisible();
    await expect(spelling.getByTestId('spelling-not-in-dictionary')).toHaveValue(MISSPELLED[0]!);
    await expectEngineOff(page, 'Spelling open');
    await expect(misspelled(spelling)).toHaveCount(0);
    await spelling.getByTestId('dialog-spelling-button-close').click();
    await expect(spelling).toHaveCount(0);
  });
});
