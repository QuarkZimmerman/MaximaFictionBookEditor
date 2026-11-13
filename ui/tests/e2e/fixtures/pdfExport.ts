import { readFileSync } from 'node:fs';
/**
 * Feature 014: opening a book and exporting it to PDF through the menus, shared by the PDF export's
 * journeys and the corpus gate's PDF runs. The export prints through the core's test seam, which
 * startPrintSeam (printSeam.ts) answers with the test browser.
 */
import type { Page } from '@playwright/test';

import { expect, fixtureBook, waitForBook, type CoreHandle } from './core';

/** File > Open for the fixture book `name` (tests/fixtures/books/ or a path). */
export async function openFixtureBook(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = name.includes('/') ? name : fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book, 120_000);
  return book;
}

/**
 * File > Export > Export as PDF... to `target` in the page size labelled `sizeLabel` (the Save
 * dialog's list, `pdf.sizes.*` in English), until the export ends: the status line naming the file,
 * or the summary window (D23), which is closed and whose text is returned. A failed export throws
 * with the failure's text.
 */
export async function exportPdfTo(
  core: CoreHandle,
  page: Page,
  target: string,
  sizeLabel: string,
  timeout = 300_000,
): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: target, encoding: sizeLabel });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportPdf').click();
  const status = page.getByTestId('status-message');
  const failed = page.getByTestId('dialog-pdf-export-failed');
  const summary = page.getByTestId('dialog-pdf-export-summary');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`the export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button', { name: 'OK' }).click({ timeout: 10_000 });
          return true;
        }
        text = (await status.textContent()) ?? '';
        return text.includes(`Exported to ${target}`);
      },
      { timeout },
    )
    .toBe(true);
  return text;
}

/** The book's text as tests/pdf/text-compare.mjs expects it. */
export interface Expected {
  blocks: { text: string; note: boolean }[];
  addedWords: string[];
}

/**
 * The book's own text, block by block, read from its FB2 file in the page (the e2e files have no
 * DOM types: the reader is a string evaluated there), with the title page's words (D11).
 */
export async function expectedText(page: Page, file: string): Promise<Expected> {
  const xml = readFileSync(file, 'utf8');
  return page.evaluate(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(xml)}, 'application/xml');
    const NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
    const clean = (s) => s.replace(/\\s+/g, ' ').trim();
    const blocks = [];
    const BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'th', 'td']);
    for (const body of doc.getElementsByTagNameNS(NS, 'body')) {
      const note = /^(notes|comments)$/i.test(body.getAttribute('name') || '');
      const walk = (el) => {
        for (const child of el.children) {
          // D19: the notes go to the feet of the pages; their body's own title is not printed.
          if (note && el === body && child.localName === 'title') continue;
          if (BLOCKS.has(child.localName)) blocks.push({ text: clean(child.textContent), note });
          else walk(child);
        }
      };
      walk(body);
    }
    const info = doc.getElementsByTagNameNS(NS, 'title-info')[0];
    const words = [];
    const title = info && info.getElementsByTagNameNS(NS, 'book-title')[0];
    if (title) words.push(clean(title.textContent));
    for (const author of info ? info.getElementsByTagNameNS(NS, 'author') : []) {
      const part = (name) => clean((author.getElementsByTagNameNS(NS, name)[0] || {}).textContent || '');
      const full = ['first-name', 'middle-name', 'last-name'].map(part).filter(Boolean).join(' ');
      words.push(full || part('nickname'));
    }
    // The title page shows them together: its whole text is added too.
    return { blocks, addedWords: [...words, words.join(' ')] };
  })()`);
}
