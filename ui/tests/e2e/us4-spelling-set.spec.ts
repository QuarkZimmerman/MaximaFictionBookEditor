/**
 * Feature 008, User Story 4 (T044, SC-005): a Russian book is checked against its own dictionary
 * and the extra ones of Settings - English and Russian by default -, so correct English words are
 * not marked while misspelled English and Russian words are. Unticking English marks them again.
 */
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

interface Expected {
  correctEnglish: string[];
  misspelledEnglish: string[];
  misspelledRussian: string[];
}

const BOOK = 'spell-en-in-ru.fb2';
const EXPECTED = JSON.parse(
  readFileSync(fixtureBook('spell-en-in-ru.expected.json'), 'utf8'),
) as Expected;

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(BOOK)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
}

/** The words the Body view marks, once the marks settled. */
async function marked(page: Page, expectedAtLeast: number): Promise<Set<string>> {
  const spans = page.locator('span.mfbe-misspelled');
  await expect
    .poll(() => spans.count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(expectedAtLeast);
  await page.waitForTimeout(500);
  return new Set((await spans.allTextContents()).map((t) => t.trim()));
}

test.describe('US4: spelling with the book dictionary and the extra ones', () => {
  test.beforeEach(async ({ core }) => {
    await core.rpc('settings.set', {
      patch: { view: { spellEnabled: true, spellHighlight: true, spellExtraDictionaries: null } },
    });
  });

  test('with the defaults no correct English word is marked, every misspelled word is', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const misspelled = [...EXPECTED.misspelledEnglish, ...EXPECTED.misspelledRussian];
    const words = await marked(page, misspelled.length);
    for (const word of EXPECTED.correctEnglish) expect(words, word).not.toContain(word);
    for (const word of misspelled) expect(words, word).toContain(word);
  });

  test('unticking English marks the English words again', async ({ core, page }) => {
    await core.rpc('settings.set', { patch: { view: { spellExtraDictionaries: ['ru_RU'] } } });
    await openBook(core, page);
    const words = await marked(page, 100);
    expect(words).toContain('house');
    expect(words).toContain('garden');
  });

  test('Settings shows the base dictionary always used and the extra ones ticked', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await page.getByTestId('settings-tab-view').click();
    await expect(page.getByTestId('settings-page-view')).toBeVisible();
    const base = page.getByTestId('settings-view-spell-extra-ru_RU');
    await expect(base).toBeChecked();
    await expect(base).toBeDisabled();
    await expect(page.getByTestId('settings-view-spell-extra-en_US')).toBeChecked();
    await expect(page.getByTestId('settings-view-spell-extra-uk_UA')).not.toBeChecked();
  });
});
