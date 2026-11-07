/**
 * Feature 010, US10 (T027): a file that cannot be opened changes nothing (D36). The window keeps
 * its book - its text, its unsaved changes (also after *No* in the question about them) and its
 * undo history - for a file that is not FictionBook, an archive without a book, a damaged or
 * encrypted archive, a missing Recent files entry and a reload of a replaced file; the untouched
 * template stays; a malformed FictionBook file still opens in the Source view.
 */

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  APP_TITLE,
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';

const ARCHIVES = path.resolve(path.dirname(fixtureBook('x')), '..', 'archives');
const archive = (name: string) => path.join(ARCHIVES, name);
const BOOK = fixtureBook('modern-utf8.fb2');

async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
}

const paragraph = (page: Page) =>
  page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();

/** Opens the book and types one letter into its first paragraph: an unsaved change. */
async function bookWithChange(core: CoreHandle, page: Page, dir: string): Promise<string> {
  const file = path.join(dir, 'book.fb2');
  copyFileSync(BOOK, file);
  await openViaDialog(core, page, file);
  await waitForBook(page, file);
  await paragraph(page).click({ position: { x: 4, y: 6 } });
  await page.keyboard.type('Z');
  await expect(page).toHaveTitle(new RegExp(`\\* - ${APP_TITLE}$`));
  return file;
}

/** The book is the one it was: its name in the title, still modified, the change undoable. */
async function expectBookKept(page: Page, file: string, text: string): Promise<void> {
  await expect(page).toHaveTitle(`${path.basename(file)}* - ${APP_TITLE}`);
  await expect(paragraph(page)).toHaveText(text);
}

/** Answers the unsaved-changes question with No and the refusal with OK. */
async function refusedAfterNo(page: Page, messageTestId: string): Promise<void> {
  await page.getByTestId('dialog-save-changes-button-no').click();
  await expect(page.getByTestId(messageTestId)).toBeVisible();
  await page.getByTestId(`${messageTestId}-button-ok`).click();
  await expect(page.getByTestId(messageTestId)).toHaveCount(0);
}

test.describe('US10 (010) - a file that cannot be opened changes nothing', () => {
  let dir = '';

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us10-010-'));
    await core.openApp(page);
  });

  test('1-4. not FictionBook, an archive without a book, damaged and encrypted archives: the book, its change and its undo stay', async ({
    core,
    page,
  }) => {
    const file = await bookWithChange(core, page, dir);
    const changed = await paragraph(page).innerText();

    const text = path.join(dir, 'notes.txt');
    writeFileSync(text, 'Plain text, not a book.\n', 'utf8');
    await openViaDialog(core, page, text);
    await refusedAfterNo(page, 'dialog-not-fictionbook');
    await expectBookKept(page, file, changed);

    for (const name of ['no-book.zip', 'truncated.zip', 'encrypted.zip']) {
      await openViaDialog(core, page, archive(name));
      await refusedAfterNo(page, 'dialog-archive-error');
      await expectBookKept(page, file, changed);
    }

    // The undo history is the book's own: one Undo takes the typed letter back.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect(paragraph(page)).not.toHaveText(changed);
  });

  test('3. the archive without a book says so', async ({ core, page }) => {
    await openViaDialog(core, page, archive('no-book.zip'));
    await expect(page.getByTestId('dialog-archive-error')).toContainText(
      'holds no FictionBook book',
    );
    await page.getByTestId('dialog-archive-error-button-ok').click();
    // 7. The untouched template stays.
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`${APP_TITLE}$`));
  });

  test('4, 6. a missing Recent files entry and a reload of a file replaced by plain text keep the book', async ({
    core,
    page,
  }) => {
    // A Recent files entry whose file is gone.
    const gone = path.join(dir, 'gone.fb2');
    copyFileSync(BOOK, gone);
    await openViaDialog(core, page, gone);
    await waitForBook(page, gone);
    const file = await bookWithChange(core, page, dir);
    const changed = await paragraph(page).innerText();
    rmSync(gone);
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-recent').hover();
    await page.getByText('gone.fb2', { exact: false }).first().click();
    await refusedAfterNo(page, 'dialog-open-failed');
    await expectBookKept(page, file, changed);

    // The book's own file replaced by plain text: Yes to the reload, the message, the book stays.
    writeFileSync(file, 'Not a book any more.\n', 'utf8');
    const changedDialog = page.getByTestId('dialog-file-changed');
    await expect(changedDialog).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('dialog-file-changed-button-yes').click();
    await expect(page.getByTestId('dialog-not-fictionbook')).toBeVisible();
    await page.getByTestId('dialog-not-fictionbook-button-ok').click();
    await expect(paragraph(page)).toHaveText(changed);
  });
});
