/**
 * Feature 012, User Story 6 (T061; D33; FR-051, FR-052; SC-011): an EPUB export or import is a one-time
 * operation, finished or cancelled. Afterwards:
 * - Recent files and the settings - the folder Open and Save As start in included - are as before;
 * - after an export, and after a cancelled import, the window's book is as before: its file
 *   byte-identical, its text, its modified state and its undo history;
 * - the next export proposes again from the book;
 * - no request has left the machine.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { epub, importDone, importViaMenu } from './fixtures/epubImport';
import { scratchDir } from './fixtures/scratch';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

interface DialogRequest {
  method: string;
  defaultPath?: string;
}

/** What an export or an import must leave as it was. */
async function trace(core: CoreHandle, page: Page, book?: string) {
  await page.getByTestId('menu-edit').click();
  const undo = await page.getByTestId('menu-edit-undo').getAttribute('aria-disabled');
  await page.keyboard.press('Escape');
  return {
    recent: await core.rpc('doc.recent'),
    settings: await core.rpc('settings.get'),
    text: await page.evaluate(() => window.__mfbeTest!.scripts!.toXml()),
    title: await page.title(),
    undo,
    file: book ? readFileSync(book).toString('base64') : null,
  };
}

/** Recent files and the settings only: an import replaces the window's book. */
async function editorTrace(core: CoreHandle) {
  return { recent: await core.rpc('doc.recent'), settings: await core.rpc('settings.get') };
}

async function openCopy(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = path.join(scratchDir('epub-once-'), name);
  copyFileSync(fixtureBook(name), book);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toBeVisible();
  return book;
}

async function exportEpub(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportEpub').click();
}

test.describe('US6 (feature 012) - one-time operations (D33)', () => {
  let offMachine: string[] = [];

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    offMachine = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!/^(blob|data):/.test(url) && !url.startsWith('http://127.0.0.1')) offMachine.push(url);
    });
    await core.openApp(page);
  });

  test.afterEach(() => {
    expect(offMachine).toEqual([]);
  });

  test('a finished export leaves the editor and the book as they were', async ({ core, page }) => {
    const book = await openCopy(core, page, 'german-book.fb2');
    const before = await trace(core, page, book);
    const target = path.join(path.dirname(book), 'out.epub');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await exportEpub(page);
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });
    expect(existsSync(target)).toBe(true);
    expect(await trace(core, page, book)).toEqual(before);
    // The next export proposes again from the book: the same name in the same folder.
    await core.enqueueDialog('dialog.saveFile', { path: null });
    await exportEpub(page);
    await expect
      .poll(async () => {
        const saves = (await core.rpc<DialogRequest[]>('test.dialogRequests')).filter(
          (request) => request.method === 'dialog.saveFile',
        );
        return saves.length >= 2 && saves.at(-1)!.defaultPath === saves.at(-2)!.defaultPath;
      })
      .toBe(true);
    expect(await trace(core, page, book)).toEqual(before);
  });

  test('a cancelled export writes nothing and leaves everything as it was', async ({
    core,
    page,
  }) => {
    const book = await openCopy(core, page, 'reference-all-elements.fb2');
    const before = await trace(core, page, book);
    // The files go to the core slowly, so that Cancel arrives while they are written.
    await page.route('**/epub-write/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const target = path.join(path.dirname(book), 'cancelled.epub');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await exportEpub(page);
    await expect(page.getByTestId('modal-job')).toBeVisible();
    await page.getByTestId('modal-job-cancel').click();
    await expect(page.getByTestId('modal-job')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('status-message')).toContainText('cancelled');
    await page.unroute('**/epub-write/**');
    expect(existsSync(target)).toBe(false);
    expect(await trace(core, page, book)).toEqual(before);
  });

  test('a finished import leaves Recent files and the settings as they were', async ({
    core,
    page,
  }) => {
    const before = await editorTrace(core);
    await importDone(page, await importViaMenu(core, page, epub('epub-3.3.epub')));
    expect(await editorTrace(core)).toEqual(before);
  });

  test("a cancelled import leaves the window's book and the editor as they were", async ({
    core,
    page,
  }) => {
    const book = await openCopy(core, page, 'german-book.fb2');
    const before = await trace(core, page, book);
    await page.route('**/epub/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await importViaMenu(core, page, epub('epub-3.3.epub'));
    await expect(page.getByTestId('modal-job')).toBeVisible();
    await page.getByTestId('modal-job-cancel').click();
    await expect(page.getByTestId('modal-job')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('status-message')).toContainText('cancelled');
    await page.unroute('**/epub/**');
    expect(await trace(core, page, book)).toEqual(before);
  });
});
