/**
 * User Story 10 - Clean up text with the Words tool (T134).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode or when the core has no `words.*` methods. A small OCR-like book with five
 * misspelled words (several occurrences each) is opened through the queued native dialog.
 *
 * Scenarios (spec.md US10):
 *  1. the dialog lists Word / Replacement / Count, sortable, exclusions optionally hidden
 *  2. Highlight all / Invert / Set replaced / Reset replaced / To exclusions / Set replaced all
 *     change the row states as named
 *  3. Find / Next / Replace of the current word act in the Body
 *  4. OK applies all replacements as one undoable step and reports "N replacement(s) done"
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type CoreHandle, type RpcCallError } from './fixtures/core';
import type { Locator, Page } from '@playwright/test';

const PARAGRAPHS = [
  'the quick brown fox said teh word teh and teh again.',
  'I will recieve the parcel and recieve the letter at this adress or that adress.',
  'We saw wich way, wich house and wich door; it occured twice: it occured.',
  'A some-thing with ibid and ibid references.',
];

const MISSPELLED: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  adress: 'address',
  wich: 'which',
  occured: 'occurred',
};

function ocrBook(dir: string): string {
  const file = path.join(dir, 'ocr.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>prose_classic</genre>
\t\t\t<author><first-name>Scanner</first-name><last-name>Output</last-name></author>
\t\t\t<book-title>OCR sample</book-title>
\t\t\t<lang>en</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>fixture</nickname></author>
\t\t\t<date value="2026-01-01">2026</date>
\t\t\t<id>fixture-ocr</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<section>
\t\t\t<title><p>Chapter</p></title>
${PARAGRAPHS.map((p) => `\t\t\t<p>${p}</p>`).join('\n')}
\t\t</section>
\t</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function supportsWords(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('words.exclusions', {})
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function exclusions(core: CoreHandle): Promise<string[]> {
  const result = await core.rpc<{ words?: string[] } | string[]>('words.exclusions', {});
  return Array.isArray(result) ? result : (result.words ?? []);
}

async function resetExclusions(core: CoreHandle): Promise<void> {
  const words = await exclusions(core);
  if (words.length > 0) await core.rpc('words.exclusions', { remove: words });
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect(page).toHaveTitle(/^ocr\.fb2 - /);
}

async function openWords(page: Page): Promise<Locator> {
  await menu(page, 'tools', 'words');
  const dialog = page.getByTestId('dialog-words');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('words-table')).toHaveAttribute('data-status', 'ready');
  return dialog;
}

/** Browser-side snippet: scrolls the virtualised grid one page down; true when it could. */
const SCROLL_GRID = `((step) => {
  const grid = document.querySelector('[data-testid="words-grid"]');
  if (!grid) return false;
  const before = grid.scrollTop;
  grid.scrollTop = step === 'top' ? 0 : grid.scrollTop + grid.clientHeight;
  return step === 'top' || grid.scrollTop !== before;
})`;

/**
 * The table row of `word`. The table is virtualised (only the rows around the viewport are
 * mounted), so the grid is scrolled until the row exists; `null` when the word is not listed.
 */
async function findRow(page: Page, word: string): Promise<Locator | null> {
  const locator = page.locator(`[data-testid^="words-row-"][data-word="${word}"]`);
  if ((await locator.count()) > 0) return locator;
  await page.evaluate(`${SCROLL_GRID}('top')`);
  for (let i = 0; i < 100; i += 1) {
    await page.waitForTimeout(60); // the scroll handler re-renders the window asynchronously
    if ((await locator.count()) > 0) return locator;
    if (!(await page.evaluate<boolean>(`${SCROLL_GRID}('down')`))) break;
  }
  await page.waitForTimeout(60);
  return (await locator.count()) > 0 ? locator : null;
}

/** Like `findRow` but the word must be listed. */
async function rowOf(page: Page, word: string): Promise<Locator> {
  const row = await findRow(page, word);
  if (!row) throw new Error(`the Words dialog does not list "${word}"`);
  return row;
}

/** Polls until `word` is (not) listed, scrolling through the virtualised rows. */
async function expectListed(page: Page, word: string, listed: boolean): Promise<void> {
  await expect.poll(async () => (await findRow(page, word)) !== null).toBe(listed);
}

function cellOf(row: Locator, cell: string): Locator {
  return row.locator(`[data-testid$="-${cell}"]`);
}

function count(text: string, word: string): number {
  return (text.match(new RegExp(`(?<![\\p{L}\\p{N}-])${word}(?![\\p{L}\\p{N}-])`, 'gu')) ?? [])
    .length;
}

async function bodyText(page: Page): Promise<string> {
  return page.getByTestId('body-editor').innerText();
}

