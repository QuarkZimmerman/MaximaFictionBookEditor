/**
 * Feature 015, User Story 2 (FR-007, FR-008, SC-006): the editor explains how to name and write a
 * genre file - in Settings > Other and in Choose a genre, by pointer and keyboard, in English,
 * Russian and Ukrainian - and a file written exactly from its example is picked up.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Browser, Page } from '@playwright/test';

import { expect, startCoreWith, test } from './fixtures/core';

async function openEditor(browser: Browser, dataDir: string, query = '') {
  const core = await startCoreWith(process.env.MFBE_CORE_BIN!, dataDir, []);
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = new URL(core.url);
  for (const [key, value] of new URLSearchParams(query)) url.searchParams.set(key, value);
  await page.goto(url.toString());
  await page.locator('[data-testid="app-root"][data-startup="ready"]').waitFor();
  return { page, close: async () => (await context.close(), await core.stop()) };
}

async function openPicker(page: Page) {
  await page.getByTestId('view-description').click();
  await page.getByTestId('description-genre-add').click();
  await expect(page.getByTestId('genre-picker-list')).toBeVisible();
}

const EXPLANATION = ['.genres.tsv', 'UTF-8', 'my.genres.tsv'];

test.describe('US2 (feature 015) - the editor explains genre files', () => {
  test.beforeEach(() => {
    test.skip(!/mfbe-core/.test(path.basename(process.env.MFBE_CORE_BIN ?? '')), 'needs mfbe-core');
  });

  test('Settings > Other and Choose a genre explain the rule, the fields, the languages and an example', async ({
    browser,
  }) => {
    const editor = await openEditor(browser, mkdtempSync(path.join(tmpdir(), 'mfbe-015-help-')));
    try {
      const page = editor.page;
      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-settings').click();
      await page.getByTestId('settings-tab-other').click();
      const button = page.getByTestId('genre-file-help-settings');
      await button.click();
      const help = page.getByTestId('genre-file-help-popover');
      for (const text of EXPLANATION) await expect(help).toContainText(text);
      await expect(page.getByTestId('genre-file-help-example')).toBeVisible();
      await expect(help).toContainText('Ukrainian');
      // Esc closes the explanation only; the keyboard opens it again.
      await page.keyboard.press('Escape');
      await expect(help).toBeHidden();
      await expect(page.getByTestId('settings-tab-other')).toBeVisible();
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(help).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await openPicker(page);
      await page.getByTestId('genre-file-help-picker').click();
      for (const text of EXPLANATION) await expect(help).toContainText(text);
    } finally {
      await editor.close();
    }
  });

  for (const [lang, word] of [
    ['ru', 'Пример'],
    ['uk', 'Приклад'],
  ] as const) {
    test(`the explanation is in the ${lang} interface's language`, async ({ browser }) => {
      const editor = await openEditor(
        browser,
        mkdtempSync(path.join(tmpdir(), `mfbe-015-help-${lang}-`)),
        `?lang=${lang}`,
      );
      try {
        await openPicker(editor.page);
        await editor.page.getByTestId('genre-file-help-picker').click();
        await expect(editor.page.getByTestId('genre-file-help-popover')).toContainText(word);
      } finally {
        await editor.close();
      }
    });
  }

  test('a genre file written exactly from the example is picked up (SC-006)', async ({
    browser,
  }) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-015-example-'));
    const editor = await openEditor(browser, dataDir);
    try {
      const page = editor.page;
      await openPicker(page);
      await page.getByTestId('genre-file-help-picker').click();
      const line = await page.getByTestId('genre-file-help-example').getAttribute('data-line');
      expect(line).toContain('\t');
      const code = line!.split('\t')[0]!;
      mkdirSync(path.join(dataDir, 'genres'), { recursive: true });
      writeFileSync(path.join(dataDir, 'genres', 'example.genres.tsv'), `${line}\n`, 'utf8');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await openPicker(page);
      await page.getByTestId('genre-picker-filter').fill(code);
      await expect(page.getByTestId('genre-picker-list')).toContainText(code);
    } finally {
      await editor.close();
    }
  });
});
