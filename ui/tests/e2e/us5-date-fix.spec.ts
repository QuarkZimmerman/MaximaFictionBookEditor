/**
 * Feature 015, User Story 5 (FR-018..FR-022, SC-005): Fix writes a date value in a wrong but
 * meaningful format as year-month-day, as one undo step and leaving the date's text; a value that
 * reads two ways lets the user choose the day; junk and incomplete values get no Fix.
 */
import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

async function openBook(core: CoreHandle, page: Page, name: string): Promise<void> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await page.getByTestId('view-description').click();
}

test.describe('US5 (feature 015) - Fix for dates in a wrong format', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('a date with a time is fixed in one action, one undo step, its text kept', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'wrong-dates.fb2');
    const value = page.getByTestId('description-date-value');
    const fix = page.getByTestId('description-date-fix');
    await expect(value).toHaveValue('2026-10-30 23:46');
    await expect(fix).toBeEnabled();
    await fix.click();
    await expect(value).toHaveValue('2026-10-30');
    await expect(page.getByTestId('description-date-text')).toHaveValue('30 October 2026');
    await expect(fix).toBeDisabled(); // a valid date: nothing to fix
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect(value).toHaveValue('2026-10-30 23:46');
  });

  test('a date read two ways shows both days; Cancel keeps the value, a choice writes it', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'wrong-dates.fb2');
    const value = page.getByTestId('description-doc-date-value');
    await expect(value).toHaveValue('03/04/2026');
    await page.getByTestId('description-doc-date-fix').click();
    const choice = page.getByTestId('date-fix-choice');
    await expect(choice.getByTestId('date-fix-choice-button-a')).toHaveText('April 3, 2026');
    await expect(choice.getByTestId('date-fix-choice-button-b')).toHaveText('March 4, 2026');
    await choice.getByTestId('date-fix-choice-button-cancel').click();
    await expect(choice).toBeHidden();
    await expect(value).toHaveValue('03/04/2026');
    await page.getByTestId('description-doc-date-fix').click();
    await page.getByTestId('date-fix-choice-button-b').click();
    await expect(value).toHaveValue('2026-03-04');
  });

  test('junk and incomplete values get no Fix; validation still reports them', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'wrong-dates.fb2');
    await expect(page.getByTestId('description-sti-date-value')).toHaveValue('abc');
    await expect(page.getByTestId('description-sti-date-fix')).toBeDisabled();
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    await expect(page.getByTestId('status-validity')).toContainText(/Errors/);

    await openBook(core, page, 'wrong-dates-2.fb2');
    await expect(page.getByTestId('description-date-value')).toHaveValue('2026');
    await expect(page.getByTestId('description-date-fix')).toBeDisabled();
    await expect(page.getByTestId('description-doc-date-value')).toHaveValue('30 октября 2026 г.');
    await page.getByTestId('description-doc-date-fix').click();
    await expect(page.getByTestId('description-doc-date-value')).toHaveValue('2026-10-30');
  });
});
