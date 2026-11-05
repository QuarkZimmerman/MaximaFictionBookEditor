/**
 * Feature 009, user story 2 - books in ZIP archives (T025; spec FR-010 to FR-028, D5 to D13,
 * D30 to D32, data-model §2 to §5).
 *
 * A single-book archive opens at once and the title names the book and its archive; several
 * books show the chooser with its filter; Cancel leaves the window's book. A book from an archive
 * is never saved back: Save shows the Save As dialog, whose ZIP checkbox (here the queued
 * answer's `zip`) writes a new one-book archive - replacing one keeps its .bak, an archive with
 * other files asks first - or, unticked, a plain file that Save then saves directly. An answer
 * without `zip` brings the save options window. Other archive kinds and encrypted books are
 * refused with a message. Needs the real core (MFBE_CORE_BIN).
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { APP_TITLE, expect, test, type CoreHandle } from './fixtures/core';
import { MAC, MOD } from './fixtures/keys';

const ARCHIVES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/archives',
);

let dir = '';

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us2-archives-'));
});

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the fixture archive `name` in the journey's folder. */
function copyOf(name: string, as = name): string {
  const file = path.join(dir, as);
  copyFileSync(path.join(ARCHIVES, name), file);
  return file;
}

async function openThroughDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
}

async function editBody(page: Page, marker: string): Promise<void> {
  await page.getByTestId('view-body').click();
  await page.locator('[data-testid="body-editor"] p').first().click();
  await page.keyboard.press(MAC ? 'Meta+ArrowLeft' : 'Home');
  await page.keyboard.type(`${marker} `);
}

