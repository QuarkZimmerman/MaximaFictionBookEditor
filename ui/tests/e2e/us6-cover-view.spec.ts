/**
 * Feature 008, User Story 6 (T056, D9, FR-050 to FR-052): pictures of a book made by the classic
 * editor. The cover's thumbnail shows the cover in feature 007's picture view; *Choose…* opens
 * the cover picker; the pictures of the text keep their natural size and a Binary objects
 * thumbnail still opens the view.
 */
import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const BOOK = 'fbe-pictures.fb2';

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(BOOK)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
}

async function toDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

test.describe('US6: pictures in the Description view and in the text', () => {
  test('a click on the cover thumbnail shows the cover; Escape closes the view', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await toDescription(page);
    const thumb = page.getByTestId('description-cover-0-thumb');
    await thumb.scrollIntoViewIfNeeded();
    await thumb.click();
    await expect(page.getByTestId('picture-view')).toBeVisible();
    await expect(page.getByTestId('picture-view-picture')).toBeVisible();
    await expect(page.getByTestId('cover-picker')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
  });

  test('Choose… opens the cover picker', async ({ core, page }) => {
    await openBook(core, page);
    await toDescription(page);
    const choose = page.getByTestId('description-cover-0-choose');
    await choose.scrollIntoViewIfNeeded();
    await choose.click();
    await expect(page.getByTestId('cover-picker')).toBeVisible();
    await expect(page.getByTestId('cover-picker-item-cover.jpg')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cover-picker')).toHaveCount(0);
  });

  test('a Binary objects thumbnail still opens the picture view', async ({ core, page }) => {
    await openBook(core, page);
    await toDescription(page);
    const view = page.getByTestId('binary-objects-view-block.png');
    await view.scrollIntoViewIfNeeded();
    await view.click();
    await expect(page.getByTestId('picture-view')).toBeVisible();
    await page.getByTestId('picture-view-close').click();
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
  });

  test('the pictures of the text show at their natural size', async ({ core, page }) => {
    await openBook(core, page);
    const pictures = page.getByTestId('body-editor').locator('img');
    await expect(pictures).toHaveCount(2);
    for (const picture of await pictures.all()) {
      await expect
        .poll(() => picture.evaluate((img) => (img as { complete: boolean }).complete))
        .toBe(true);
      const size = await picture.evaluate((img) => {
        const i = img as unknown as {
          naturalWidth: number;
          naturalHeight: number;
          getBoundingClientRect(): { width: number; height: number };
        };
        const box = i.getBoundingClientRect();
        return { natural: [i.naturalWidth, i.naturalHeight], shown: [box.width, box.height] };
      });
      expect(Math.round(size.shown[0]!)).toBe(size.natural[0]);
      expect(Math.round(size.shown[1]!)).toBe(size.natural[1]);
    }
  });
});
