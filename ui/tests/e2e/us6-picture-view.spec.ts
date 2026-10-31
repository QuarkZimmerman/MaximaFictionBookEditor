/**
 * Feature 007, User Story 6 (T099; spec FR-050 to FR-056, data-model §5): a click on a picture's
 * thumbnail in the Description view's Binary objects list shows the picture at its natural
 * size, over the whole window. A picture larger than the window opens fitted and switches to
 * its natural size, scrollable, on a click; Esc, the close control and a click outside close
 * the view. The thumbnail says so by its pointer and tooltip, and works from the keyboard. A
 * binary the editor cannot show has no view; hovering opens nothing.
 *
 * Book: `tests/fixtures/books/picture-view.fb2` (small.jpg 572×603, big.jpg 3000×4000, scan.tif
 * 640×480, blob.bin not a picture). Runs against the real core; skipped in core-less mode.
 */

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook('picture-view.fb2')] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, 'picture-view.fb2');
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
  await page.getByTestId('description-binaries-list').scrollIntoViewIfNeeded();
}

async function loaded(picture: Locator): Promise<void> {
  await expect
    .poll(() =>
      picture.evaluate((img) => {
        const image = img as unknown as { complete: boolean; naturalWidth: number };
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
}

async function shownSize(picture: Locator): Promise<{ width: number; height: number }> {
  return picture.evaluate((img) => {
    const box = img.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
}

async function viewOf(page: Page, id: string): Promise<Locator> {
  await page.getByTestId(`binary-objects-view-${id}`).click();
  const picture = page.getByTestId('picture-view-picture');
  await expect(picture).toBeVisible();
  await loaded(picture);
  return picture;
}

test.describe('US6 - a picture of the book at its natural size', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs the real core (MFBE_CORE_BIN)');
  });

  test('a picture that fits the window shows at its natural size', async ({ core, page }) => {
    await openBook(core, page);
    const picture = await viewOf(page, 'small.jpg');
    await expect(page.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
    expect(await shownSize(picture)).toEqual({ width: 572, height: 603 });
    expect(
      await picture.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
    ).toBe(572);
    // The original bytes, not the reduced preview.
    await expect(picture).toHaveAttribute('src', /\/binary\/[^/]+\/small\.jpg(\?|$)/);
    // A picture that fits does not toggle.
    await picture.click();
    await expect(page.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
  });

  test('a large picture opens fitted, a click shows it whole and scrollable, a click fits it again', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const picture = await viewOf(page, 'big.jpg');
    const view = page.getByTestId('picture-view');
    const area = page.getByTestId('picture-view-area');
    const viewport = page.viewportSize()!;
    await expect(view).toHaveAttribute('data-mode', 'fitted');
    const fitted = await shownSize(picture);
    expect(fitted.height).toBeLessThanOrEqual(viewport.height);
    expect(fitted.width).toBeLessThanOrEqual(viewport.width);
    // Proportional: 3000:4000.
    expect(Math.abs(fitted.width / fitted.height - 0.75)).toBeLessThan(0.01);
    await expect(picture).toHaveCSS('cursor', 'zoom-in');
    await expect(picture).toHaveAttribute('title', /natural size/);

    await picture.click();
    await expect(view).toHaveAttribute('data-mode', 'natural');
    expect(await shownSize(picture)).toEqual({ width: 3000, height: 4000 });
    const scroll = await area.evaluate((el) => ({
      scrollable: el.scrollHeight > el.clientHeight && el.scrollWidth > el.clientWidth,
    }));
    expect(scroll.scrollable).toBe(true);
    await area.evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(picture).toHaveCSS('cursor', 'zoom-out');

    await picture.click();
    await expect(view).toHaveAttribute('data-mode', 'fitted');
    expect(await shownSize(picture)).toEqual(fitted);
  });

  test('Esc, the close control and a click outside the picture each close the view', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await viewOf(page, 'small.jpg');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture-view')).toHaveCount(0);

    await viewOf(page, 'small.jpg');
    await page.getByTestId('picture-view-close').click();
    await expect(page.getByTestId('picture-view')).toHaveCount(0);

    await viewOf(page, 'small.jpg');
    await page.getByTestId('picture-view-area').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
    // The view changed nothing in the book.
    await expect(page).toHaveTitle(/^picture-view\.fb2 - /);
  });

  test('the thumbnail is a button: pointer, tooltip, and Enter from the keyboard', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const button = page.getByTestId('binary-objects-view-big.jpg');
    await expect(button).toHaveAttribute('title', 'Click to see the picture at its natural size');
    await expect(button).toHaveCSS('cursor', 'zoom-in');
    // Hovering opens nothing (FR-056: no hover preview).
    await button.hover();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picture-view')).toBeVisible();
    await expect(page.getByTestId('picture-view')).toHaveAttribute('data-mode', 'fitted');
    // Enter on the picture toggles as a click does.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picture-view')).toHaveAttribute('data-mode', 'natural');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('a TIFF shows through the core’s preview; a binary that is no picture has no view', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const picture = await viewOf(page, 'scan.tif');
    await expect(picture).toHaveAttribute('src', /\/scan\.tif\/preview\?w=640&h=480/);
    expect(
      await picture.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
    ).toBe(640);
    expect(await shownSize(picture)).toEqual({ width: 640, height: 480 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('binary-objects-row-blob.bin')).toBeVisible();
    await expect(page.getByTestId('binary-objects-view-blob.bin')).toHaveCount(0);
  });
});
