/**
 * Feature 011, User Story 7 scenarios 5-6 - the styles of Markdown another tool wrote (D46; FR-073,
 * FR-074; SC-018). Runs against the real core with tests/fixtures/markdown/foreign/pandoc.md: Pandoc's
 * header keys fill their fields, CSS written for HTML is translated to FB2 - its header-includes, a
 * local css: file, a <style> block -, class spans and blocks become named styles, and the web
 * address the header names is never fetched; the summary lists what could not come over.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/core';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const FOREIGN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/markdown/foreign/pandoc.md',
);

const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

test('US7 (feature 011) 5-6. styles from other tools, translated; nothing fetched', async ({
  core,
  page,
}) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  await core.openApp(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await core.enqueueDialog('dialog.openFile', { paths: [FOREIGN] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMarkdown').click();
  // The summary lists the header key without an FB2 field and the stylesheet on the web.
  const summary = page.getByTestId('dialog-markdown-summary');
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText('unknown-key');
  await expect(summary).toContainText('https://example.org/web.css');
  await page.getByTestId('dialog-markdown-summary-button-ok').click();
  const book = await xml(page);
  expect(book).toContain('<book-title>A Pandoc Book</book-title>');
  expect(book).toContain('<publisher>Acme</publisher>');
  expect(book).toContain('<isbn>978-3-16-148410-0</isbn>');
  expect(book).toContain('<custom-info info-type="rights">CC BY 4.0</custom-info>');
  // The CSS for HTML, translated: the header's, the text's and the local file's.
  expect(book).toContain('cite {\n  margin: 0 2em;\n}');
  expect(book).toContain('.note {\n  color: gray;\n}');
  expect(book).toContain('emphasis {\n  font-style: italic;\n}');
  expect(book).toContain('p {\n  text-indent: 1em;\n}');
  expect(book).toContain('<style name="mark">a span</style>');
  expect(book).toContain('<p style="note">A note paragraph.</p>');
  // Offline: no request for the web address (FR-084).
  expect(requests.some((url) => url.includes('example.org'))).toBe(false);
});
