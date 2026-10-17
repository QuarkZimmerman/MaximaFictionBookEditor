/**
 * Feature 003 User Story 8 - tag completion in the Source view (FR-070 to FR-075).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`) on the
 * fixture `tests/fixtures/books/nested-sections.fb2` (sections three levels deep); skipped in
 * the core-less mode.
 *
 * Scenarios (spec.md US8):
 *  1. `<sec` inside a section lists `section` within 300 ms; Enter completes to `<section` and
 *     inserts nothing else; Tab accepts as well
 *  2. `</` at a nested position offers the open elements innermost first; choosing one inserts
 *     the whole closing tag; Esc dismisses; `<zzz` shows no list and typing is unaffected
 *  3. Ctrl+Space opens the list on demand; the Hotkeys page lists the command in the Edit group
 *  4. overtype mode (Insert): an accepted name is inserted whole, the text after the cursor stays
 *  5. the modeless Find dialog and the list are both usable at the same time
 *  6. Settings > View > "Tag completion" off: no list, not even on demand; on again: list
 *  7. the list is readable in the dark theme and with custom colours (contrast >= 4.5:1)
 *  8. nothing in the Body view, the Description view or a dialog text box
 * The 10 MB timing (list <= 300 ms, keystroke <= 100 ms) is in `perf-large-book.spec.ts`.
 */

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { LINE_END, LINE_START, MOD } from './fixtures/keys';

const BOOK = fixtureBook('nested-sections.fb2');
/** FR-074: the list appears within 300 ms of the last keystroke. */
const LIST_BUDGET_MS = 300;

/* ------------------------------------------------------------------------ */
/* Browser-side probes (the e2e tsconfig has no DOM lib: string snippets)   */
/* ------------------------------------------------------------------------ */

/**
 * Records the last keydown made while no list was shown and the moment the list enters the DOM
 * (a keystroke that finds the list already there leaves the measurement alone).
 */
const INSTALL_TIMER = `(() => {
  const w = window;
  w.__mfbeCompletionTiming = { lastKey: 0, shown: 0 };
  document.addEventListener('keydown', () => {
    if (document.querySelector('.cm-tooltip-autocomplete')) return;
    w.__mfbeCompletionTiming.lastKey = performance.now();
    w.__mfbeCompletionTiming.shown = 0;
  }, true);
  const observer = new MutationObserver(() => {
    const timing = w.__mfbeCompletionTiming;
    if (!timing.shown && document.querySelector('.cm-tooltip-autocomplete')) {
      timing.shown = performance.now();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})()`;

/** Milliseconds from the last keystroke to the list (negative when it was not shown). */
const LIST_LATENCY = `(() => {
  const timing = window.__mfbeCompletionTiming;
  return timing && timing.shown ? timing.shown - timing.lastKey : -1;
})()`;

/** Computed colours of the list: its background, a plain option, the selected option. */
const LIST_COLORS = `(() => {
  const list = document.querySelector('.cm-tooltip-autocomplete');
  if (!list) return null;
  const style = (el) => (el ? getComputedStyle(el) : null);
  const plain = list.querySelector('li[role="option"]:not([aria-selected])');
  const selected = list.querySelector('li[aria-selected]');
  return {
    background: style(list).backgroundColor,
    text: plain ? style(plain).color : null,
    selectedBackground: selected ? style(selected).backgroundColor : null,
    selectedText: selected ? style(selected).color : null,
  };
})()`;

interface ListColors {
  background: string;
  text: string | null;
  selectedBackground: string | null;
  selectedText: string | null;
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

/** Relative luminance of a computed `rgb()` colour; null for a transparent one. */
function luminance(css: string | null): number | null {
  if (!css) return null;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css);
  if (!match) return null;
  if (match[4] !== undefined && Number(match[4]) === 0) return null;
  const channel = (value: string) => {
    const c = Number(value) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(match[1]!) + 0.7152 * channel(match[2]!) + 0.0722 * channel(match[3]!);
}

/** WCAG contrast ratio of two computed colours (0 when one of them is transparent). */
function contrast(a: string | null, b: string | null): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('source-editor')).toContainText('FictionBook');
}

