/**
 * US5 (feature 002) - Find and Replace work on the visible text (FR-030 to FR-035): a match is
 * selected and shown in the Body text and scrolled into view (on 0.0.1 only the Document Tree
 * moved), Find Next visits every occurrence in document order and continues from the start with
 * a beep, the dialogs are modeless (the document stays usable, the dialog can be moved and the
 * next one opens where the last one was closed), the selection pre-fills the search field, a
 * selected element without text is a starting point, Replace and Replace All stay undoable when
 * the next match lies in a part of the book that is not displayed, and the Source view uses the
 * same dialogs. Book: tests/fixtures/books/many-sections.fb2 (48 sections, shown in windows of
 * 20; "разыскать" 20 times in sections 3, 10, 18, 27, 36 and 46, twice in two paragraphs; an
 * inline image before the 3rd occurrence; a picture between the paragraphs of section 10).
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, type CoreHandle } from './fixtures/core';
import { MOD } from './fixtures/keys';

const WORD = 'разыскать';
const OCCURRENCES = 20;
const BOOK = fixtureBook('many-sections.fb2');

/** Browser-side test hooks (`src/scripting/testHooks.ts`); the e2e tsconfig has no DOM lib. */
declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

interface MatchInfo {
  /** Text of the highlighted current match. */
  text: string;
  /** Offset of the match in its paragraph's text. */
  offset: number;
  /** The match lies inside the visible part of the Body view. */
  inView: boolean;
}

/* The e2e tsconfig has no DOM lib: browser-side probes are string snippets. */
const MATCH_PROBE = `(() => {
  const parts = [...document.querySelectorAll('[data-testid="body-editor"] .mfbe-search-match')];
  if (parts.length === 0) return null;
  const block = parts[0].closest('p');
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEndBefore(parts[0]);
  const view = document.querySelector('[data-testid="body-view"]').getBoundingClientRect();
  const box = parts[0].getBoundingClientRect();
  return {
    text: parts.map((p) => p.textContent).join(''),
    offset: range.toString().length,
    inView: box.width > 0 && box.top >= view.top && box.bottom <= view.bottom &&
      box.left >= view.left && box.right <= view.right,
  };
})()`;

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  // The caret at the start of the book.
  await page.getByTestId('body-editor').locator('p').first().click();
  await page.keyboard.press(`${MOD}+Home`);
  await settle(page);
}

/** Lets the editor pick up a caret moved with the keyboard. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(80);
}

function match(page: Page): Promise<MatchInfo | null> {
  return page.evaluate<MatchInfo | null>(MATCH_PROBE);
}

/** Section and paragraph numbers of the selection ("body[1]/section[18]/p[3]" -> [18, 3]). */
async function position(page: Page): Promise<[number, number]> {
  const path = (await page.getByTestId('status-path').textContent()) ?? '';
  const found = /section\[(\d+)\]\/p\[(\d+)\]$/.exec(path);
  return found ? [Number(found[1]), Number(found[2])] : [0, 0];
}

/** Document-order key of the current match. */
async function matchKey(page: Page): Promise<number> {
  const info = await match(page);
  if (!info) return -1;
  const [section, paragraph] = await position(page);
  return section * 1_000_000 + paragraph * 1_000 + info.offset;
}

async function beeps(core: CoreHandle): Promise<number> {
  return (await core.rpc<{ count: number }>('test.beeps', {})).count;
}

async function occurrences(page: Page, text: string): Promise<number> {
  const xml = await page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
  return xml.split(text).length - 1;
}

async function openFind(page: Page, query: string): Promise<void> {
  await page.keyboard.press(`${MOD}+f`);
  await expect(page.getByTestId('dialog-find')).toBeVisible();
  await page.getByTestId('dialog-find-query').fill(query);
}

