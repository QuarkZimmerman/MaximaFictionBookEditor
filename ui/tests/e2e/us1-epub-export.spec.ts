/**
 * Feature 012, User Story 1 - Export a book as an EPUB 3.3 file (D1-D13, D43; FR-001-FR-017;
 * SC-001-SC-003, SC-021). Runs against the real core. Every EPUB written goes to
 * `build/epub-export/`, where CI's EPUBCheck step checks it (tools/ci/epubcheck.sh: no error, no
 * warning); here the files are read back with `unzip`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../build/epub-export',
);

async function openBook(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  return book;
}

/** True when the export asked Save's question first (an invalid book, requester rc.5). */
async function exportEpub(core: CoreHandle, page: Page, target: string): Promise<boolean> {
  await core.enqueueDialog('dialog.saveFile', { path: target });
  return clickExport(core, page, 'exportEpub');
}

function entry(file: string, name: string): string {
  return execFileSync('unzip', ['-p', file, name], { encoding: 'utf8' });
}

function entries(file: string): string[] {
  return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

test.describe('US1 (feature 012) - the EPUB export', () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('the reference book: a valid EPUB 3.3 with its parts, and the book unchanged', async ({
    core,
    page,
  }) => {
    const book = await openBook(core, page, 'reference-all-elements.fb2');
    const recentBefore = await core.rpc('doc.recent');
    const target = path.join(OUT, 'reference-all-elements.epub');
    // A valid book is exported without Save's question (requester, rc.5).
    expect(await exportEpub(core, page, target)).toBe(false);
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });

    // D2: the book's name in its folder, EPUB files only, no options.
    // The dialog requests as the test hooks record them: the request's fields, with its method.
    const requests = (await core.rpc('test.dialogRequests')) as Array<{
      method: string;
      defaultPath?: string;
      filters?: Array<{ extensions: string[] }>;
      zipChoice?: unknown;
    }>;
    const save = requests.filter((request) => request.method === 'dialog.saveFile').at(-1)!;
    expect(path.dirname(save.defaultPath ?? '')).toBe(path.dirname(book));
    expect(save.defaultPath).toMatch(/The Reference Book\.epub$/);
    expect(save.filters?.[0]?.extensions).toEqual(['epub']);
    expect(save.zipChoice).toBeUndefined();

    // The container: mimetype first, stored, without an extra field (D4, research R3).
    const zip = readFileSync(target);
    expect(zip.subarray(30, 38).toString()).toBe('mimetype');
    expect(zip.readUInt16LE(8)).toBe(0);
    expect(zip.readUInt16LE(28)).toBe(0);
    expect(zip.subarray(38, 58).toString()).toBe('application/epub+zip');
    const names = entries(target);
    for (const name of [
      'META-INF/container.xml',
      'EPUB/package.opf',
      'EPUB/nav.xhtml',
      'EPUB/toc.ncx',
      'EPUB/style.css',
    ]) {
      expect(names).toContain(name);
    }

    // D6, D7, D43: the publication's data.
    const opf = entry(target, 'EPUB/package.opf');
    expect(opf).toContain(
      '<dc:identifier id="uid">urn:uuid:5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10</dc:identifier>',
    );
    expect(opf).toContain('<dc:title>The Reference Book</dc:title>');
    expect(opf).toContain('<dc:language>en</dc:language>');
    expect(opf).toMatch(/property="role" scheme="marc:relators">aut</);
    expect(opf).toContain('>Example, Anna B.</meta>');
    expect(opf).toMatch(/property="role" scheme="marc:relators">trl</);
    expect(opf).toContain('>Vincent Van Gogh</dc:contributor>');
    expect(opf).toMatch(/property="role" scheme="marc:relators">ill</);
    expect(opf).toMatch(/property="role" scheme="marc:relators">edt</);
    expect(opf).toContain('<meta property="belongs-to-collection" id="series1">The Series</meta>');
    expect(opf).toContain('<meta name="calibre:series" content="The Series"/>');
    expect(opf).toContain('urn:isbn:978-0-00-000000-2');
    expect(opf).toMatch(
      /<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/,
    );
    expect(opf).toContain('<meta property="schema:accessMode">visual</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityHazard">none</meta>');
    expect(opf).not.toContain('dcterms:conformsTo');
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('<meta name="cover" content=');
    expect(opf).toContain('<reference type="text"');
    expect(opf).toContain('mfbe:fb2-description');

    // D8-D12: the pages.
    const title = entry(target, 'EPUB/text/title.xhtml');
    expect(title).toContain('The Series #3');
    expect(title).toContain('The annotation of the reference book.');
    const text = names
      .filter((name) => /^EPUB\/text\/\d{4}\.xhtml$/.test(name))
      .map((name) => entry(target, name))
      .join('\n');
    expect(text).toContain('<figcaption>A caption under the picture</figcaption>');
    expect(text).toContain('epub:type="noteref"');
    expect(text).toContain('<a href="https://example.com/">');
    expect(text).toContain('class="letter"');
    expect(text).toContain('colspan="2"');
    const notes = entry(target, 'EPUB/text/notes.xhtml');
    expect(notes).toContain('epub:type="footnote"');
    expect(notes).toContain('class="fb2-backlink"');
    const nav = entry(target, 'EPUB/nav.xhtml');
    expect(nav).toContain('epub:type="landmarks"');
    expect(nav).toContain('Chapter One with a second title line');
    const ncx = entry(target, 'EPUB/toc.ncx');
    expect(ncx).toContain(
      '<meta name="dtb:uid" content="urn:uuid:5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10"/>',
    );
    expect(entry(target, 'EPUB/style.css')).toContain('.letter');

    // D3, D33: the book and the editor's records are unchanged.
    expect(await core.rpc('doc.recent')).toEqual(recentBefore);
  });

  test('the words the export adds follow the book language; accessibility as it holds', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'russian-untitled-notes.fb2');
    const russian = path.join(OUT, 'russian-untitled-notes.epub');
    await exportEpub(core, page, russian);
    await expect(page.getByTestId('status-message')).toContainText('Exported to', {
      timeout: 30_000,
    });
    expect(entry(russian, 'EPUB/text/notes.xhtml')).toContain('>Примечания</h1>');
    expect(entry(russian, 'EPUB/nav.xhtml')).toContain('>Титульная страница</a>');
    expect(entry(russian, 'EPUB/package.opf')).toContain('Книга состоит только из текста.');

    await openBook(core, page, 'german-book.fb2');
    const german = path.join(OUT, 'german-book.epub');
    await exportEpub(core, page, german);
    await expect(page.getByTestId('status-message')).toContainText('german-book.epub', {
      timeout: 30_000,
    });
    expect(entry(german, 'EPUB/text/notes.xhtml')).toContain('>Notes</h1>');

    await openBook(core, page, 'pictures-no-alt.fb2');
    const noAlt = path.join(OUT, 'pictures-no-alt.epub');
    await exportEpub(core, page, noAlt);
    await expect(page.getByTestId('status-message')).toContainText('pictures-no-alt.epub', {
      timeout: 30_000,
    });
    const opf = entry(noAlt, 'EPUB/package.opf');
    expect(opf).toContain('<meta property="schema:accessModeSufficient">textual,visual</meta>');
    expect(opf).not.toContain('alternativeText');

    await openBook(core, page, 'pictures-alt.fb2');
    const allAlt = path.join(OUT, 'pictures-alt.epub');
    await exportEpub(core, page, allAlt);
    await expect(page.getByTestId('status-message')).toContainText('pictures-alt.epub', {
      timeout: 30_000,
    });
    expect(entry(allAlt, 'EPUB/package.opf')).toContain(
      '<meta property="schema:accessibilityFeature">alternativeText</meta>',
    );
  });

  test('a book that fails validation still gives a valid EPUB, with the gaps listed (D4)', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'invalid-for-export.fb2');
    const target = path.join(OUT, 'invalid-for-export.epub');
    // Save's question comes first (requester, rc.5); Yes exports the book as it is.
    expect(await exportEpub(core, page, target)).toBe(true);
    const summary = page.getByTestId('dialog-epub-export-summary');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toContainText('Link written as text: #nowhere');
    await expect(summary).toContainText("Filled in the file only: the book's title");
    await summary.getByRole('button').first().click();
    const opf = entry(target, 'EPUB/package.opf');
    expect(opf).toContain('<dc:language>und</dc:language>');
  });
});
