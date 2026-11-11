/**
 * Feature 012, User Story 5 - The named style's name in its tooltip (D41; FR-070; SC-018). Runs against
 * the real core with tests/fixtures/books/named-style-tips.fb2: resting the pointer on each case shows
 * one tooltip naming every style in effect, the outermost first, the id on a line of its own, an
 * undefined style marked as such - in English, Russian and Ukrainian, and the same with the book's
 * styles shown.
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const CASES: [text: string, en: string, ru: string, uk: string][] = [
  ['A styled span', 'Named style: letter', 'Именованный стиль: letter', 'Іменований стиль: letter'],
  ['A styled paragraph.', 'Named style: sign', 'Именованный стиль: sign', 'Іменований стиль: sign'],
  [
    'lettered',
    'Named styles: sign, letter',
    'Именованные стили: sign, letter',
    'Іменовані стилі: sign, letter',
  ],
  ['Plain cell', 'Named style: grid', 'Именованный стиль: grid', 'Іменований стиль: grid'],
  [
    'Styled cell',
    'Named styles: grid, cell',
    'Именованные стили: grid, cell',
    'Іменовані стилі: grid, cell',
  ],
  [
    'styled text',
    'Named style: letter\n#chapter-2',
    'Именованный стиль: letter\n#chapter-2',
    'Іменований стиль: letter\n#chapter-2',
  ],
  [
    'An undefined style',
    'Named style: ghost (not in the stylesheets)',
    'Именованный стиль: ghost (нет в таблицах стилей)',
    'Іменований стиль: ghost (немає в таблицях стилів)',
  ],
];

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  const book = fixtureBook('named-style-tips.fb2');
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toBeVisible();
}

async function tipOver(page: Page, text: string): Promise<string | null> {
  const editor = page.getByTestId('body-editor');
  await editor.getByText(text, { exact: true }).hover();
  return editor.getAttribute('title');
}

test.describe('US5 (feature 012) - the named-style tooltip', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.rpc('settings.set', {
      patch: { view: { uiLanguage: 'en', spellEnabled: false, showBookStyles: false } },
    });
  });

  test('every case names its styles, the outermost first, with the id and undefined styles', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page);
    for (const [text, en] of CASES) {
      await expect.poll(() => tipOver(page, text), text).toBe(en);
    }
    // Plain text names nothing.
    await expect.poll(() => tipOver(page, 'Named styles')).toBeNull();
  });

  for (const language of ['ru', 'uk'] as const) {
    test(`the words are in ${language === 'ru' ? 'Russian' : 'Ukrainian'}, the names as written`, async ({
      core,
      page,
    }) => {
      await core.rpc('settings.set', { patch: { view: { uiLanguage: language } } });
      await core.openApp(page);
      await openBook(core, page);
      for (const [text, , ru, uk] of CASES) {
        await expect.poll(() => tipOver(page, text), text).toBe(language === 'ru' ? ru : uk);
      }
    });
  }

  test("the tooltip is the same with the book's styles shown (FR-070)", async ({ core, page }) => {
    await core.rpc('settings.set', { patch: { view: { showBookStyles: true } } });
    await core.openApp(page);
    await openBook(core, page);
    await expect(page.getByTestId('body-view')).toHaveClass(/\bmfbe-book-styles\b/);
    for (const [text, en] of CASES) {
      await expect.poll(() => tipOver(page, text), text).toBe(en);
    }
  });
});
