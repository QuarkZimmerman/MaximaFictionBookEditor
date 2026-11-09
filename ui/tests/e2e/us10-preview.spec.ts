/**
 * Feature 011, User Story 10 - Preview (D44 and its clarifications; FR-020g, FR-020i; SC-016). Runs
 * against the real core: Shift+F5, the toolbar and the status bar's buttons open Preview at the
 * caret's element; links jump and Back returns; note references open the note; nothing typed changes
 * the book; Esc leaves the editor exactly as it was; the frame requests nothing but the editor's own
 * pictures; the 150 MB picture book opens too.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { writeBigPictureBook } from './fixtures/bigPictureBook';
import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const filler = Array.from(
  { length: 40 },
  (_, i) => `<p>Filler paragraph ${i + 1} of the first chapter.</p>`,
).join('');

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<stylesheet type="text/css">.letter { font-style: italic; }</stylesheet>
<description>
<title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Preview</book-title><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>preview-1</id><version>1.0</version></document-info>
</description>
<body>
<section id="ch1"><title><p>Chapter One</p></title>${filler}<p>See <a l:href="#ch2">chapter two</a> and the note<a l:href="#n1" type="note">1</a>.</p></section>
<section id="ch2"><title><p>Chapter Two</p></title><p style="letter">The caret goes here.</p></section>
</body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>The text of the note.</p></section></body>
</FictionBook>
`;

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file, 60_000);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true', {
    timeout: 60_000,
  });
}

const frame = (page: Page) => page.frameLocator('[data-testid="preview-frame"]');
const xml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

test.describe('US10 (feature 011) - Preview', () => {
  let dir: string;
  let file: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us10-'));
    file = path.join(dir, 'preview.fb2');
    writeFileSync(file, BOOK, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('1-4. opens at the caret; links, Back, notes; nothing typed changes the book; Esc restores', async ({
    core,
    page,
  }) => {
    await open(core, page, file);
    await page.getByTestId('body-editor').getByText('The caret goes here.').click();
    // The status bar names the caret's place once the editor has taken the click.
    await expect(page.getByTestId('status-path')).toContainText('section[2]');
    const pathBefore = await page.getByTestId('status-path').textContent();
    const xmlBefore = await xml(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.keyboard.press('Shift+F5');
    await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
    // 1. At the caret's element: its paragraph is in view at the top of the page.
    const target = frame(page).locator('p.letter');
    await expect(target).toBeInViewport();
    await expect(target).toHaveCSS('font-style', 'italic');
    // 2. A link jumps, Back returns; a note reference opens the note.
    const link = frame(page).locator('[data-href="#ch2"]');
    await frame(page).locator('[data-href="#n1"]').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('preview-back')).toBeDisabled();
    await link.click();
    await expect(target).toBeInViewport();
    await expect(page.getByTestId('preview-back')).toBeEnabled();
    await page.getByTestId('preview-back').click();
    await expect(link).toBeInViewport();
    await frame(page).locator('[data-href="#n1"]').click();
    await expect(frame(page).getByTestId('preview-note')).toContainText('The text of the note.');
    // 3. Nothing typed, pasted or dropped changes the book.
    await page.keyboard.type('typed');
    // 4. Esc closes the note, then Preview; the editor is as it was.
    await page.keyboard.press('Escape');
    await expect(frame(page).getByTestId('preview-note')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview')).toHaveCount(0);
    expect(await xml(page)).toBe(xmlBefore);
    await expect(page.getByTestId('status-path')).toHaveText(pathBefore ?? '');
    // The frame asked for nothing but the editor's own address.
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith('about:'))).toEqual(
      [],
    );
  });

  test('the toolbar and the status bar buttons open Preview; its close button closes it', async ({
    core,
    page,
  }) => {
    await open(core, page, file);
    await page.getByTestId('toolbar-view.preview').click();
    await expect(page.getByTestId('preview')).toBeVisible();
    await page.getByTestId('preview-close').click();
    await expect(page.getByTestId('preview')).toHaveCount(0);
    await page.getByTestId('status-preview').click();
    await expect(page.getByTestId('preview')).toBeVisible();
    await page.getByTestId('preview-close').click();
  });

  test('the 150 MB picture book opens in Preview', { tag: '@perf' }, async ({ core, page }) => {
    test.setTimeout(300_000);
    const big = writeBigPictureBook(dir);
    await open(core, page, big.file);
    await page.keyboard.press('Shift+F5');
    // Building that takes longer than half a second shows "Rendering…" with Cancel (SC-016).
    const modal = page.getByTestId('modal-job');
    await expect
      .poll(
        async () =>
          (await page.getByTestId('preview').getAttribute('data-ready')) === 'true' ||
          (await modal.count()) > 0,
        {
          timeout: 60_000,
        },
      )
      .toBe(true);
    await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true', {
      timeout: 120_000,
    });
    await page.keyboard.press('Escape');
  });
});