test.describe('US5 - Find and Replace work on the visible text', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1. each match is selected and shown in the text; Find Next visits all, then wraps with a beep', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page);
    const beepsBefore = await beeps(core);
    await openFind(page, WORD);
    const findNext = page.getByTestId('dialog-find-button-findNext');
    const keys: number[] = [];
    for (let i = 0; i < OCCURRENCES; i++) {
      await findNext.click();
      const previous = keys[keys.length - 1] ?? -1;
      await expect.poll(() => matchKey(page)).not.toBe(previous);
      const info = (await match(page))!;
      expect(info.text.toLowerCase(), `occurrence ${i + 1}`).toBe(WORD);
      expect(info.inView, `occurrence ${i + 1} scrolled into view`).toBe(true);
      keys.push(await matchKey(page));
    }
    // Document order, none skipped or repeated; the dialog stays open.
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    expect(new Set(keys).size).toBe(OCCURRENCES);
    expect(await beeps(core)).toBe(beepsBefore);
    await expect(page.getByTestId('dialog-find')).toBeVisible();
    // The 21st search continues from the start with a beep.
    await findNext.click();
    await expect.poll(() => matchKey(page)).toBe(keys[0]);
    await expect.poll(() => beeps(core)).toBe(beepsBefore + 1);
    // Searching up from the first occurrence goes to the last one, again with a beep.
    await page.getByTestId('dialog-find-up').check();
    await findNext.click();
    await expect.poll(() => matchKey(page)).toBe(keys[OCCURRENCES - 1]);
    await expect.poll(() => beeps(core)).toBe(beepsBefore + 2);
  });

  test('2. a missing word: "Cannot find the string" in Find, "Finished searching" in Replace', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await openFind(page, 'отсутствует');
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect(page.getByTestId('dialog-search-message')).toContainText(
      "Cannot find the string 'отсутствует'.",
    );
    await page.getByTestId('dialog-search-message-button-ok').click();
    await page.getByTestId('dialog-find-button-cancel').click();
    await page.keyboard.press(`${MOD}+h`);
    await page.getByTestId('dialog-replace-query').fill('отсутствует');
    await page.getByTestId('dialog-replace-button-findNext').click();
    await expect(page.getByTestId('dialog-search-message')).toContainText(
      "Finished searching for 'отсутствует'.",
    );
  });

  test('3. while the dialog is open the document stays usable: click, type, hotkeys', async ({
    core,
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openBook(core, page);
    await openFind(page, WORD);
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect.poll(() => position(page)).toEqual([3, 1]);

    // Click into a paragraph and type: the text changes, the dialog stays. (Clicked at its
    // right end: the dialog opens in the middle of the window.)
    const body = page.getByTestId('body-editor');
    const chapter = body.locator('p').filter({ hasText: /^Глава 2$/ });
    const box = (await chapter.boundingBox())!;
    await chapter.click({ position: { x: box.width - 4, y: box.height / 2 } });
    await page.keyboard.press('End');
    await page.keyboard.type(' (правка)');
    const edited = body.locator('p').filter({ hasText: /^Глава 2 \(правка\)$/ });
    await expect(edited).toHaveCount(1);
    await expect(page.getByTestId('dialog-find')).toBeVisible();
    // An editor hotkey from the text: Find Next (F3) goes on from the caret.
    await page.keyboard.press('F3');
    await expect.poll(() => position(page)).toEqual([3, 1]);
    await page.keyboard.press('F3');
    await expect.poll(() => position(page)).toEqual([3, 2]);

    // In the dialog the editing keys act on its field, not on the book: Paste (Shift+Insert,
    // the original's key) and Undo (Ctrl+Z).
    const query = page.getByTestId('dialog-find-query');
    await page.evaluate(`navigator.clipboard.writeText('буфер')`);
    await query.click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press('Shift+Insert');
    await expect(query).toHaveValue('буфер');
    expect(await occurrences(page, 'буфер')).toBe(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(query).toHaveValue(WORD);
    await expect(edited).toHaveCount(1);
    // Escape in the dialog closes it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog-find')).toHaveCount(0);
  });

  test('4. the dialog moves by its title; the next one opens where the last one was closed', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await openFind(page, WORD);
    const find = page.getByTestId('dialog-find');
    const before = (await find.boundingBox())!;
    const title = page.getByTestId('dialog-find-title');
    const grip = (await title.boundingBox())!;
    await page.mouse.move(grip.x + 40, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - 160, grip.y + grip.height / 2 - 100, { steps: 8 });
    await page.mouse.up();
    const moved = (await find.boundingBox())!;
    expect(Math.round(moved.x - before.x)).toBe(-200);
    expect(Math.round(moved.y - before.y)).toBe(-100);
    await page.getByTestId('dialog-find-button-cancel').click();

    await page.keyboard.press(`${MOD}+h`);
    const replace = (await page.getByTestId('dialog-replace').boundingBox())!;
    expect(Math.round(replace.x)).toBe(Math.round(moved.x));
    expect(Math.round(replace.y)).toBe(Math.round(moved.y));

    // A place that is no longer visible is brought back on screen.
    const rgrip = (await page.getByTestId('dialog-replace-title').boundingBox())!;
    await page.mouse.move(rgrip.x + 40, rgrip.y + rgrip.height / 2);
    await page.mouse.down();
    await page.mouse.move(2000, 2000, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId('dialog-replace-button-cancel').click();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.keyboard.press(`${MOD}+f`);
    const back = (await page.getByTestId('dialog-find').boundingBox())!;
    expect(back.x).toBeGreaterThanOrEqual(0);
    expect(back.y).toBeGreaterThanOrEqual(0);
    expect(back.x + back.width).toBeLessThanOrEqual(900);
    expect(back.y + back.height).toBeLessThanOrEqual(600);
  });

  test('5. the selected text fills the search field; a selected picture is a starting point', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    // Select "старую карту" in the first occurrence's paragraph.
    const paragraph = page.getByTestId('body-editor').locator('p', { hasText: 'старую карту' });
    await paragraph.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 'Утром Анна решила разыскать '.length; i++) {
      await page.keyboard.press('ArrowRight');
    }
    for (let i = 0; i < 'старую карту'.length; i++) await page.keyboard.press('Shift+ArrowRight');
    await settle(page);
    await page.keyboard.press(`${MOD}+f`);
    await expect(page.getByTestId('dialog-find-query')).toHaveValue('старую карту');
    await page.getByTestId('dialog-find-button-cancel').click();

    // The picture between the paragraphs of section 10: the search starts after it.
    await page.getByTestId('body-editor').locator('p', { hasText: 'Глава 10' }).click();
    await page.getByTestId('body-image').click();
    await settle(page);
    await openFind(page, WORD);
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect.poll(() => position(page)).toEqual([10, 2]);
    expect((await match(page))!.offset).toBe('Никто не знал, как '.length);
  });

  test('6. Replace and Replace All stay undoable, also across a part of the book not displayed', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page);
    await page.keyboard.press(`${MOD}+h`);
    await page.getByTestId('dialog-replace-query').fill(WORD);
    await page.getByTestId('dialog-replace-with').fill('найти');
    await page.getByTestId('dialog-replace-button-findNext').click();
    await expect.poll(() => position(page)).toEqual([3, 1]);
    // Ten replacements: sections 3, 10 and 18; the eleventh match lies in section 27, outside
    // the displayed window of sections 1 to 20.
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('dialog-replace-button-replace').click();
      await expect.poll(() => occurrences(page, 'найти')).toBe(i + 1);
    }
    await expect.poll(() => position(page)).toEqual([27, 1]);
    await page.getByTestId('dialog-replace-button-cancel').click();
    for (let i = 0; i < 10; i++) await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => occurrences(page, 'найти')).toBe(0);
    expect(await occurrences(page, WORD)).toBe(OCCURRENCES);

    // Replace All: one undo step for the whole book.
    await page.keyboard.press(`${MOD}+h`);
    await page.getByTestId('dialog-replace-query').fill(WORD);
    await page.getByTestId('dialog-replace-with').fill('найти');
    await page.getByTestId('dialog-replace-button-replaceAll').click();
    await expect(page.getByTestId('dialog-replace-all-done')).toContainText('20');
    await page.getByTestId('dialog-replace-all-done-button-ok').click();
    await page.getByTestId('dialog-replace-button-cancel').click();
    expect(await occurrences(page, 'найти')).toBe(OCCURRENCES);
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => occurrences(page, WORD)).toBe(OCCURRENCES);
    expect(await occurrences(page, 'найти')).toBe(0);
  });

  test('7. the Source view uses the same Find dialog; the match is selected in the source', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-editor')).toContainText('FictionBook');
    await page.getByTestId('source-editor').click();
    await page.keyboard.press(`${MOD}+Home`);
    await openFind(page, WORD);
    await expect(page.locator('.cm-search')).toHaveCount(0); // not CodeMirror's own panel
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect(page.locator('.cm-activeLine')).toContainText('Утром Анна решила разыскать');
    await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
    await page.getByTestId('dialog-find-button-findNext').click();
    await expect(page.locator('.cm-activeLine')).toContainText('Карту следовало разыскать');
    await expect(page.getByTestId('dialog-find')).toBeVisible();
  });
});
