/**
 * Feature 012, User Story 2 - Import an EPUB book as a new book (D14-D31; FR-020-FR-031; SC-004,
 * SC-006). Runs against the real core with the reference EPUBs of tests/fixtures/epub/: every
 * version up to 3.3 becomes a book whose body passes FB2 validation; DRM and broken files are
 * refused; File > Open refuses an EPUB; Save As proposes the EPUB's name with `.fb2`.
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, shownDocId, startCoreWith, test, type CoreHandle } from './fixtures/core';

const EPUBS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/epub',
);
const epub = (name: string): string => path.join(EPUBS, name);

/** Starts File > Import > EPUB File... on `file`; returns the document the window showed before. */
async function importViaMenu(core: CoreHandle, page: Page, file: string): Promise<string | null> {
  const before = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click({ timeout: 15_000 });
  await page.getByTestId('menu-file-import').hover({ timeout: 15_000 });
  await page.getByTestId('menu-file-import-importEpub').click({ timeout: 15_000 });
  // The book a previous import made is unsaved: the editor asks first, as Open does (D15).
  const question = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
  const asked = await question
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await question.getByRole('button', { name: 'No' }).click({ timeout: 15_000 });
  return before;
}

/**
 * Waits for the end of the import started after `before` was shown: a new book in the window and
 * the progress gone (the status line may still hold the previous import's message), or the failure;
 * a summary is closed.
 */
async function importDone(page: Page, before: string | null): Promise<void> {
  const summary = page.getByTestId('dialog-epub-import-summary');
  const failed = page.getByTestId('dialog-epub-import-failed');
  const progress = page.getByTestId('modal-job');
  await expect
    .poll(
      async () =>
        (await failed.isVisible()) ||
        ((await shownDocId(page)) !== before && !(await progress.isVisible())),
      { timeout: 30_000 },
    )
    .toBe(true);
  if (await failed.isVisible()) throw new Error(`the import failed: ${await failed.textContent()}`);
  // The summary, when there is one, follows the end of the progress at once.
  const shown = await summary
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await summary.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
}

