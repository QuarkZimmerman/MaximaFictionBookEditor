/**
 * Performance journey (feature 008, T048, FR-036): with three dictionaries in use - the book's
 * Russian plus English and Ukrainian - a word just typed is marked, and the Spelling dialog shows
 * the suggestions of the first misspelled word, each within one second (times the CI factor of
 * docs/performance.md).
 */
import { expect, fixtureBook, test, waitForBook } from './fixtures/core';

const BUDGET_MS = 1000;
/** Hosted CI runners against a 2020-era laptop (docs/performance.md). */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
const BOOK = 'spell-en-in-ru.fb2';

test.describe('perf: spelling with three dictionaries (FR-036)', () => {
  test(
    'a typed misspelling is marked and the suggestions appear within 1 s',
    { tag: '@perf' },
    async ({ core, page }) => {
      await core.rpc('settings.set', {
        patch: {
          view: {
            spellEnabled: true,
            spellHighlight: true,
            spellExtraDictionaries: ['en_US', 'uk_UA'],
          },
        },
      });
      await core.openApp(page);
      await expect(page.getByTestId('status-message')).toHaveText('Ready');
      await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(BOOK)] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, BOOK);
      await expect(page.locator('span.mfbe-misspelled').first()).toBeVisible({ timeout: 15_000 });

      const paragraph = page.getByTestId('body-editor').locator('p').nth(2);
      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' ошибкаа ');
      const typed = Date.now();
      await expect(page.locator('span.mfbe-misspelled', { hasText: 'ошибкаа' })).toBeVisible({
        timeout: BUDGET_MS * PERF_FACTOR * 3,
      });
      const marked = Date.now() - typed;
      test.info().annotations.push({ type: 'marked-ms', description: String(marked) });
      expect(marked).toBeLessThan(BUDGET_MS * PERF_FACTOR);

      const opened = Date.now();
      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-spellcheck').click();
      const dialog = page.getByTestId('dialog-spelling');
      await expect(dialog.getByTestId('spelling-not-in-dictionary')).not.toHaveValue('', {
        timeout: BUDGET_MS * PERF_FACTOR * 3,
      });
      await expect(
        dialog
          .getByTestId('spelling-suggestions')
          .locator('option, [role="option"]')
          .first()
          .or(dialog.getByTestId('spelling-no-suggestions')),
      ).toBeVisible({ timeout: BUDGET_MS * PERF_FACTOR * 3 });
      const suggested = Date.now() - opened;
      test.info().annotations.push({ type: 'suggested-ms', description: String(suggested) });
      expect(suggested).toBeLessThan(BUDGET_MS * PERF_FACTOR);
    },
  );
});