const content = (page: Page) => page.locator('.mfbe-source-editor .cm-content');
const activeLine = (page: Page) => page.locator('.mfbe-source-editor .cm-activeLine').first();
const list = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const options = (page: Page) => list(page).locator('li[role="option"]');

/**
 * Puts the cursor at the end of the line holding `text`, through the Find dialog (the Source
 * text is the core's serialisation, so line numbers are not relied upon). The dialog is closed
 * again unless `keepFind`.
 */
async function goToLineWith(page: Page, text: string, keepFind = false): Promise<void> {
  await content(page).click();
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press(`${MOD}+f`);
  const find = page.getByTestId('dialog-find');
  await expect(find).toBeVisible();
  await page.getByTestId('dialog-find-query').fill(text);
  await page.getByTestId('dialog-find-button-findNext').click();
  await expect(activeLine(page)).toContainText(text);
  if (!keepFind) {
    await page.getByTestId('dialog-find-button-cancel').click();
    await expect(find).toHaveCount(0);
  }
  // Focusing (not clicking) keeps the selection where Find left it.
  await content(page).focus();
  await page.keyboard.press(LINE_END);
}

/** Starts a fresh line below the current one (inside the same element). */
async function newLine(page: Page): Promise<void> {
  await expect(list(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
}

/** Waits past CodeMirror's interaction delay, during which keys do not reach a fresh list. */
async function listReady(page: Page): Promise<void> {
  await expect(list(page)).toBeVisible();
  await page.waitForTimeout(120);
}

test.describe('US8 (feature 003) - tag completion in the Source view', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test.afterEach(async ({ core }) => {
    if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
  });

  test('1. <sec in a section lists section within 300 ms; Enter completes the name only; Tab accepts too', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await showSource(page);
    await goToLineWith(page, 'Nobody answered the knock');
    await newLine(page);

    await page.evaluate(INSTALL_TIMER);
    await page.keyboard.type('<sec');
    await expect(list(page)).toBeVisible();
    await expect(list(page)).toHaveAttribute('data-testid', 'source-completion');
    await expect(options(page)).toHaveText(['section']);
    const latency = await page.evaluate<number>(LIST_LATENCY);
    test
      .info()
      .annotations.push({ type: 'perf', description: `list after ${latency.toFixed(0)} ms` });
    expect(latency, 'time from the last keystroke to the list').toBeGreaterThan(0);
    expect(latency, 'time from the last keystroke to the list').toBeLessThanOrEqual(LIST_BUDGET_MS);

    await listReady(page);
    await page.keyboard.press('Enter');
    await expect(list(page)).toHaveCount(0);
    await expect(activeLine(page)).toHaveText(/^\s*<section$/);
    // Typing on: attributes are not completed (FR-076), the tag is finished by hand.
    await page.keyboard.type(' id="new">');
    await expect(list(page)).toHaveCount(0);
    await expect(activeLine(page)).toHaveText(/^\s*<section id="new">$/);

    // Tab accepts like Enter; with no list, the keys work as before.
    await newLine(page);
    await page.keyboard.type('<ti');
    await expect(options(page)).toHaveText(['title']);
    await listReady(page);
    await page.keyboard.press('Tab');
    await expect(activeLine(page)).toHaveText(/^\s*<title$/);
    await page.keyboard.type('>');
    await expect(list(page)).toHaveCount(0);
    await expect(page).toHaveTitle(/^nested-sections\.fb2\* - /);
  });

  test('2. </ lists the open elements innermost first; the whole closing tag is inserted; Esc dismisses; <zzz shows nothing', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await showSource(page);
    // Inside <title> of the innermost section (part1-ch1-s1): the <p> on this line is closed.
    await goToLineWith(page, 'The Gate');
    await page.keyboard.type('</');
    await expect(list(page)).toBeVisible();
    await expect(options(page)).toHaveText(['title', 'section', 'body', 'FictionBook']);

    // Esc closes the list and changes nothing.
    await listReady(page);
    await page.keyboard.press('Escape');
    await expect(list(page)).toHaveCount(0);
    await expect(activeLine(page)).toHaveText(/<p>The Gate<\/p><\/$/);

    // Typing on filters; Enter inserts the complete closing tag.
    await page.keyboard.type('t');
    await expect(options(page)).toHaveText(['title']);
    await listReady(page);
    await page.keyboard.press('Enter');
    await expect(list(page)).toHaveCount(0);
    await expect(activeLine(page)).toHaveText(/<p>The Gate<\/p><\/title>$/);

    // A prefix that matches nothing: no list, typing unaffected.
    await newLine(page);
    await page.keyboard.type('<zzz');
    await page.waitForTimeout(400);
    await expect(list(page)).toHaveCount(0);
    await expect(activeLine(page)).toHaveText(/^\s*<zzz$/);
    await page.keyboard.press('Enter');
    await expect(activeLine(page)).toHaveText(/^\s*$/);
  });

  test('3. Ctrl+Space opens the list on demand; the Hotkeys page lists the command', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await showSource(page);
    await goToLineWith(page, 'The Letter');
    await newLine(page);
    await page.keyboard.type('<');
    await listReady(page);
    await page.keyboard.press('Escape');
    await expect(list(page)).toHaveCount(0);

    await page.keyboard.press('Control+Space');
    await expect(list(page)).toBeVisible();
    // Children of <title>: the schema allows p and empty-line only (scenario 3).
    await expect(options(page)).toHaveText(['empty-line', 'p']);
    await listReady(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(activeLine(page)).toHaveText(/^\s*<p$/);

    // Listed in Settings > Hotkeys like every other shortcut (FR-072).
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await page.getByTestId('settings-tab-hotkeys').click();
    await page.getByTestId('settings-hotkeys-group-edit').click();
    const row = page.getByTestId('settings-hotkeys-command-edit.completeTag');
    await expect(row).toContainText('Complete tag');
    await expect(row).toContainText('Ctrl+Space');
    await page.getByTestId('dialog-settings-button-cancel').click();
  });

  test('4. in overtype mode the accepted name is inserted whole and the text after the cursor stays', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await showSource(page);
    await goToLineWith(page, 'Nobody answered the knock');
    // Home lands on the first non-blank character (before `<p>`); on macOS at the line start.
    await page.keyboard.press(LINE_START);
    await page.keyboard.press('Insert');
    await expect(page.getByTestId('status-insmode')).toHaveText('OVR');
    // Overtype replaces four characters while `<sec` is typed (`<p>N` or indentation); the
    // accepted completion adds `tion` and eats nothing more.
    await page.keyboard.type('<sec');
    await expect(options(page)).toHaveText(['section']);
    await listReady(page);
    await page.keyboard.press('Enter');
    await expect(activeLine(page)).toHaveText(/<section(\s*<p>N|)obody answered the knock/);
    await page.keyboard.press('Insert');
    await expect(page.getByTestId('status-insmode')).toHaveText('INS');
  });

  test('5. the Find dialog and the list are usable at the same time', async ({ core, page }) => {
    await openBook(core, page);
    await showSource(page);
    await goToLineWith(page, 'The Letter', true);
    await newLine(page);
    await page.keyboard.type('<p');
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId('dialog-find')).toBeVisible();

    // The dialog takes input while the list is shown (the list yields to the focus change).
    const query = page.getByTestId('dialog-find-query');
    await query.click();
    await page.keyboard.type(' lay');
    await expect(query).toHaveValue('The Letter lay');
    await expect(list(page)).toHaveCount(0);
    await query.fill('letter, folded');
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect(activeLine(page)).toContainText('letter, folded');

    // ... and the list comes back in the editor with the dialog still open.
    await content(page).focus();
    await page.keyboard.press(LINE_END);
    await newLine(page);
    await page.keyboard.type('<');
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId('dialog-find')).toBeVisible();
    await listReady(page);
    await page.keyboard.press('Escape');
    await expect(list(page)).toHaveCount(0);
    await page.getByTestId('dialog-find-button-cancel').click();
  });

  test('6. Settings > View > Tag completion off: no list, not even on demand; on again: list', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await showSource(page);
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-tag-completion', 'true');

    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    const toggle = page.getByTestId('settings-view-source-tag-completion');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-tag-completion', 'false');
    expect(
      (await core.rpc<{ view: { sourceTagCompletion: boolean } }>('settings.get')).view
        .sourceTagCompletion,
    ).toBe(false);

    await goToLineWith(page, 'Nobody answered the knock');
    await newLine(page);
    await page.keyboard.type('<sec');
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(400);
    await expect(list(page)).toHaveCount(0);
    await expect(activeLine(page)).toHaveText(/^\s*<sec$/);

    await core.rpc('settings.set', { patch: { view: { sourceTagCompletion: true } } });
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-tag-completion', 'true');
    await page.keyboard.type('t');
    await expect(options(page)).toHaveText(['section']);
  });

  test('7. the list is readable in the dark theme and with custom colours', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await showSource(page);
    await goToLineWith(page, 'Nobody answered the knock');
    await newLine(page);

    const check = async (what: string) => {
      await page.keyboard.type('<s');
      await expect(options(page)).toHaveText(['section', 'subtitle']);
      const colors = (await page.evaluate<ListColors | null>(LIST_COLORS))!;
      expect(colors, what).not.toBeNull();
      expect(
        contrast(colors.background, colors.text),
        `${what}: option text`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(colors.selectedBackground, colors.selectedText),
        `${what}: selected option`,
      ).toBeGreaterThanOrEqual(4.5);
      await listReady(page);
      await page.keyboard.press('Escape');
      await expect(list(page)).toHaveCount(0);
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await expect(activeLine(page)).toHaveText(/^\s*$/);
      return colors;
    };

    const light = await check('light theme');
    expect(luminance(light.background)!).toBeGreaterThan(0.5);

    // Custom (Body) colours: the Source view and its list keep the theme palette.
    await core.rpc('settings.set', {
      patch: { view: { bodyBackground: '#202020', bodyTextColor: '#e0e0e0' } },
    });
    await check('light theme, custom colours');

    await core.rpc('settings.set', { patch: { view: { theme: 'dark' } } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-theme', 'dark');
    const dark = await check('dark theme');
    expect(luminance(dark.background)!).toBeLessThan(0.3);
    await core.rpc('settings.set', {
      patch: { view: { bodyBackground: '#fefefe', bodyTextColor: '#102030' } },
    });
    await check('dark theme, custom colours');
  });

  test('8. nothing in the Body view, the Description view or a dialog text box', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    // Body: `<` is typed as text.
    const paragraph = page.getByTestId('body-editor').locator('p.fb-p').first();
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' <sec');
    await page.waitForTimeout(400);
    await expect(list(page)).toHaveCount(0);
    await expect(paragraph).toContainText('<sec');

    // Dialog text box (Find).
    await page.keyboard.press(`${MOD}+f`);
    const query = page.getByTestId('dialog-find-query');
    await expect(query).toBeVisible();
    await query.fill('');
    await query.pressSequentially('<sec');
    await page.waitForTimeout(400);
    await expect(list(page)).toHaveCount(0);
    await expect(query).toHaveValue('<sec');
    await page.getByTestId('dialog-find-button-cancel').click();

    // Description view field.
    await page.getByTestId('view-description').click();
    const title = page.getByTestId('description-book-title');
    await expect(title).toBeVisible();
    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' <sec');
    await page.waitForTimeout(400);
    await expect(list(page)).toHaveCount(0);
    await expect(title).toHaveValue(/<sec$/);
  });
});
