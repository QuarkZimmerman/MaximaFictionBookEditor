/**
 * Feature 011, User Story 7 scenarios 1-4 - export and import again (D29, D45; SC-008). Runs against
 * the real core: a book with a stylesheet and named styles exported as one Markdown file comes back
 * through File > Import > Markdown with its description, stylesheet and named styles.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<stylesheet type="text/css">.letter { font-style: italic; }</stylesheet>
<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Round Trip</book-title><lang>en</lang><sequence name="Saga" number="2"/></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>trip-1</id><version>1.3</version></document-info>
</description>
<body><title><p>Round Trip</p></title>
<section><title><p>Chapter One</p></title><p><style name="letter">Dear friend</style>, it works.</p><empty-line/><p style="letter">Signed</p></section>
</body>
</FictionBook>
`;

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

test.describe('US7 (feature 011) - export and import again', () => {
  let dir: string;
  let file: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us7-'));
    file = path.join(dir, 'trip.fb2');
    writeFileSync(file, BOOK, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('1-4. the exported file comes back as the book, styles included', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await open(core, page, file);
    const target = path.join(dir, 'trip.md');
    await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await page.getByTestId('menu-file-export-exportMarkdown').click();
    await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}:`, {
      timeout: 30_000,
    });
    // File > Import > Markdown reads it back into a new book.
    await core.enqueueDialog('dialog.openFile', { paths: [target] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importMarkdown').click();
    await expect.poll(() => xml(page), { timeout: 30_000 }).toContain('<id>trip-1</id>');
    const imported = await xml(page);
    expect(imported).toContain(
      '<stylesheet type="text/css">.letter { font-style: italic; }</stylesheet>',
    );
    expect(imported).toContain('<book-title>Round Trip</book-title>');
    expect(imported).toContain('<sequence name="Saga" number="2"/>');
    expect(imported).toContain('<style name="letter">Dear friend</style>');
    expect(imported).toContain('<p style="letter">Signed</p>');
    expect(imported).toContain('<empty-line/>');
    expect(imported).not.toContain('Saga #2');
  });
});
