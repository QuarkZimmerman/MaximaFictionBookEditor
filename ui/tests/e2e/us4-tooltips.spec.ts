/**
 * Feature 010, US4 (T037): every control says what it does (D11-D14). The Links bar's fields -
 * the requester's Section ID - and a greyed one that says when it becomes available; a toolbar
 * button with its name, key and description; a highlighted menu entry's description in the
 * status bar, gone when the menu closes; a sample of the Description view, the Settings and a
 * dialog. Runs in English, Russian and Ukrainian: every text comes from the page's language.
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageText } from './fixtures/i18n';

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  const file = fixtureBook('modern-utf8.fb2');
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

test.describe('US4 (010) - every control says what it does', () => {
  test('1-6. bars, a greyed field, the toolbar, the menu description in the status bar, the Description view, the Settings and a dialog', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page);

    // The Links bar: what Section ID is and what it is for; Alt, greyed, says when it works.
    await expect(page.getByTestId('links-bar-section-id')).toHaveAttribute(
      'title',
      new RegExp(`^${escape(await pageText(page, 'tip.links.sectionId'))}`),
    );
    const alt = page.getByTestId('links-bar-alt');
    await expect(alt).toBeDisabled();
    await expect(alt).toHaveAttribute(
      'title',
      `${await pageText(page, 'tip.links.alt')} ${await pageText(page, 'tip.links.altWhen')}`,
    );
    await expect(alt).toHaveAttribute('aria-description', (await alt.getAttribute('title')) ?? '');

    // A toolbar button: name and key, then the command's description.
    await expect(page.getByTestId('toolbar-file.open')).toHaveAttribute(
      'title',
      new RegExp(
        `\\(Ctrl\\+O\\) \\u2014 ${escape(await pageText(page, 'cmd.file.open.description'))}$`,
      ),
    );

    // A highlighted menu entry's description in the status bar, and what was there before after.
    const status = page.getByTestId('status-message');
    const before = await status.innerText();
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').hover();
    await expect(status).toHaveText(await pageText(page, 'cmd.file.open.description'));
    await page.keyboard.press('Escape');
    await expect(status).toHaveText(before);

    // The Description view.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-book-title')).toHaveAttribute(
      'title',
      await pageText(page, 'tip.description.titleInfo.bookTitle'),
    );

    // The Settings: a View page setting.
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await expect(page.getByTestId('settings-view-fast-mode')).toHaveAttribute(
      'title',
      await pageText(page, 'tip.settings.view.fastMode'),
    );
    await page.getByTestId('dialog-settings-button-cancel').click();

    // A dialog: Find.
    await page.getByTestId('view-body').click();
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-find').click();
    await expect(page.getByTestId('dialog-find-whole-words')).toHaveAttribute(
      'title',
      await pageText(page, 'tip.find.wholeWords'),
    );
    await page.getByTestId('dialog-find-button-cancel').click();
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
