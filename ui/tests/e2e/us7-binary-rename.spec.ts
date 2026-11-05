/**
 * Feature 009, user story 7 - rename a binary object (T069; FR-070 to FR-075, data-model §10).
 *
 * A picture used in the text, a table cell, the annotation and the cover is renamed from the
 * Binary objects list: every picture still shows, the references follow, and one Undo gives the
 * old id back (Redo the new one). An id that is not an XML NCName or already used is refused with
 * its reason; an invalid id like `1.jpg` can be renamed to a valid one. Needs the real core.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

const PNG = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../tests/fixtures/images/opaque-rgb.png',
  ),
).toString('base64');

let dir = '';
test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us7-rename-'));
});
test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A book whose pic.png is used in the text, a table cell, the annotation and the cover. */
function book(): string {
  const file = path.join(dir, `rename-${Date.now()}.fb2`);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose_classic</genre><author><first-name>Test</first-name><last-name>Author</last-name></author><book-title>Rename</book-title><annotation><p>Annotated <image l:href="#pic.png"/></p></annotation><coverpage><image l:href="#pic.png"/></coverpage><lang>en</lang></title-info><document-info><author><nickname>t</nickname></author><date>2026</date><id>us7-rename</id><version>1.0</version></document-info></description>
<body><section><p>Text.</p><image l:href="#pic.png"/><table><tr><td>Cell <image l:href="#pic.png"/></td></tr></table><image l:href="#1.jpg"/></section></body>
<binary id="pic.png" content-type="image/png">${PNG}</binary>
<binary id="1.jpg" content-type="image/png">${PNG}</binary>
</FictionBook>
`,
  );
  return file;
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('binary-objects')).toBeVisible();
}

async function rename(page: Page, from: string, to: string): Promise<void> {
  await page.getByTestId(`binary-objects-rename-${from}`).click();
  const dialog = page.getByTestId('dialog-binary-rename');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').fill(to);
}

/** The References column of a row. */
function references(page: Page, id: string) {
  return page.getByTestId(`binary-objects-row-${id}`).locator('td').nth(5);
}

test.describe('US7 (feature 009) - rename a binary object', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1-4. the id and every reference change; one Undo gives the old id back', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, book());
    const before = await references(page, 'pic.png').innerText();
    await rename(page, 'pic.png', 'picture-2.png');
    await page.getByTestId('dialog-binary-rename-button-ok').click();
    await expect(page.getByTestId('binary-objects-row-picture-2.png')).toBeVisible();
    await expect(page.getByTestId('binary-objects-row-pic.png')).toHaveCount(0);
    await expect(references(page, 'picture-2.png')).toHaveText(before);
    // The Body view still shows every picture.
    await page.getByTestId('view-body').click();
    const pictures = page.locator('[data-testid="body-editor"] .fb-image-missing');
    await expect(pictures).toHaveCount(0);

    // One Undo: the old id and its references are back; Redo renames again.
    await page.getByTestId('view-description').click();
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect(page.getByTestId('binary-objects-row-pic.png')).toBeVisible();
    await expect(references(page, 'pic.png')).toHaveText(before);
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-redo').click();
    await expect(page.getByTestId('binary-objects-row-picture-2.png')).toBeVisible();
  });

  test('5, 6. an invalid or taken id is refused with its reason', async ({ core, page }) => {
    await core.openApp(page);
    await openBook(core, page, book());
    await rename(page, 'pic.png', 'a b');
    const dialog = page.getByTestId('dialog-binary-rename');
    const error = page.getByTestId('dialog-binary-rename-error');
    // OK is refused with the reason; the dialog stays open.
    await page.getByTestId('dialog-binary-rename-button-ok').click();
    await expect(error).toContainText('«a b»');
    await expect(dialog).toBeVisible();
    await dialog.locator('input').fill('1.jpg');
    await page.getByTestId('dialog-binary-rename-button-ok').click();
    await expect(error).toContainText('«1.jpg»');
    await dialog.locator('input').press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('binary-objects-row-pic.png')).toBeVisible();
  });

  test('7. the invalid id 1.jpg is renamed to a valid one', async ({ core, page }) => {
    await core.openApp(page);
    await openBook(core, page, book());
    await rename(page, '1.jpg', 'img-1.jpg');
    await page.getByTestId('dialog-binary-rename-button-ok').click();
    await expect(page.getByTestId('binary-objects-row-img-1.jpg')).toBeVisible();
    await expect(references(page, 'img-1.jpg')).toHaveText('1');
  });
});
