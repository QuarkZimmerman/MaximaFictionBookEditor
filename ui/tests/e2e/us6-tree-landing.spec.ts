/**
 * Feature 010, US6 (T043): the tree shows the element with its heading (D17, D18). With the Body
 * view scrolled to the end, a click on the Annotation, History or a chapter row - also before
 * any click in the text - brings the element to the top of the view with its label tab or title
 * fully visible; a double-click does the same and gives the Body view the focus.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

const paragraphs = (label: string, count: number) =>
  Array.from(
    { length: count },
    (_, i) => `<p>${label} paragraph ${i + 1} of the book text.</p>`,
  ).join('\n');

/** A long annotation and history and two long chapters. */
function book(dir: string): string {
  const file = path.join(dir, 'landing.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Landing</book-title>
<annotation>${paragraphs('Annotation', 25)}</annotation>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>landing-0001</id>
<version>1.0</version>
<history>${paragraphs('History', 6)}</history>
</document-info>
</description>
<body>
<section><title><p>Chapter 1</p></title>${paragraphs('First', 60)}</section>
<section><title><p>Chapter 2</p></title>${paragraphs('Second', 60)}</section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

/**
 * Scrolls the Body view to its end, or measures where `selector`'s top stands in it: the offset
 * of its top below the view's top, and the view's height.
 */
const BODY_SCROLLER = `(() => {
  let el = document.querySelector('[data-testid="body-editor"]');
  while (el && !(['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
  return el;
})()`;

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(`(() => { const s = ${BODY_SCROLLER}; s.scrollTop = s.scrollHeight; })()`);
}

async function placement(page: Page, selector: string): Promise<{ top: number; height: number }> {
  return page.evaluate(`(() => {
    const s = ${BODY_SCROLLER};
    const el = document.querySelector(${JSON.stringify(selector)});
    return { top: el.getBoundingClientRect().top - s.getBoundingClientRect().top, height: s.clientHeight };
  })()`);
}

/** The element's top - its label tab or title - is visible within the top quarter. */
async function expectAtTop(page: Page, selector: string): Promise<void> {
  await expect
    .poll(async () => {
      const { top, height } = await placement(page, selector);
      return top >= 0 && top <= height / 4;
    })
    .toBe(true);
}

test.describe('US6 (010) - the tree shows the element with its heading', () => {
  test('1, 2, 4. a click on Annotation, History and a chapter, before any click in the text, lands with the label or title at the top', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us6-010-'));
    await core.openApp(page);
    await openBook(core, page, book(dir));

    await scrollToEnd(page);
    await page.getByTestId('tree-row-desc:history').click();
    await expectAtTop(page, '.fb-desc-block.fb-history');

    await scrollToEnd(page);
    await page.getByTestId('tree-row-desc:annotation').click();
    await expectAtTop(page, '.fb-desc-block.fb-annotation');

    await scrollToEnd(page);
    await page
      .locator('.mfbe-tree-row[data-kind="section"]')
      .filter({ hasText: 'Chapter 2' })
      .click();
    await expectAtTop(
      page,
      '.fb-section:nth-of-type(2) > .fb-title, .fb-section ~ .fb-section > .fb-title',
    );
    // The tree keeps the focus after a click.
    await expect(page.locator('.mfbe-tree-row-selected')).toContainText('Chapter 2');
  });

  test('3. a double-click on a chapter row lands its title at the top and gives the Body view the focus', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us6-010-'));
    await core.openApp(page);
    await openBook(core, page, book(dir));
    await scrollToEnd(page);
    await page
      .locator('.mfbe-tree-row[data-kind="section"]')
      .filter({ hasText: 'Chapter 1' })
      .dblclick();
    await expectAtTop(page, '.fb-section > .fb-title');
    await expect(page.getByTestId('body-editor')).toBeFocused();
  });
});
