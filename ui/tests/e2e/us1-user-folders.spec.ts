/**
 * Feature 015, User Story 1 (FR-001..FR-006): the user's genre file, script, template and
 * dictionary are in effect from the folder chosen in Settings, the per-user data folder and the
 * portable folder; the items the editor cannot use are listed in Settings with their reasons; a
 * script added while the editor runs is in the Scripts menu the next time it opens.
 */
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Browser, Page } from '@playwright/test';

import { expect, startCoreWith, test } from './fixtures/core';
import { seedChosenFolders, seedLayerRoot, USER_FOLDER_FIXTURES } from './fixtures/userFolders';

const KINDS = ['genres', 'scripts', 'template', 'dictionaries'] as const;

async function openEditor(browser: Browser, args: string[], dataDir: string) {
  const binary = process.env.MFBE_CORE_BIN!;
  const core = await startCoreWith(binary, dataDir, args);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(core.url);
  await page.locator('[data-testid="app-root"][data-startup="ready"]').waitFor();
  return { page, close: async () => (await context.close(), await core.stop()) };
}

async function expectInEffect(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  await expect(page.getByTestId('body-editor')).toContainText('USER TEMPLATE MARKER');
  await page.getByTestId('view-description').click();
  await page.getByTestId('description-genre-add').click();
  await page.getByTestId('genre-picker-filter').fill('my_test_genre');
  await expect(page.getByTestId('genre-picker-list')).toContainText('my_test_genre');
  await page.keyboard.press('Escape');
  await page.getByTestId('menu-scripts').click();
  await expect(page.getByTestId('menu-scripts-popup')).toContainText('My test script');
  await page.keyboard.press('Escape');
}

test.describe('US1 (feature 015) - your own genres, scripts and templates found where you put them', () => {
  test.beforeEach(() => {
    const binary = process.env.MFBE_CORE_BIN ?? '';
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
  });

  for (const layer of ['chosen', 'user', 'portable'] as const) {
    test(`the items in the ${layer} folder are in effect, the unusable ones listed`, async ({
      browser,
    }) => {
      const dir = mkdtempSync(path.join(tmpdir(), `mfbe-015-${layer}-`));
      const dataDir = path.join(dir, 'data');
      const portable = path.join(dir, 'portable');
      if (layer === 'chosen')
        seedChosenFolders(dataDir, path.join(dir, 'chosen'), KINDS, { passedOver: true });
      if (layer === 'user') seedLayerRoot(dataDir, KINDS, { passedOver: true });
      if (layer === 'portable') seedLayerRoot(portable, KINDS, { passedOver: true });
      const editor = await openEditor(browser, ['--portable-dir', portable], dataDir);
      try {
        await expectInEffect(editor.page);
        const page = editor.page;
        await page.getByTestId('menu-tools').click();
        await page.getByTestId('menu-tools-settings').click();
        await page.getByTestId('settings-tab-other').click();
        await expect(page.getByTestId('settings-passed-over-genres')).toContainText('genres.txt');
        const scripts = page.getByTestId('settings-passed-over-scripts');
        await expect(scripts).toContainText('stray.js');
        await expect(scripts).toContainText('no-description');
      } finally {
        await editor.close();
      }
    });
  }

  test('a script added while the editor runs is in the Scripts menu the next time it opens', async ({
    browser,
  }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-015-added-'));
    const dataDir = path.join(dir, 'data');
    const editor = await openEditor(
      browser,
      ['--portable-dir', path.join(dir, 'portable')],
      dataDir,
    );
    try {
      const page = editor.page;
      await page.getByTestId('menu-scripts').click();
      await expect(page.getByTestId('menu-scripts-popup')).not.toContainText('My test script');
      await page.keyboard.press('Escape');
      cpSync(
        path.join(USER_FOLDER_FIXTURES, 'my-test-script'),
        path.join(dataDir, 'scripts', 'my-test-script'),
        {
          recursive: true,
        },
      );
      await page.getByTestId('menu-scripts').click();
      await expect(page.getByTestId('menu-scripts-popup')).toContainText('My test script');
    } finally {
      await editor.close();
    }
  });
});
