/**
 * Feature 012 (T042; D17, D29; SC-009): the hostile EPUBs through the whole import, against the real
 * core. Each gives a book or a message - never a crash, a hang, a read outside the file or a request
 * off the machine. The core's side has its own tests (tests/core/test_epub_hostile.cpp); the
 * 10,000-page book is too large to commit and is written here by the fixture generator.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures/core';
import { bookXml, epub, importDone, importViaMenu } from './fixtures/epubImport';
import { scratchDir } from './fixtures/scratch';

const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/epub/make-fixtures.py',
);

test.describe('the hostile EPUBs (feature 012, SC-009)', () => {
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

  test('a ZIP bomb, a file that is no ZIP, a password ZIP and DRM are messages', async ({
    core,
    page,
  }) => {
    for (const [name, dialog] of [
      ['zip-bomb.epub', 'dialog-epub-import-refused'],
      ['not-zip.epub', 'dialog-epub-import-refused'],
      ['password-zip.epub', 'dialog-epub-import-refused'],
      ['drm-adept.epub', 'dialog-epub-protected'],
    ] as const) {
      await importViaMenu(core, page, epub(name));
      await expect(page.getByTestId(dialog), name).toBeVisible({ timeout: 20_000 });
      await page.getByTestId(dialog).getByRole('button', { name: 'OK' }).click();
    }
  });

  test('a name leading outside the EPUB is listed and never read', async ({ core, page }) => {
    const summary = await importDone(
      page,
      await importViaMenu(core, page, epub('path-escape.epub')),
    );
    expect(summary).toContain('File named outside the book, not read: ../../escape.txt');
    expect(await bookXml(core, page)).not.toContain('outside the container');
  });

  test('nesting 500 deep is flattened and listed', async ({ core, page }) => {
    const summary = await importDone(
      page,
      await importViaMenu(core, page, epub('deep-nesting.epub')),
    );
    expect(summary).toContain('Nesting deeper than 64 levels, flattened into paragraphs');
    expect(await bookXml(core, page)).toContain('Deep.');
  });

  test('a picture past 100 megapixels is listed, the book comes in', async ({ core, page }) => {
    const summary = await importDone(
      page,
      await importViaMenu(core, page, epub('huge-picture.epub')),
    );
    expect(summary).toContain('Picture larger than 100 megapixels, not added: huge.png');
  });

  test('entity expansion and an external entity read nothing outside the file', async ({
    core,
    page,
  }) => {
    await importDone(page, await importViaMenu(core, page, epub('entities.epub')));
    const xml = await bookXml(core, page);
    expect(xml).not.toContain('root:');
  });

  test('10,000 pages give a book', async ({ core, page }) => {
    // SC-010's budgets are the release build's (the @perf journeys); this one is a book, not a hang.
    test.setTimeout(300_000);
    const dir = scratchDir('epub-large-');
    execFileSync('python3', [GENERATOR, '--large', dir]);
    await importDone(
      page,
      await importViaMenu(core, page, path.join(dir, 'many-pages.epub')),
      240_000,
    );
    const xml = await bookXml(core, page);
    expect(xml).toContain('Page 1.');
    expect(xml).toContain('Page 10000.');
  });
});
