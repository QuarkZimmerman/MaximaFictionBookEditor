/**
 * Feature 012, User Story 6 (T060, guard G15; D32; FR-050; SC-012): EPUB support loads only when it is
 * used. The journey records every file of the interface's bundle the page requests (`/assets/`):
 * - ordinary work - start-up, opening, editing, saving, the Markdown and FBD exports, Preview,
 *   Validate and the Markdown import - loads neither EPUB part;
 * - an EPUB import loads its part and not the export's, an EPUB export the reverse; the tables both
 *   read (`epub-shared`) come with either;
 * - the first export shows its progress at once, while its part loads.
 */

import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { epub, importDone, importViaMenu } from './fixtures/epubImport';
import { scratchDir } from './fixtures/scratch';

/** The bundle's files the page requested, by name. */
function recordAssets(page: Page): string[] {
  const assets: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.includes('/assets/')) assets.push(pathname.slice(pathname.lastIndexOf('/') + 1));
  });
  return assets;
}

/** The EPUB parts among them (`epub-import`, `epub-export`, `epub-shared`). */
function epubParts(assets: readonly string[]): string[] {
  return [
    ...new Set(assets.flatMap((name) => /^(epub-[a-z]+)-.*\.js$/.exec(name)?.[1] ?? [])),
  ].sort();
}

/** Opens a copy of a fixture book, so that saving it touches no fixture. */
async function openCopy(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = path.join(scratchDir('epub-lazy-'), name);
  copyFileSync(fixtureBook(name), book);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  await expect(page.getByTestId('body-editor')).toBeVisible();
  return book;
}

async function fileMenu(page: Page, submenu: 'export' | 'import' | null, item: string) {
  await page.getByTestId('menu-file').click();
  if (submenu) await page.getByTestId(`menu-file-${submenu}`).hover();
  await page.getByTestId(submenu ? `menu-file-${submenu}-${item}` : `menu-file-${item}`).click();
}

test.describe('US6 (feature 012) - EPUB support loads only when it is used', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('ordinary work loads neither EPUB part (G15)', async ({ core, page }) => {
    const assets = recordAssets(page);
    await core.openApp(page);
    const book = await openCopy(core, page, 'reference-all-elements.fb2');
    const dir = path.dirname(book);
    // Editing and saving.
    await page.getByTestId('body-editor').getByText('A quotation.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Edited.');
    await expect.poll(() => page.title()).toMatch(/\* - /);
    await fileMenu(page, null, 'save');
    await expect.poll(() => page.title()).not.toMatch(/\* - /);
    // The Markdown and FBD exports.
    const markdown = path.join(dir, 'book.md');
    await core.enqueueDialog('dialog.saveFile', { path: markdown, zip: true });
    await fileMenu(page, 'export', 'exportMarkdown');
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${markdown}`, {
      timeout: 30_000,
    });
    const fbd = path.join(dir, 'book.fbd');
    await core.enqueueDialog('dialog.saveFile', { path: fbd });
    await fileMenu(page, 'export', 'exportFbd');
    await expect.poll(() => existsSync(fbd), { timeout: 30_000 }).toBe(true);
    // Preview and Validate.
    await page.keyboard.press('Shift+F5');
    await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('preview-close').click();
    await fileMenu(page, null, 'validate');
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    // The Markdown import, last: it replaces the window's book.
    const incoming = path.join(dir, 'incoming.md');
    writeFileSync(incoming, '# A title\n\nSome *text*.\n');
    await core.enqueueDialog('dialog.openFile', { paths: [incoming] });
    await fileMenu(page, 'import', 'importMarkdown');
    await expect(page.getByTestId('status-message')).toContainText('(utf-8)', { timeout: 30_000 });
    expect(assets.length).toBeGreaterThan(0);
    expect(epubParts(assets)).toEqual([]);
  });

  test("an EPUB import loads its part and not the export's", async ({ core, page }) => {
    const assets = recordAssets(page);
    await core.openApp(page);
    await importDone(page, await importViaMenu(core, page, epub('epub-3.3.epub')));
    expect(epubParts(assets)).toEqual(['epub-import', 'epub-shared']);
  });

  test("an EPUB export loads its part and not the import's", async ({ core, page }) => {
    const assets = recordAssets(page);
    await core.openApp(page);
    const book = await openCopy(core, page, 'german-book.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: book.replace(/\.fb2$/, '.epub') });
    await fileMenu(page, 'export', 'exportEpub');
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });
    expect(epubParts(assets)).toEqual(['epub-export', 'epub-shared']);
  });

  test('the first export shows its progress at once, while its part loads (D32)', async ({
    core,
    page,
  }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loaded = false;
    await page.route('**/assets/epub-export-*.js', async (route) => {
      await held;
      loaded = true;
      await route.continue();
    });
    await core.openApp(page);
    const book = await openCopy(core, page, 'german-book.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: book.replace(/\.fb2$/, '.epub') });
    await fileMenu(page, 'export', 'exportEpub');
    await expect(page.getByTestId('modal-job')).toBeVisible({ timeout: 2_000 });
    expect(loaded).toBe(false);
    release();
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });
    expect(loaded).toBe(true);
  });
});
