/**
 * Feature 009, user story 9 - adding several binary objects (T082; D29, data-model §12).
 *
 * Add > Binary Object with several files adds each one on its own: all readable JPEG and PNG
 * files - the status line counts them, as before; one unreadable file - the others are added and
 * a summary lists the added and the failed one with its reason; other picture formats - the
 * summary says which will be converted on save; every file failing - nothing added, every
 * failure listed; a single file - as before. Needs the real core (MFBE_CORE_BIN).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const IMAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/images',
);
const image = (name: string) => path.join(IMAGES, name);
const MISSING = path.join(IMAGES, 'no-such-picture.png');

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook('notes-6.fb2')] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, fixtureBook('notes-6.fb2'));
}

async function addBinaries(core: CoreHandle, page: Page, paths: string[]): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths });
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-binary').click();
}

const summary = (page: Page) => page.getByTestId('dialog-binaries-summary');

test.describe('US9 (feature 009) - adding several binary objects', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1, 5. readable JPEG and PNG files, or a single file: the status line, as before', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await addBinaries(core, page, [image('tiny.jpg'), image('tiny.png'), image('alpha.png')]);
    await expect(page.getByTestId('status-message')).toHaveText('3 binary objects added');
    await expect(summary(page)).toHaveCount(0);
    await addBinaries(core, page, [image('opaque-rgb.png')]);
    await expect(page.getByTestId('status-message')).toHaveText('1 binary object added');
    await expect(summary(page)).toHaveCount(0);
  });

  test('2, 3. one unreadable file and other formats: the summary lists all of it', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await addBinaries(core, page, [
      image('tiny.jpg'),
      image('tiny.png'),
      MISSING,
      image('tiny.gif'),
      image('tiny.bmp'),
    ]);
    await expect(summary(page)).toBeVisible();
    const text = summary(page).getByTestId('dialog-binaries-summary-text');
    await expect(text).toContainText('Added 4 files: tiny.jpg, tiny.png, tiny.gif, tiny.bmp');
    await expect(text).toContainText(
      'Will be converted to JPEG or PNG when the book is saved: tiny.gif, tiny.bmp',
    );
    await expect(text).toContainText('Not added (1 file):');
    await expect(text).toContainText('no-such-picture.png \u2014');
    await summary(page).getByTestId('dialog-binaries-summary-button-ok').click();
    // Every success is in the book.
    await page.getByTestId('view-description').click();
    for (const id of ['tiny.jpg', 'tiny.png', 'tiny.gif', 'tiny.bmp']) {
      await expect(page.getByTestId(`binary-objects-row-${id}`)).toBeVisible();
    }
  });

  test('4. every file failing: nothing added, every failure listed', async ({ core, page }) => {
    await openBook(core, page);
    await addBinaries(core, page, [MISSING, path.join(IMAGES, 'no-such-picture-2.png')]);
    await expect(summary(page)).toBeVisible();
    const text = summary(page).getByTestId('dialog-binaries-summary-text');
    await expect(text).toContainText('Nothing was added.');
    await expect(text).toContainText('Not added (2 files):');
    await expect(text).toContainText('no-such-picture-2.png \u2014');
    await summary(page).getByTestId('dialog-binaries-summary-button-ok').click();
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('description-binaries-count')).toContainText('0');
  });
});
