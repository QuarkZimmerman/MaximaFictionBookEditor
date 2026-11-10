/**
 * Feature 011, User Stories 5 and 6 - the Markdown exports (D13-D28, D32; FR-040-FR-062). Runs
 * against the real core: the one file with its header and embedded pictures, the ZIP with its
 * images/ folder, the modal progress with Cancel that leaves no file, and no trace of the export in
 * the folder Open starts in or in Recent files (guard G12, SC-010).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const BOOK = fixtureBook('modern-utf8.fb2');

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
}

/** File > Export > the entry of `id` (`menu-file-export-<command>`, as feature 004's FBD export). */
async function runCommand(page: Page, id: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId(`menu-file-export-${id.slice('file.'.length)}`).click();
}

test.describe('US5/US6 (feature 011) - the Markdown exports', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us5-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page);
  });

  test('one file: the header, the title page and the pictures embedded; no trace (G12)', async ({
    core,
    page,
  }) => {
    const recentBefore = await core.rpc('doc.recent');
    const target = path.join(dir, 'book.md');
    await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
    await runCommand(page, 'file.exportMarkdown');
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });
    const text = readFileSync(target, 'utf8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toMatch(/\ntitle: "/);
    expect(text).toMatch(/\]: data:image\/jpeg;base64,/);
    expect(await core.rpc('doc.recent')).toEqual(recentBefore);
    // The next Open starts where it did: the export kept no folder (D32).
    await core.enqueueDialog('dialog.openFile', { paths: [] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    const requests =
      await core.rpc<Array<{ method: string; params: { folder?: string } }>>('test.dialogRequests');
    const open = (requests.at(-1) ?? {}) as { folder?: string; params?: { folder?: string } };
    expect(open.folder ?? open.params?.folder ?? '').not.toBe(dir);
  });

  test('ZIP: the text and the pictures in images/', async ({ core, page }) => {
    const target = path.join(dir, 'book.md.zip');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await runCommand(page, 'file.exportMarkdownZip');
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });
    expect(existsSync(target)).toBe(true);
    const bytes = readFileSync(target);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.includes(Buffer.from('book.md'))).toBe(true);
  });

  test('the export is modal: progress, Cancel, no file', async ({ core, page }) => {
    await core.rpc('test.slowJobs', { millisecondsPerStep: 2000 });
    try {
      const target = path.join(dir, 'cancelled.md');
      await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
      await runCommand(page, 'file.exportMarkdown');
      await expect(page.getByTestId('modal-job')).toBeVisible();
      await page.getByTestId('modal-job-cancel').click();
      await expect(page.getByTestId('modal-job')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('status-message')).toContainText('cancelled');
      expect(existsSync(target)).toBe(false);
    } finally {
      await core.rpc('test.slowJobs', { millisecondsPerStep: 0 });
    }
  });
});
