/**
 * Feature 009, user story 6 - attributes and values completed in the Source view (T075;
 * FR-060 to FR-067, D25, data-model §9).
 *
 * Typing `<a ` lists the link's attributes with the book's link prefix; accepting `l:href`
 * inserts `l:href=""` with the cursor inside and opens the book's ids; a table cell's `align`
 * offers its values. Needs the real core (MFBE_CORE_BIN).
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MAC, MOD } from './fixtures/keys';

const BOOK = fixtureBook('notes-6.fb2');
const LINE_END = MAC ? 'Meta+ArrowRight' : 'End';
const list = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const options = (page: Page) => list(page).locator('li[role="option"]');
const content = (page: Page) => page.locator('.mfbe-source-editor .cm-content');
const activeLine = (page: Page) => page.locator('.mfbe-source-editor .cm-activeLine').first();

async function openSource(core: CoreHandle, page: Page): Promise<void> {
  await core.rpc('settings.set', { patch: { session: { aiPanelVisible: false } } });
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

/** The cursor at the end of the line holding `text` (through the Find dialog). */
async function goToLineWith(page: Page, text: string): Promise<void> {
  await content(page).click();
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press(`${MOD}+f`);
  await page.getByTestId('dialog-find-query').fill(text);
  await page.getByTestId('dialog-find-button-findNext').click();
  await expect(activeLine(page)).toContainText(text);
  await page.getByTestId('dialog-find-button-cancel').click();
  await content(page).focus();
  await page.keyboard.press(LINE_END);
}

test.describe('US6 (feature 009) - attributes and values completed in the Source view', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });
  test.afterEach(async ({ core }) => {
    if (core.hasCore) {
      await core
        .rpc('settings.set', { patch: { view: null, session: { aiPanelVisible: true } } })
        .catch(() => {});
    }
  });

  test('1-3. <a lists its attributes; l:href inserts l:href="" and opens the book’s ids', async ({
    core,
    page,
  }) => {
    await openSource(core, page);
    await goToLineWith(page, 'Сит адиписцинг до инцидидунт');
    await page.keyboard.press('Enter');
    await page.keyboard.type('<a ');
    await expect(list(page)).toBeVisible();
    await expect(options(page).first()).toContainText('l:href');
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    await expect(activeLine(page)).toContainText('<a l:href=""');
    await expect(list(page)).toBeVisible();
    await expect(options(page)).toContainText(['#n_1']);
  });

  test('4. a value list: align of a table cell', async ({ core, page }) => {
    await openSource(core, page);
    await goToLineWith(page, 'Сит адиписцинг до инцидидунт');
    await page.keyboard.press('Enter');
    await page.keyboard.type('<table><tr><td align="');
    // A quote opens no list by itself: Ctrl+Space asks for the context's values (FR-063).
    await page.keyboard.press('Control+Space');
    await expect(list(page)).toBeVisible();
    await expect(options(page)).toHaveText(['center', 'left', 'right']); // the list sorts its labels
  });
});
