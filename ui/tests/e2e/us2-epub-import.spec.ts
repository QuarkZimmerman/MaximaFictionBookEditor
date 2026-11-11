/**
 * Feature 012, User Story 2 - Import an EPUB book as a new book (D14-D31; FR-020-FR-031; SC-004,
 * SC-006). Runs against the real core with the reference EPUBs of tests/fixtures/epub/: every
 * version up to 3.3 becomes a book whose body passes FB2 validation; DRM and broken files are
 * refused; File > Open refuses an EPUB; Save As proposes the EPUB's name with `.fb2`.
 */

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, shownDocId, startCoreWith, test } from './fixtures/core';
import { bodyErrors, bookXml, epub, EPUBS, importDone, importViaMenu } from './fixtures/epubImport';

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
      await expect(page.getByTestId('dialog-epub-import-refused')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('dialog-epub-import-refused-button-ok').click();
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