test.describe('US10 - clean up text with the Words tool', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us10-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsWords(core)), 'the core does not implement words.* yet');
    await resetExclusions(core);
    await core.rpc('settings.set', { patch: { words: { showExclusionsInWordsDialog: false } } });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await resetExclusions(core).catch(() => {});
  });

  test('1. lists Word / Replacement / Count, sortable, with exclusions hidden or shown', async ({
    core,
    page,
  }) => {
    await core.rpc('words.exclusions', { add: ['ibid'] });
    await openBook(core, page, ocrBook(dir));
    await openWords(page);

    // Columns and the rows of the misspelled words with their counts.
    for (const column of ['word', 'replacement', 'count']) {
      await expect(page.getByTestId(`words-sort-${column}`)).toBeVisible();
    }
    await expect(cellOf(await rowOf(page, 'teh'), 'count')).toHaveText('3');
    await expect(cellOf(await rowOf(page, 'wich'), 'count')).toHaveText('3');
    await expect(cellOf(await rowOf(page, 'recieve'), 'count')).toHaveText('2');
    // Hyphenated words get the de-hyphenated default replacement, as in the original.
    await expect(cellOf(await rowOf(page, 'some-thing'), 'replacement')).toHaveText('something');
    // The exclusion "ibid" is hidden by default (the setting is off).
    await expect(page.getByTestId('words-show-exclusions')).not.toBeChecked();
    await expectListed(page, 'ibid', false);
    await expect(page.getByTestId('words-summary')).toContainText('1 exclusion hidden');

    // Sorting: Count descending first, then ascending; Word restores the alphabetical order.
    await page.getByTestId('words-sort-count').click();
    const first = page.getByTestId('words-row-0');
    await expect(first.locator('[data-testid$="-count"]')).toHaveText('4'); // "and"

    await page.getByTestId('words-sort-count').click();
    await expect(first.locator('[data-testid$="-count"]')).toHaveText('1');
    await page.getByTestId('words-sort-word').click();
    await expect(first).toHaveAttribute('data-word', /^[aA]/);

    // Show/hide exclusions: the excluded word appears in its state and the setting is stored.
    await page.getByTestId('words-show-exclusions').check();
    await expect(await rowOf(page, 'ibid')).toHaveAttribute('data-state', 'excluded');
    await expect
      .poll(async () => {
        const settings = await core.rpc<{ words: { showExclusionsInWordsDialog: boolean } }>(
          'settings.get',
        );
        return settings.words.showExclusionsInWordsDialog;
      })
      .toBe(true);
    await page.getByTestId('words-show-exclusions').uncheck();
    await expectListed(page, 'ibid', false);
    await page.getByTestId('dialog-words-button-cancel').click();
    await expect(page.getByTestId('dialog-words')).toHaveCount(0);
  });

  test('2. Highlight all / Invert / Set replaced / Reset replaced / To exclusions / Set replaced all', async ({
    core,
    page,
  }) => {
    await openBook(core, page, ocrBook(dir));
    await openWords(page);
    const rows = page.locator('[data-testid^="words-row-"][data-word]');
    expect(await rows.count()).toBeGreaterThan(5);

    // (The grid is virtualised: the assertions cover the mounted rows.)
    await page.getByTestId('words-highlight-all').click();
    await expect(page.locator('[data-word][data-highlighted="false"]')).toHaveCount(0);
    await expect(await rowOf(page, 'teh')).toHaveAttribute('data-state', 'highlighted');
    await page.getByTestId('words-invert').click();
    await expect(page.locator('[data-word][data-highlighted="true"]')).toHaveCount(0);

    await cellOf(await rowOf(page, 'teh'), 'highlight').check();
    await cellOf(await rowOf(page, 'wich'), 'highlight').check();
    await page.getByTestId('words-set-replaced').click();
    await expect(await rowOf(page, 'teh')).toHaveAttribute('data-replaced', 'true');
    await expect(await rowOf(page, 'teh')).toHaveAttribute('data-state', 'replaced');
    await expect(await rowOf(page, 'wich')).toHaveAttribute('data-replaced', 'true');
    await expect(await rowOf(page, 'recieve')).toHaveAttribute('data-replaced', 'false');
    await page.getByTestId('words-reset-replaced').click();
    await expect(await rowOf(page, 'teh')).toHaveAttribute('data-replaced', 'false');
    await expect(await rowOf(page, 'wich')).toHaveAttribute('data-replaced', 'false');

    await page.getByTestId('words-set-replaced-all').click();
    await expect(page.locator('[data-word][data-replaced="false"]')).toHaveCount(0);

    // To exclusions: the highlighted words join exclusions.txt and vanish while hidden.
    await page.getByTestId('words-to-exclusions').click();
    await expectListed(page, 'teh', false);
    await expectListed(page, 'wich', false);
    expect((await exclusions(core)).sort()).toEqual(['teh', 'wich']);
    await page.getByTestId('words-show-exclusions').check();
    await expect(await rowOf(page, 'teh')).toHaveAttribute('data-state', 'excluded');
    // The state cell toggles an exclusion back.
    await cellOf(await rowOf(page, 'teh'), 'state').click();
    await expect(await rowOf(page, 'teh')).toHaveAttribute('data-excluded', 'false');
    expect(await exclusions(core)).toEqual(['wich']);
    await page.getByTestId('dialog-words-button-cancel').click();
  });

  test('3./4. Find / Next / Replace on the current word, then OK applies all as one undo step', async ({
    core,
    page,
  }) => {
    await openBook(core, page, ocrBook(dir));
    const original = await bodyText(page);
    expect(count(original, 'teh')).toBe(3);
    await openWords(page);

    await test.step('Find / Next / Replace of the current word act in the body', async () => {
      await cellOf(await rowOf(page, 'teh'), 'word').click();
      await expect(page.getByTestId('words-current-word')).toHaveValue('teh');
      await expect(page.getByTestId('words-find')).toHaveText('Find');
      await expect(page.getByTestId('words-replace')).toBeDisabled();

      await page.getByTestId('words-find').click();
      await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', 'teh');
      await expect(page.getByTestId('words-find')).toHaveText('Next');
      await page.getByTestId('words-find').click();
      await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', 'teh');

      await page.getByTestId('words-current-replacement').fill('the');
      await expect(page.getByTestId('words-replace')).toBeEnabled();
      await page.getByTestId('words-replace').click();
      await expect(cellOf(await rowOf(page, 'teh'), 'count')).toHaveText('2');
      await expect.poll(async () => count(await bodyText(page), 'teh')).toBe(2);
      // The next occurrence is selected already (Replace = replace + find next).
      await expect(page.getByTestId('body-view')).toHaveAttribute('data-selected-text', 'teh');
    });

    await test.step('replacements for the five misspelled words, OK, "N replacement(s) done"', async () => {
      for (const [word, replacement] of Object.entries(MISSPELLED)) {
        if (word === 'teh') continue; // typed in the current-word box above (already marked)
        await cellOf(await rowOf(page, word), 'replacement').click();
        const input = (await rowOf(page, word)).locator('input[type="text"]');
        await input.fill(replacement);
        await input.press('Enter');
        await expect(await rowOf(page, word)).toHaveAttribute('data-replaced', 'true');
      }
      await expect(await rowOf(page, 'teh')).toHaveAttribute('data-replaced', 'true');
      await expect(await rowOf(page, 'some-thing')).toHaveAttribute('data-replaced', 'false');

      await page.getByTestId('dialog-words-button-ok').click();
      const done = page.getByTestId('dialog-words-done');
      await expect(done).toBeVisible();
      // 2 teh + 2 recieve + 2 adress + 3 wich + 2 occured
      await expect(done.getByTestId('dialog-words-done-text')).toHaveText('11 replacements done');
      await done.getByTestId('dialog-words-done-button-ok').click();
      await expect(page.getByTestId('status-message')).toHaveText('11 replacements done');

      const text = await bodyText(page);
      for (const [word, replacement] of Object.entries(MISSPELLED)) {
        expect(count(text, word), word).toBe(0);
        expect(count(text, replacement), replacement).toBeGreaterThan(0);
      }
      expect(count(text, 'some-thing')).toBe(1); // not marked: untouched
      expect(count(text, 'which')).toBe(3);
    });

    await test.step('a single Undo reverts all replacements; the saved XML confirms it', async () => {
      await menu(page, 'edit', 'undo');
      await expect.poll(async () => count(await bodyText(page), 'wich')).toBe(3);
      let text = await bodyText(page);
      expect(count(text, 'recieve')).toBe(2);
      expect(count(text, 'adress')).toBe(2);
      expect(count(text, 'occured')).toBe(2);
      expect(count(text, 'teh')).toBe(2); // the manual Replace of step 3 is its own step
      await menu(page, 'edit', 'undo');
      await expect.poll(async () => count(await bodyText(page), 'teh')).toBe(3);
      text = await bodyText(page);
      expect(text).toBe(original);

      // Redo restores both steps; the document saved afterwards carries the replacements.
      await menu(page, 'edit', 'redo');
      await menu(page, 'edit', 'redo');
      await expect.poll(async () => count(await bodyText(page), 'wich')).toBe(0);
      const saved = path.join(dir, 'cleaned.fb2');
      await core.enqueueDialog('dialog.saveFile', { path: saved, encoding: 'utf-8' });
      await menu(page, 'file', 'saveAs');
      const prompt = page.getByTestId('dialog-validation-failed');
      await expect
        .poll(
          async () =>
            (await prompt.count()) > 0 ||
            /saved|found/i.test(await page.getByTestId('status-message').innerText()),
        )
        .toBe(true);
      if ((await prompt.count()) > 0) {
        await page.getByTestId('dialog-validation-failed-button-yes').click();
      }
      await expect(page).toHaveTitle(/^cleaned\.fb2 - /);
      const xml = readFileSync(saved, 'utf8');
      expect(xml).toContain('the quick brown fox said the word the and the again.');
      expect(xml).toContain(
        'We saw which way, which house and which door; it occurred twice: it occurred.',
      );
      expect(xml).not.toMatch(/\b(teh|recieve|adress|wich|occured)\b/);
    });
  });
});
