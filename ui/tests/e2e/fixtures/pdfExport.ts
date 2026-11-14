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
async function expectedTextAll(page: Page, file: string): Promise<Expected> {
  // The book as the window holds it (any encoding of its file), else the file as UTF-8.
  const held = await page
    .evaluate(
      `window.__mfbeTest && window.__mfbeTest.scripts ? window.__mfbeTest.scripts.toXml() : null`,
    )
    .catch(() => null);
  const xml = typeof held === 'string' && held ? held : readFileSync(file, 'utf8');
  return page.evaluate(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(xml)}, 'application/xml');
    const NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
    const clean = (s) => s.replace(/\\s+/g, ' ').trim();
    const blocks = [];
    const BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'th', 'td']);
    // The description's annotation is printed on its own page after the title page, and the
    // document's history on the last page (requester, rc.4): in that order around the bodies.
    const descriptionBlocks = (parentName, name) => {
      const found = [];
      const parent = doc.getElementsByTagNameNS(NS, parentName)[0];
      const container = parent && [...parent.children].find((c) => c.localName === name);
      if (!container) return found;
      const walk = (el) => {
        for (const child of el.children) {
          if (BLOCKS.has(child.localName)) found.push({ text: clean(child.textContent), note: false });
          else walk(child);
        }
      };
      walk(container);
      return found;
    };
    const annotationBlocks = descriptionBlocks('title-info', 'annotation');
    blocks.push(...annotationBlocks);
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
    const historyBlocks = descriptionBlocks('document-info', 'history');
    blocks.push(...historyBlocks);
    // D11: the title page as the paginator sets it - the authors, the title, each series in
    // brackets ("(Name #N)"), and the publisher and the year ("Publisher, Year") at its foot.
    const info = doc.getElementsByTagNameNS(NS, 'title-info')[0];
    const authors = [];
    for (const author of info ? info.getElementsByTagNameNS(NS, 'author') : []) {
      const part = (name) => clean((author.getElementsByTagNameNS(NS, name)[0] || {}).textContent || '');
      const full = ['first-name', 'middle-name', 'last-name'].map(part).filter(Boolean).join(' ');
      if (full || part('nickname')) authors.push(full || part('nickname'));
    }
    const titleElement = info && info.getElementsByTagNameNS(NS, 'book-title')[0];
    const title = titleElement ? clean(titleElement.textContent) : '';
    const series = [];
    for (const sequence of info ? info.getElementsByTagNameNS(NS, 'sequence') : []) {
      const name = clean(sequence.getAttribute('name') || '');
      const number = sequence.getAttribute('number');
      if (name) series.push('(' + name + (number && Number(number) ? ' #' + Number(number) : '') + ')');
    }
    const publish = doc.getElementsByTagNameNS(NS, 'publish-info')[0];
    const field = (name) =>
      publish ? clean((publish.getElementsByTagNameNS(NS, name)[0] || {}).textContent || '') : '';
    const imprint = [field('publisher'), field('year')].filter(Boolean).join(', ');
    const lines = [...authors, title, ...series, imprint].filter(Boolean);
    // The title page shows them together: its whole text is added too.
    return { blocks, addedWords: [...lines, lines.join(' ')], annotationBlocks, historyBlocks };
  })()`);
}

interface ModelJson {
  type?: string;
  text?: string;
  attrs?: { name?: string };
  content?: ModelJson[];
}

/**
 * The bodies' blocks as Preview draws them, from the editor's model: the parts it keeps as raw XML
 * (not valid FB2 there, kept for the round trip) are drawn as nothing, so they are left out by
 * their type - the summary names them.
 */
function modelBlocks(bodies: ModelJson[]): Expected['blocks'] {
  const BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'th', 'td']);
  const raw = (node: ModelJson): boolean =>
    node.type === 'raw-xml' || node.type === 'raw-xml-inline';
  const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const textOf = (node: ModelJson): string =>
    node.type === 'text'
      ? (node.text ?? '')
      : raw(node)
        ? ''
        : (node.content ?? []).map(textOf).join('');
  const blocks: Expected['blocks'] = [];
  for (const body of bodies) {
    const note = /^(notes|comments)$/i.test(body.attrs?.name ?? '');
    const walk = (node: ModelJson, top: boolean): void => {
      for (const child of node.content ?? []) {
        // D19: the notes go to the feet of the pages; their body's own title is not printed.
        if ((note && top && child.type === 'title') || raw(child)) continue;
        if (BLOCKS.has(child.type ?? '')) blocks.push({ text: clean(textOf(child)), note });
        else walk(child, false);
      }
    };
    walk(body, true);
  }
  return blocks;
}

/** The book's text as the PDF must hold it: Preview's - from the model when the window holds it. */
export async function expectedText(page: Page, file: string): Promise<Expected> {
  const expected = await expectedTextAll(page, file);
  const bodies = (await page
    .evaluate(
      `window.__mfbeTest && window.__mfbeTest.book && window.__mfbeTest.book.bodies ? window.__mfbeTest.book.bodies() : null`,
    )
    .catch(() => null)) as ModelJson[] | null;
  if (!bodies) return expected;
  // The annotation's page before the bodies and the history's page after them, as printed.
  const around = expected as Expected & {
    annotationBlocks?: Expected['blocks'];
    historyBlocks?: Expected['blocks'];
  };
  return {
    ...expected,
    blocks: [
      ...(around.annotationBlocks ?? []),
      ...modelBlocks(bodies),
      ...(around.historyBlocks ?? []),
    ],
  };
}
