/**
 * Save's question before an export (requester, rc.5): as Save asks before writing an invalid book,
 * File > Export > Markdown, Markdown ZIP, EPUB and PDF ask "export anyway?" before their Save
 * dialog. No stops before the Save dialog and writes nothing, Yes goes on to it and exports the
 * book as it is; a valid book is exported without the question.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport, EXPORT_CHECK, saveDialogRequests } from './fixtures/exportCheck';
import { pagePattern } from './fixtures/i18n';
import { scratchDir } from './fixtures/scratch';

const EXPORTS = ['exportMarkdown', 'exportMarkdownZip', 'exportEpub', 'exportPdf'];

async function openBook(core: CoreHandle, page: Page, name: string): Promise<void> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
}

async function clickItem(page: Page, item: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId(`menu-file-export-${item}`).click();
}

test.describe('the question before an export (requester, rc.5)', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('an invalid book: every export asks first, and No stops before the Save dialog', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'invalid-for-export.fb2');
    const before = await saveDialogRequests(core);
    for (const item of EXPORTS) {
      await clickItem(page, item);
      await expect(page.getByTestId(EXPORT_CHECK)).toBeVisible();
      await expect(page.getByTestId(`${EXPORT_CHECK}-text`)).toHaveText(
        await pagePattern(page, 'transfer.export.validationFailed'),
      );
      await page.getByTestId(`${EXPORT_CHECK}-button-no`).click();
      await expect(page.getByTestId(EXPORT_CHECK)).toHaveCount(0);
    }
    expect(await saveDialogRequests(core)).toBe(before);
  });

  test('Yes goes on to the Save dialog and exports the book as it is', async ({ core, page }) => {
    await openBook(core, page, 'invalid-for-export.fb2');
    const target = path.join(scratchDir('export-validity-'), 'invalid.md');
    await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
    expect(await clickExport(core, page, 'exportMarkdown')).toBe(true);
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}`, {
      timeout: 30_000,
    });
    expect(existsSync(target)).toBe(true);
  });

  test('a valid book is exported without the question', async ({ core, page }) => {
    await openBook(core, page, 'reference-all-elements.fb2');
    const target = path.join(scratchDir('export-validity-'), 'valid.md');
    await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
    expect(await clickExport(core, page, 'exportMarkdown')).toBe(false);
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}`, {
      timeout: 30_000,
    });
  });
});
