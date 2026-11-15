/**
 * Feature 015, User Story 3 (FR-009..FR-013, FR-017): a book's unknown genre is added to the
 * user's own genres with the "+" beside it on the Description page; from then on validation, the
 * export check and a new start know it. No "+" for a value that is not a genre code; a genres
 * folder that cannot be written is named and nothing changes.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  startCoreWith,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { scratchDir } from './fixtures/scratch';

async function openBook(core: CoreHandle, page: Page, book: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await page.getByTestId('view-description').click();
}

function ownFile(core: CoreHandle): string {
  return path.join(core.dataDir!, 'genres', 'my.genres.tsv');
}

test.describe('US3 (feature 015) - "+" adds a book\'s unknown genre to your own genres', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });
  test.afterEach(async ({ core }) => {
    // The worker's core serves later journeys: its genres go back to the standard ones.
    if (core.dataDir) rmSync(path.join(core.dataDir, 'genres'), { recursive: true, force: true });
    await core.rpc('resources.genres').catch(() => undefined);
  });

  test('the unknown genre is marked, "+" adds it, and it is known everywhere', async ({
    core,
    page,
  }) => {
    const book = fixtureBook('unknown-genre.fb2');
    await openBook(core, page, book);
    const row = page.getByTestId('description-genre-0');
    const code = page.getByTestId('description-genre-0-code');
    await expect(code).toHaveClass(/mfbe-desc-genre-unknown/);
    const plus = page.getByTestId('description-genre-0-add-own');
    await expect(plus).toBeHidden();
    // The keyboard focus shows it as the pointer does.
    await code.focus();
    await expect(plus).toBeVisible();
    await page.mouse.move(0, 0);
    await row.hover();
    await plus.click();
    const dialog = page.getByTestId('add-genre');
    await expect(page.getByTestId('add-genre-code')).toHaveValue('my_unknown_genre');
    await page.getByTestId('add-genre-name-en').fill('My unknown genre');
    await dialog.getByTestId('add-genre-button-ok').click();
    await expect(dialog).toBeHidden();
    await expect(code).not.toHaveClass(/mfbe-desc-genre-unknown/);
    await expect(code).toContainText('My unknown genre');
    expect(existsSync(ownFile(core))).toBe(true);

    // Validation and the export check accept it.
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    await expect(page.getByTestId('status-validity')).toHaveText(/^\s*Valid\s*$/);
    const target = path.join(scratchDir('us3-unknown-genre-'), 'book.md');
    await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
    expect(await clickExport(core, page, 'exportMarkdown')).toBe(false);

    // A new start on the same files knows it.
    const copy = mkdtempSync(path.join(tmpdir(), 'mfbe-015-restart-'));
    cpSync(path.join(core.dataDir!, 'genres'), path.join(copy, 'genres'), { recursive: true });
    const second = await startCoreWith(process.env.MFBE_CORE_BIN!, copy, ['--open', book]);
    const context = await page.context().browser()!.newContext();
    try {
      const other = await context.newPage();
      await other.goto(second.url);
      await other.locator('[data-testid="app-root"][data-startup="ready"]').waitFor();
      await other.getByTestId('view-description').click();
      await expect(other.getByTestId('description-genre-0-code')).toContainText('My unknown genre');
      await expect(other.getByTestId('description-genre-0-code')).not.toHaveClass(
        /mfbe-desc-genre-unknown/,
      );
    } finally {
      await context.close();
      await second.stop();
    }
  });

  test('a value that is not a genre code gets no "+", and says why', async ({ core, page }) => {
    const book = path.join(scratchDir('us3-invalid-code-'), 'invalid-code.fb2');
    const text = (await import('node:fs')).readFileSync(fixtureBook('unknown-genre.fb2'), 'utf8');
    writeFileSync(book, text.replace('<genre>my_unknown_genre</genre>', '<genre>My Genre</genre>'));
    await openBook(core, page, book);
    await page.getByTestId('description-genre-0').hover();
    await expect(page.getByTestId('description-genre-0-add-own')).toHaveCount(0);
    await expect(page.getByTestId('description-genre-0-code')).toHaveAttribute(
      'title',
      /genre code/i,
    );
  });

  test('a genres folder that cannot be written is named, and nothing changes', async ({
    core,
    page,
  }) => {
    test.skip(process.getuid?.() === 0, 'root writes into every folder');
    const folder = path.join(core.dataDir!, 'genres');
    mkdirSync(folder, { recursive: true });
    chmodSync(folder, 0o500);
    try {
      await openBook(core, page, fixtureBook('unknown-genre.fb2'));
      await page.getByTestId('description-genre-0').hover();
      await page.getByTestId('description-genre-0-add-own').click();
      await page.getByTestId('add-genre-button-ok').click();
      await expect(page.getByTestId('add-genre-error')).toContainText(folder);
      await page.getByTestId('add-genre-button-cancel').click();
      await expect(page.getByTestId('description-genre-0-code')).toHaveClass(
        /mfbe-desc-genre-unknown/,
      );
      expect(existsSync(path.join(folder, 'my.genres.tsv'))).toBe(false);
    } finally {
      chmodSync(folder, 0o700);
    }
  });
});
