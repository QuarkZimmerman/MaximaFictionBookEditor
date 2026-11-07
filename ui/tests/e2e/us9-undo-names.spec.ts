/**
 * Feature 010, US9 (T071; D33, D34): Undo and Redo name the step. Typing, deleting, a command and
 * a Description field each name their step in Edit > Undo, in the toolbar's tooltip and in the
 * context menu; after Undo, Redo names it; with nothing to undo, the entry is plain and greyed.
 * Runs in English, Russian and Ukrainian.
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

/** "Undo Typing" in the page's language, without the access-key marker. */
async function named(page: Page, which: 'undo' | 'redo', nameKey: string): Promise<string> {
  const name = nameKey.startsWith('=') ? nameKey.slice(1) : await pageText(page, nameKey);
  return (await pageText(page, `undoNames.${which}`, { name })).replace('&', '');
}

async function editMenuItem(page: Page, id: 'undo' | 'redo') {
  await page.getByTestId('menu-edit').click();
  return page.getByTestId(`menu-edit-${id}`);
}

test.describe('US9 (010) - Undo and Redo name the step', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page);
  });

  test('1. typing and deleting: the Edit menu, the toolbar tooltip, the context menu, then Redo', async ({
    page,
  }) => {
    const plain = (await pageText(page, 'menu.edit.undo')).replace('&', '');
    const undo = await editMenuItem(page, 'undo');
    await expect(undo).toContainText(plain);
    await expect(undo).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    const paragraph = page
      .getByTestId('body-editor')
      .locator('p.fb-p', { hasText: 'Вложенные стили' })
      .first();
    await paragraph.click();
    await page.keyboard.type('Z');
    const typing = await named(page, 'undo', 'undoNames.typing');
    await expect(await editMenuItem(page, 'undo')).toContainText(typing);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('toolbar-edit.undo')).toHaveAttribute(
      'title',
      new RegExp(
        `^${(await pageText(page, 'undoNames.undoTooltip', { name: await pageText(page, 'undoNames.typing') })).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    );
    await paragraph.click({ button: 'right' });
    await expect(page.getByTestId('context-menu-edit.undo')).toContainText(typing);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(await editMenuItem(page, 'undo')).toContainText(
      await named(page, 'undo', 'undoNames.delete'),
    );
    await page.getByTestId('menu-edit-undo').click();
    await expect(await editMenuItem(page, 'redo')).toContainText(
      await named(page, 'redo', 'undoNames.delete'),
    );
    await page.keyboard.press('Escape');
  });

  test('2. a command names its step; a Description field names its own', async ({ page }) => {
    const paragraph = page
      .getByTestId('body-editor')
      .locator('p.fb-p', { hasText: 'Вложенные стили' })
      .first();
    await paragraph.click();
    await page.getByTestId('menu-style').click();
    await page.getByTestId('menu-style-subtitle').click();
    const subtitle = (await pageText(page, 'menu.style.subtitle')).replace('&', '');
    await expect(await editMenuItem(page, 'undo')).toContainText(
      await named(page, 'undo', `=${subtitle}`),
    );
    await page.keyboard.press('Escape');

    await page.getByTestId('view-description').click();
    const title = page.getByTestId('description-book-title');
    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    const field = (await pageText(page, 'description.fields.bookTitle')).replace(/[\s*:]+$/u, '');
    await expect(await editMenuItem(page, 'undo')).toContainText(
      await named(page, 'undo', `=${await pageText(page, 'undoNames.fieldPrefix')} ${field}`),
    );
    await page.keyboard.press('Escape');
  });
});