test.describe('US2 (feature 009) - books in ZIP archives', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1, 4-7. a single-book archive opens, Save shows Save As, a ZIP save replaces it with .bak', async ({
    core,
    page,
  }) => {
    const archive = copyOf('single.fb2.zip', 'one.fb2.zip');
    const original = readFileSync(archive);
    await core.openApp(page);
    await openThroughDialog(core, page, archive);
    await expect(page).toHaveTitle(`book.fb2 (one.fb2.zip) - ${APP_TITLE}`);

    await editBody(page, 'ZIPPED1');
    await core.enqueueDialog('dialog.saveFile', { path: archive, encoding: 'utf-8', zip: true });
    await page.keyboard.press(`${MOD}+s`);
    await expect(page).toHaveTitle(`book.fb2 (one.fb2.zip) - ${APP_TITLE}`);
    await expect.poll(() => existsSync(`${archive}.bak`)).toBe(true);
    expect(readFileSync(`${archive}.bak`).equals(original)).toBe(true);
    // The new archive holds the change: reopen it.
    await openThroughDialog(core, page, archive);
    await expect(page.locator('[data-testid="body-editor"]')).toContainText('ZIPPED1');
  });

  test('FR-016, FR-017. after a Source-view edit, Ctrl+S still asks Save As; the archive is never overwritten', async ({
    core,
    page,
  }) => {
    // The requester's smoke test of rc.5: the text parsed back from the Source view had lost the
    // book's archive, and Save wrote the book over the .zip as a plain file.
    const archive = copyOf('single.fb2.zip', 'source-edit.fb2.zip');
    const original = readFileSync(archive);
    await core.openApp(page);
    await openThroughDialog(core, page, archive);
    await expect(page).toHaveTitle(`book.fb2 (source-edit.fb2.zip) - ${APP_TITLE}`);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await page.locator('.mfbe-source-editor .cm-content').click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type('<!--edited in Source-->');
    await page.keyboard.press('Escape');
    const plain = path.join(dir, 'from-source.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: plain, encoding: 'utf-8', zip: false });
    await page.keyboard.press(`${MOD}+s`);
    await expect.poll(() => existsSync(plain)).toBe(true);
    // (A comment after the root element is not part of the book; the save itself is the point.)
    expect(readFileSync(plain, 'utf8')).toContain('<FictionBook');
    expect(readFileSync(archive).equals(original)).toBe(true);
    expect(existsSync(`${archive}.bak`)).toBe(false);
  });

  test('2, 3. several books: the chooser and its filter; Cancel keeps the window\u2019s book', async ({
    core,
    page,
  }) => {
    const many = copyOf('many-200.zip');
    const single = copyOf('single.fb2.zip', 'keep.fb2.zip');
    await core.openApp(page);
    await openThroughDialog(core, page, single);
    await expect(page).toHaveTitle(`book.fb2 (keep.fb2.zip) - ${APP_TITLE}`);

    await openThroughDialog(core, page, many);
    await expect(page.getByTestId('archive-chooser')).toBeVisible();
    await expect(page.locator('[data-testid^="archive-chooser-row-"]')).toHaveCount(200);
    await page.getByTestId('archive-chooser-button-cancel').click();
    await expect(page).toHaveTitle(`book.fb2 (keep.fb2.zip) - ${APP_TITLE}`);

    await openThroughDialog(core, page, many);
    await page.getByTestId('archive-chooser-filter').fill('book-021');
    await expect(page.locator('[data-testid^="archive-chooser-row-"]')).toHaveCount(1);
    await page.getByTestId('archive-chooser-button-ok').click();
    await expect(page).toHaveTitle(`book-021.fb2 (many-200.zip) - ${APP_TITLE}`);
  });

  test('8, 11. replacing an archive with other files asks; a plain save is then saved directly', async ({
    core,
    page,
  }) => {
    const many = copyOf('many-200.zip', 'library.zip');
    await core.openApp(page);
    await openThroughDialog(core, page, many);
    await page.getByTestId('archive-chooser-filter').fill('book-005');
    await page.getByTestId('archive-chooser-button-ok').click();
    await expect(page).toHaveTitle(`book-005.fb2 (library.zip) - ${APP_TITLE}`);

    await core.enqueueDialog('dialog.saveFile', { path: many, encoding: 'utf-8', zip: true });
    await page.keyboard.press(`${MOD}+s`);
    await expect(page.getByTestId('dialog-archive-others')).toBeVisible();
    await expect(page.getByTestId('dialog-archive-others')).toContainText('202');
    await page.getByTestId('dialog-archive-others-button-no').click();
    expect(readFileSync(many).equals(readFileSync(path.join(ARCHIVES, 'many-200.zip')))).toBe(true);

    // Unticked, a name ending in .zip loses it: the plain book is written beside the archive.
    const plain = path.join(dir, 'book-005.fb2');
    await core.enqueueDialog('dialog.saveFile', {
      path: `${plain}.zip`,
      encoding: 'utf-8',
      zip: false,
    });
    await editBody(page, 'PLAIN11');
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-save').click();
    await expect
      .poll(() => existsSync(plain) && readFileSync(plain, 'utf8').includes('PLAIN11'))
      .toBe(true);
    await expect(page).toHaveTitle(`book-005.fb2 - ${APP_TITLE}`);
    // Tied to the plain file now: Save writes it without a dialog.
    await editBody(page, 'AGAIN11');
    await page.keyboard.press(`${MOD}+s`);
    await expect.poll(() => readFileSync(plain, 'utf8').includes('AGAIN11')).toBe(true);
  });

  test('DP-8. an answer without the checkbox brings the save options window', async ({
    core,
    page,
  }) => {
    const archive = copyOf('single.fb2.zip', 'options.fb2.zip');
    await core.openApp(page);
    await openThroughDialog(core, page, archive);
    await expect(page).toHaveTitle(`book.fb2 (options.fb2.zip) - ${APP_TITLE}`);
    const target = path.join(dir, 'options-copy.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
    await page.keyboard.press(`${MOD}+s`);
    const box = page.getByTestId('save-options-zip');
    await expect(box).toBeChecked();
    await box.uncheck();
    await page.getByTestId('dialog-encoding-button-ok').click();
    await expect.poll(() => existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('<FictionBook');
  });

  test('18, 19, 20. other archive kinds and unreadable books are refused; legacy names read', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openThroughDialog(core, page, copyOf('sample.rar'));
    await expect(page.getByTestId('dialog-archive-error')).toContainText('ZIP');
    await page.getByTestId('dialog-archive-error-button-ok').click();

    await openThroughDialog(core, page, copyOf('encrypted.zip'));
    await expect(page.getByTestId('dialog-archive-error')).toBeVisible();
    await page.getByTestId('dialog-archive-error-button-ok').click();

    await openThroughDialog(core, page, copyOf('names-cp866.zip'));
    await expect(page.getByTestId('archive-chooser')).toContainText(
      '\u0412\u043e\u0439\u043d\u0430 \u0438 \u043c\u0438\u0440.fb2',
    );
    await page.getByTestId('archive-chooser-button-cancel').click();
  });
});
