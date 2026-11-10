/**
 * Guard G12 (feature 011, research 2.3; D32, SC-010): an export or an import leaves no trace - after
 * Export as FBD…, each Markdown export, Import → Description… and the Markdown import, Recent files
 * are as before and the next Open starts in the folder it started in before.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const BOOK = fixtureBook('modern-utf8.fb2');

async function menu(page: Page, submenu: string, entry: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-file-${submenu}`).hover();
  await page.getByTestId(`menu-file-${submenu}-${entry}`).click();
}

/** The folder the next Open starts in (the core's request, as test.dialogRequests records it). */
async function openFolder(core: CoreHandle, page: Page): Promise<string> {
  await core.enqueueDialog('dialog.openFile', { paths: [] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await expect
    .poll(async () => (await core.rpc<unknown[]>('test.dialogRequests')).length)
    .toBeGreaterThan(0);
  const requests =
    await core.rpc<Array<{ folder?: string; params?: { folder?: string } }>>('test.dialogRequests');
  const last = requests.at(-1) ?? {};
  return last.folder ?? last.params?.folder ?? '';
}

test.describe('guard G12: exports and imports leave no trace', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-g12-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, BOOK);
  });

  for (const [name, submenu, entry, answer] of [
    ['Export as FBD', 'export', 'exportFbd', { path: 'book.fbd' }],
    ['Export as Markdown', 'export', 'exportMarkdown', { path: 'book.md', zip: false }],
    ['Export as Markdown ZIP', 'export', 'exportMarkdownZip', { path: 'book.md.zip' }],
  ] as const) {
    test(`${name} keeps Recent files and the folder Open starts in`, async ({ core, page }) => {
      const recent = await core.rpc('doc.recent');
      const before = await openFolder(core, page);
      await core.enqueueDialog('dialog.saveFile', { ...answer, path: path.join(dir, answer.path) });
      await menu(page, submenu, entry);
      await expect(page.getByTestId('status-message')).toContainText(/Export/i, {
        timeout: 30_000,
      });
      expect(await core.rpc('doc.recent')).toEqual(recent);
      expect(await openFolder(core, page)).toBe(before);
    });
  }

  for (const [name, entry] of [
    ['Import description', 'importDescription'],
    ['Markdown import', 'importMarkdown'],
  ] as const) {
    test(`${name}, cancelled in its dialog, keeps the folder Open starts in`, async ({
      core,
      page,
    }) => {
      const recent = await core.rpc('doc.recent');
      const before = await openFolder(core, page);
      await core.enqueueDialog('dialog.openFile', { paths: [] });
      await menu(page, 'import', entry);
      await expect
        .poll(async () => (await core.rpc<unknown[]>('test.dialogRequests')).length)
        .toBeGreaterThan(1);
      expect(await core.rpc('doc.recent')).toEqual(recent);
      expect(await openFolder(core, page)).toBe(before);
    });
  }
});
