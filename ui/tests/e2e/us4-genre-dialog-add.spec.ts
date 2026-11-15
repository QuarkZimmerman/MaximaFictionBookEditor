/**
 * Feature 015, User Story 4 (FR-014..FR-016, SC-004): Choose a genre adds a genre of the user's
 * own, which can be chosen at once and passes validation; codes already listed or not genre codes
 * are refused with the reason; the user's own genres are shown in their own colour - at least
 * 4.5:1 against the list in the light and the dark theme - with a marker and their file.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  const book = fixtureBook('unknown-genre.fb2');
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await page.getByTestId('view-description').click();
}

async function addInPicker(page: Page, code: string, name?: string): Promise<void> {
  await page.getByTestId('genre-picker-add-own').click();
  await page.getByTestId('add-genre-code').fill(code);
  if (name) await page.getByTestId('add-genre-name-en').fill(name);
}

/** The contrast of the option's text against the list's background (WCAG 2 relative luminance). */
const CONTRAST = `(() => {
  const option = document.querySelector('[data-testid="genre-picker-option-my_new_genre"]');
  const list = document.querySelector('[data-testid="genre-picker-list"]');
  const rgb = (c) => c.match(/[0-9.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const fg = lum(rgb(getComputedStyle(option).color));
  const bg = lum(rgb(getComputedStyle(list).backgroundColor));
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
})()`;

test.describe('US4 (feature 015) - adding a genre in Choose a genre; your own genres stand out', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });
  test.afterEach(async ({ core }) => {
    if (core.dataDir) rmSync(path.join(core.dataDir, 'genres'), { recursive: true, force: true });
    await core.rpc('resources.genres').catch(() => undefined);
  });

  test('a genre added in the dialog is chosen at once and passes validation', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await page.getByTestId('description-genre-0-choose').click();
    await addInPicker(page, 'my_new_genre', 'My new genre');
    await page.getByTestId('add-genre-button-ok').click();
    await expect(page.getByTestId('add-genre')).toBeHidden();
    await expect(page.getByTestId('genre-picker-list')).toHaveValue('my_new_genre');
    await page.getByTestId('genre-picker-button-ok').click();
    await expect(page.getByTestId('description-genre-0-code')).toContainText('my_new_genre');
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    await expect(page.getByTestId('status-validity')).toHaveText(/^\s*Valid\s*$/);
  });

  test('codes already listed or not genre codes are refused with the reason', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await page.getByTestId('description-genre-add').click();
    for (const [code, reason] of [
      ['sf_fantasy', /already listed/],
      ['   ', /cannot be empty/],
    ] as const) {
      await addInPicker(page, code);
      await expect(page.getByTestId('add-genre-problem')).toContainText(reason);
      await expect(page.getByTestId('add-genre-button-ok')).toBeDisabled();
      await page.getByTestId('add-genre-button-cancel').click();
    }
    await addInPicker(page, 'my_new_genre');
    await page.getByTestId('add-genre-button-ok').click();
    await addInPicker(page, 'my_new_genre');
    await expect(page.getByTestId('add-genre-problem')).toContainText(/already listed/);
    await page.getByTestId('add-genre-button-cancel').click();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`own genres have their colour, marker and file in the ${theme} theme`, async ({
      core,
      page,
    }) => {
      // The theme as the app sets it from the system (data-theme and color-scheme).
      await page.emulateMedia({ colorScheme: theme });
      await core.openApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await openBook(core, page);
      await page.getByTestId('description-genre-add').click();
      await addInPicker(page, 'my_new_genre', 'My new genre');
      await page.getByTestId('add-genre-button-ok').click();
      const own = page.getByTestId('genre-picker-option-my_new_genre');
      await expect(own).toHaveClass(/mfbe-genre-own/);
      await expect(own).toHaveAttribute('title', /my\.genres\.tsv/);
      await expect(own).toContainText('['); // the "[your file]" marker, not colour alone
      await expect(page.getByTestId('genre-picker-option-sf_fantasy')).not.toHaveClass(
        /mfbe-genre-own/,
      );
      expect(await page.evaluate<number>(CONTRAST)).toBeGreaterThanOrEqual(4.5);
      // The add button and the "?" are buttons like Cancel, not in the footer's muted colour.
      const colour = (testId: string) =>
        page.evaluate<string>(
          `getComputedStyle(document.querySelector('[data-testid="${testId}"]')).color`,
        );
      const cancel = await colour('genre-picker-button-cancel');
      expect(await colour('genre-picker-add-own')).toBe(cancel);
      expect(await colour('genre-file-help-picker')).toBe(cancel);
    });
  }
});
