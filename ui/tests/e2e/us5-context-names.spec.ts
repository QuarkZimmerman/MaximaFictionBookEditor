/**
 * Feature 010, US5 (T068; D15, D16): the Body view's context menu names elements in words - a verse,
 * its stanza and poem, the History block - and a right-click outside the selection first moves the
 * caret to the clicked point, so that *Select paragraph* selects the clicked paragraph; a
 * right-click inside the selection keeps it. Runs in English, Russian and Ukrainian.
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageText } from './fixtures/i18n';

const BOOK = fixtureBook('modern-utf8.fb2');

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

const selectLabel = async (page: Page, element: string) =>
  pageText(page, 'editing.contextMenu.select', {
    element: await pageText(page, `editing.element.${element}`),
  });

const menu = (page: Page) => page.getByTestId('context-menu');
const selectedText = (page: Page) =>
  page.getByTestId('body-view').getAttribute('data-selected-text');

test.describe('US5 (010) - the Body context menu names what was clicked', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page);
  });

  test('1. a verse, its stanza and poem, the History block - in words', async ({ page }) => {
    const editor = page.getByTestId('body-editor');
    await editor.locator('.fb-v').first().click({ button: 'right' });
    for (const element of ['verse', 'stanza', 'poem']) {
      await expect(
        menu(page).getByText(await selectLabel(page, element), { exact: true }),
      ).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await page.getByTestId('body-block-history').locator('p').first().click({ button: 'right' });
    await expect(
      menu(page).getByText(await selectLabel(page, 'history'), { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('2. a right-click moves the caret to the clicked paragraph; inside the selection it keeps it', async ({
    page,
  }) => {
    const editor = page.getByTestId('body-editor');
    const first = editor.locator('p.fb-p', { hasText: 'Текст с жирным' }).first();
    const clicked = editor.locator('p.fb-p', { hasText: 'Вложенные стили' }).first();
    await first.click();
    await clicked.click({ button: 'right' });
    await menu(page)
      .getByText(await selectLabel(page, 'paragraph'), { exact: true })
      .click();
    await expect.poll(() => selectedText(page)).toBe((await clicked.innerText()).trim());

    // Inside the selection: the menu keeps it.
    const before = await selectedText(page);
    await clicked.click({ button: 'right', position: { x: 12, y: 6 } });
    await expect(menu(page)).toBeVisible();
    expect(await selectedText(page)).toBe(before);
    await page.keyboard.press('Escape');
  });
});
