/**
 * Feature 010, US8 (T054): Markdown files become books. File > Import > Markdown File... and the
 * Open dialog's Markdown filter; the unsaved-changes question, whose Cancel changes nothing; the
 * status report, or the summary of what could not come over; Save As proposes `<name>.fb2` in the
 * Markdown file's folder; the Markdown file is never written; a file that is not text leaves the
 * window's book as it was; nothing leaves the computer.
 */

import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  recordOutside,
  shownDocId,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/markdown',
);

let dir = '';
test.beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mfbe-md-'));
  for (const name of ['structure.md', 'special-chars.md', 'pictures.md']) {
    copyFileSync(path.join(FIXTURES, name), path.join(dir, name));
  }
  cpSync(path.join(FIXTURES, 'pictures'), path.join(dir, 'pictures'), { recursive: true });
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function importViaMenu(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMarkdown').click();
}

const bodyTitle = (page: Page) => page.getByTestId('body-editor').locator('.fb-title').first();

test.describe('US8 (010) - Markdown files become books', () => {
  test('1. File > Import > Markdown File...: the book, the status report, modified and untitled; Save As proposes <name>.fb2; the file is unchanged; nothing leaves the computer', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const outside = await recordOutside(context);
    await core.openApp(page);
    const file = path.join(dir, 'structure.md');
    const before = readFileSync(file);
    await importViaMenu(core, page, file);
    await expect(bodyTitle(page)).toHaveText('The Fixture Book');
    // The two chapters, then the footnote's note section in the notes body.
    await expect(page.getByTestId('body-editor').locator('.fb-section .fb-title')).toHaveText([
      'Chapter One',
      'Chapter Two',
      '1',
    ]);
    await expect(page.getByTestId('status-message')).toContainText('(utf-8)');
    await expect(page).toHaveTitle(/\* - /);

    await core.enqueueDialog('dialog.saveFile', { path: null });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    // The template's empty genre makes the book invalid, as File > New's does: save anyway.
    await page.getByTestId('dialog-validation-failed-button-yes').click();
    await expect
      .poll(async () => {
        const requests =
          await core.rpc<{ method: string; defaultPath?: string }[]>('test.dialogRequests');
        return requests.filter((r) => r.method === 'dialog.saveFile').pop()?.defaultPath;
      })
      .toBe(path.join(dir, 'structure.fb2'));
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(outside).toEqual([]);
  });

  test('2. the Open dialog takes a Markdown file and imports it; its special characters become pictures', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await core.enqueueDialog('dialog.openFile', { paths: [path.join(dir, 'special-chars.md')] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await expect(bodyTitle(page)).toHaveText('Special characters');
    const docId = await shownDocId(page);
    await expect
      .poll(async () => {
        const ids = docId
          ? (await core.rpc<{ id: string }[]>('binary.list', { docId })).map((b) => b.id)
          : [];
        return ['ch-2705', 'ch-2610', 'ch-2211'].every((id) => ids.includes(id));
      })
      .toBe(true);
  });

  test('3. pictures: the files are added, the others listed in the summary', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await importViaMenu(core, page, path.join(dir, 'pictures.md'));
    const summary = page.getByTestId('dialog-markdown-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('https://example.com/a.png');
    await expect(summary).toContainText('none.png');
    await expect(summary).toContainText('not-a-picture.png');
    await page.getByTestId('dialog-markdown-summary-button-ok').click();
    await expect(bodyTitle(page)).toHaveText('Pictures');
  });

  test('4. unsaved changes: Cancel keeps the book; a file that is not text leaves it as it was', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    const book = path.join(dir, 'book.fb2');
    copyFileSync(fixtureBook('modern-utf8.fb2'), book);
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, book);
    const paragraph = page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();
    await paragraph.click({ position: { x: 4, y: 6 } });
    await page.keyboard.type('Z');
    const text = await paragraph.innerText();

    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importMarkdown').click();
    await page.getByTestId('dialog-save-changes-button-cancel').click();
    await expect(paragraph).toHaveText(text);

    await core.enqueueDialog('dialog.openFile', { paths: [path.join(dir, 'pictures', 'red.png')] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importMarkdown').click();
    await page.getByTestId('dialog-save-changes-button-no').click();
    await expect(page.getByTestId('dialog-markdown-failed')).toBeVisible();
    await page.getByTestId('dialog-markdown-failed-button-ok').click();
    await expect(paragraph).toHaveText(text);
    await expect(page).toHaveTitle(new RegExp(`^${path.basename(book)}\\*`));
  });
});