/** The book as the editor writes it: saved with Save As to a scratch file and read back. */
async function bookXml(core: CoreHandle, page: Page): Promise<string> {
  const target = path.join(mkdtempSync(path.join(os.tmpdir(), 'mfbe-epub-import-')), 'book.fb2');
  await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  // The template's blank genre makes the book invalid (FR-030): save anyway; the Save As dialog
  // asks for the encoding when the queued answer does not carry one.
  const yes = page.getByTestId('dialog-validation-failed-button-yes');
  const saveAs = page.getByRole('dialog').filter({ hasText: 'Encoding:' });
  await expect
    .poll(
      async () => {
        if (existsSync(target)) return true;
        if (await yes.isVisible()) await yes.click();
        if (await saveAs.isVisible())
          await saveAs.getByRole('button', { name: /^(OK|Save)$/ }).click();
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return readFileSync(target, 'utf8');
}

async function bodyErrors(core: CoreHandle, page: Page): Promise<string[]> {
  const docId = await shownDocId(page);
  const report = await core.rpcJob<{
    issues: Array<{ severity: string; code: string; path?: string; message?: string }>;
  }>('doc.validate', { docId });
  return (
    report.issues
      // FR-030: only the description fields the template leaves blank may be reported; every error
      // located in a body counts.
      .filter((issue) => issue.severity === 'error' && (issue.path ?? '').includes('body'))
      .map((issue) => `${issue.code} ${issue.path ?? ''}`)
  );
}

test.describe('US2 (feature 012) - the EPUB import', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  // D17, D30: every version and every form of page becomes a book whose body validates (three
  // parts, each with its own time budget: fifteen imports, each validated).
  const groups = [
    [
      'epub-2.0.epub',
      'epub-2.0.1.epub',
      'epub-no-version.epub',
      'epub-3.0.epub',
      'epub-3.0.1.epub',
    ],
    ['epub-3.1.epub', 'epub-3.2.epub', 'epub-3.3.epub', 'dtbook.epub', 'oeb1.epub'],
    [
      'xml-island.epub',
      'not-well-formed.epub',
      'calibre-like.epub',
      'indesign-footnotes.epub',
      'fb2-converter.epub',
    ],
  ];
  for (const [index, group] of groups.entries()) {
    test(`every version and form becomes a book whose body validates, part ${index + 1} (D17, D30)`, async ({
      core,
      page,
    }) => {
      test.setTimeout(240_000);
      // Nothing the import does asks the core for what it does not hold (a picture's preview
      // before the picture is in the book, an entry of the EPUB that is not there).
      const failedRequests: string[] = [];
      page.on('response', (response) => {
        if (response.status() >= 400) {
          const url = new URL(response.url());
          failedRequests.push(`${response.status()} ${url.pathname}`);
        }
      });
      for (const name of group) {
        await importDone(page, await importViaMenu(core, page, epub(name)));
        expect(await bodyErrors(core, page), name).toEqual([]);
      }
      expect(failedRequests).toEqual([]);
    });
  }

  test('notes, links, the body title and the description (D18, D20, D22, D28)', async ({
    core,
    page,
  }) => {
    await importDone(page, await importViaMenu(core, page, epub('epub-3.0.epub')));
    let xml = await bookXml(core, page);
    expect(xml).toContain('type="note"');
    expect(xml).toContain('<body name="notes">');

    await importDone(page, await importViaMenu(core, page, epub('epub-3.3.epub')));
    xml = await bookXml(core, page);
    expect(xml).toContain('l:href="https://www.google.com"');
    expect(xml).toMatch(/<a l:href="#[^"]+">next chapter<\/a>/);
    expect(xml).toMatch(/<a l:href="#[^"]+">a place<\/a>/);
    expect(xml).not.toMatch(/<a[^>]*>missing<\/a>/);
    expect(xml).toContain('title="The caption"');
    expect(xml).toContain('<book-title>epub-3.3 title</book-title>');
    expect(xml).toContain('<sequence name="The Series" number="3"');
    expect(xml).toContain('<publisher>Example Press</publisher>');
    expect(xml).toContain('<coverpage>');

    await importDone(page, await importViaMenu(core, page, epub('epub-3.2.epub')));
    xml = await bookXml(core, page);
    expect(xml).toMatch(/<body>\s*<title>\s*<p>The Book<\/p>\s*<\/title>/);

    await importDone(page, await importViaMenu(core, page, epub('roles.epub')));
    xml = await bookXml(core, page);
    expect(xml).toContain('<custom-info info-type="mlillustrator">Van_Gogh Vincent</custom-info>');
    expect(xml).toContain('<custom-info info-type="mleditor">Редактор Ю.</custom-info>');
    expect(xml).toContain('<translator>');
    expect(xml).not.toContain('Paula');
  });

  test('DRM and broken files are refused; the window keeps its book (D17)', async ({
    core,
    page,
  }) => {
    await importViaMenu(core, page, epub('drm-adept.epub'));
    await expect(page.getByTestId('dialog-epub-protected')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('dialog-epub-protected')).toContainText('protected');
    await page.getByTestId('dialog-epub-protected-button-ok').click();
    for (const name of ['not-zip.epub', 'zip-bomb.epub', 'password-zip.epub']) {
      await importViaMenu(core, page, epub(name));
      await expect(page.getByTestId('dialog-epub-import-failed')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('dialog-epub-import-failed-button-ok').click();
    }
    await importDone(page, await importViaMenu(core, page, epub('font-obfuscation.epub')));
  });

  test('File > Open refuses an EPUB; Save As proposes its name with .fb2 (D14, D15)', async ({
    core,
    page,
  }) => {
    await core.enqueueDialog('dialog.openFile', { paths: [epub('epub-3.0.epub')] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await expect(page.getByTestId('dialog-epub-refused')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('dialog-epub-refused')).toContainText(
      'File > Import > EPUB File',
    );
    await page.getByTestId('dialog-epub-refused-button-ok').click();

    await importDone(page, await importViaMenu(core, page, epub('epub-3.3.epub')));
    // Ctrl+S on the new, untitled book asks for its file, proposing the EPUB's name (D15).
    await core.enqueueDialog('dialog.saveFile', { path: null });
    await page.keyboard.press('Control+s');
    const validation = page.getByTestId('dialog-validation-failed-button-yes');
    const invalid = await validation
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (invalid) await validation.click();
    await expect
      .poll(async () => {
        const requests =
          await core.rpc<Array<{ method: string; defaultPath?: string }>>('test.dialogRequests');
        return (
          requests.filter((request) => request.method === 'dialog.saveFile').at(-1)?.defaultPath ??
          ''
        );
      })
      .toBe(path.join(EPUBS, 'epub-3.3.fb2'));
  });

  test('the import is modal: progress, Cancel, and the window keeps its book (D16)', async ({
    core,
    page,
  }) => {
    // The book's entries come slowly, so that Cancel arrives while the pages are read.
    await page.route('**/epub/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const before = await importViaMenu(core, page, epub('epub-3.3.epub'));
    await expect(page.getByTestId('modal-job')).toBeVisible();
    await page.getByTestId('modal-job-cancel').click();
    await expect(page.getByTestId('modal-job')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('status-message')).toContainText('cancelled');
    expect(await shownDocId(page)).toBe(before);
    await page.unroute('**/epub/**');
  });

  test('an import with nothing to report ends on the status line (D31)', async ({ core, page }) => {
    await importViaMenu(core, page, epub('epub-3.0.epub'));
    await expect(page.getByTestId('status-message')).toContainText('Imported from EPUB', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('dialog-epub-import-summary')).toHaveCount(0);
  });

  test('the command line, and a dropped file with it, refuse an EPUB (D14)', async ({
    browser,
  }) => {
    // The shell sends a file given on the command line and a file dropped on the window to the
    // editor alike (app.openPaths); `--open` gives the first.
    const binary = process.env.MFBE_CORE_BIN ?? '';
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mfbe-epub-open-'));
    const second = await startCoreWith(binary, dataDir, ['--open', epub('epub-3.0.epub')]);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(second.url);
      await expect(page.getByTestId('dialog-epub-refused')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('dialog-epub-refused')).toContainText('epub-3.0.epub');
    } finally {
      await context.close();
      await second.stop();
    }
  });
});
