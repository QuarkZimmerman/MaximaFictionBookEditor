/**
 * User Story 7 - Work with images and binary objects (T090).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. Native dialogs are answered from the queue (`test.enqueueDialog`);
 * clipboard and drag-and-drop are driven by synthetic DOM events carrying a File.
 *
 * Scenarios (spec.md US7):
 *  1. Add > Image / Inline image / Section image embed JPEG, PNG, GIF, BMP, WebP and TIFF files
 *     as binaries with unique ids; the "Insert clear image?" prompt appears while the setting
 *     is on and "Don't ask again" persists the answer
 *  2. an image pasted into the body is uploaded (never base64 over JSON-RPC) and embedded in
 *     the configured format on save
 *  3. on save every binary is JPEG or PNG, JPEG / PNG inputs are byte-identical, references
 *     still resolve
 *  4. an image whose binary is missing shows a placeholder; validation reports it
 *  5. Add > Binary Object... appends binaries that appear in the Description's list
 *  6. "Save image as..." exports the binary's bytes to a file
 *  7. a picture selected before a view switch is shown selected when the Body view returns,
 *     and a click on it keeps it selected (not a caret at the document start)
 *  + drag-and-drop of an image file onto the body
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import type { Locator, Page } from '@playwright/test';
import { LINE_END } from './fixtures/keys';

const IMAGES_DIR = path.resolve(path.dirname(fixtureBook('x')), '..', 'images');

function image(name: string): string {
  return path.join(IMAGES_DIR, name);
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** A valid sparse FB2 book with one paragraph (and optionally a dangling image reference). */
function book(dir: string, name: string, extraBlocks = ''): string {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Images</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>images-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section><p>Only text.</p>${extraBlocks}</section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

function paragraph(page: Page): Locator {
  return page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();
}

/** Puts the caret into the first paragraph (the editor reads the selection asynchronously). */
async function clickIntoParagraph(page: Page): Promise<void> {
  await paragraph(page).click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId('status-path')).toHaveText(/\/p\[\d+\]$/);
  await page.waitForTimeout(80);
}

/** Save As to `file` through the queued native dialog; returns the written text. */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await menu(page, 'file', 'saveAs');
  const prompt = page.getByTestId('dialog-validation-failed');
  await expect
    .poll(
      async () =>
        (await prompt.count()) > 0 ||
        /saved|found/i.test(await page.getByTestId('status-message').innerText()),
    )
    .toBe(true);
  if ((await prompt.count()) > 0)
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  await expect(page.getByTestId('status-message')).toContainText(/saved|found/i);
  return readFileSync(file, 'utf8');
}

/** `[id, content-type, base64 payload without whitespace]` of every <binary> in the file. */
function binariesOf(xml: string): { id: string; contentType: string; payload: string }[] {
  return [...xml.matchAll(/<binary\s+([^>]*)>([\s\S]*?)<\/binary>/g)].map((m) => {
    const attrs = m[1]!;
    return {
      id: /\bid="([^"]*)"/.exec(attrs)?.[1] ?? '',
      contentType: /content-type="([^"]*)"/.exec(attrs)?.[1] ?? '',
      payload: m[2]!.replace(/\s+/g, ''),
    };
  });
}

/** Browser-side snippet (the e2e tsconfig has no DOM lib, hence a string). */
const DISPATCH_FILE_EVENT = `(args) => {
  const bytes = Uint8Array.from(atob(args.base64), (c) => c.charCodeAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], args.name, { type: args.type }));
  const target = document.querySelector('[data-testid="body-editor"] .fb-section > p');
  if (!target) throw new Error('no paragraph');
  if (args.kind === 'paste') {
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  } else {
    const rect = target.getBoundingClientRect();
    const init = {
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
      clientX: rect.right - 4,
      clientY: rect.top + rect.height / 2,
    };
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));
  }
}`;

/** Dispatches a synthetic paste / drop carrying `file` on the first body paragraph. */
async function dispatchFileEvent(
  page: Page,
  kind: 'paste' | 'drop',
  file: string,
  name: string,
  type: string,
): Promise<void> {
  const base64 = readFileSync(file).toString('base64');
  // A string expression: the IIFE runs in the page with the arguments inlined.
  const args = JSON.stringify({ kind, base64, name, type });
  await page.evaluate(`(${DISPATCH_FILE_EVENT})(${args})`);
}

async function setSettings(core: CoreHandle, patch: Record<string, unknown>): Promise<void> {
  await core.rpc('settings.set', { patch: { other: patch } });
}

test.describe('US7 - images and binary objects', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us7-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
    test.skip(!existsSync(image('tiny.jpg')), 'image fixtures missing');
    // Each scenario starts from the default image settings.
    await setSettings(core, {
      askOnNonClearImage: true,
      insertClearImages: false,
      pasteImageFormat: 'jpeg',
    });
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
  });

  test('1+3. Add menu embeds every format with the clear-image prompt; the saved file holds JPEG/PNG only, byte-identical', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, book(dir, 'insert.fb2'));

    // Block image: the prompt appears (setting on); "No" opens the file dialog.
    await clickIntoParagraph(page);
    await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.jpg')] });
    await menu(page, 'add', 'image');
    const prompt = page.getByTestId('dialog-insert-clear-image');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Insert clear image?');
    await page.getByTestId('dialog-insert-clear-image-button-no').click();
    const block = page.getByTestId('body-image').first();
    await expect(block).toHaveAttribute('data-href', '#tiny.jpg');
    await expect
      .poll(() =>
        block.locator('img').evaluate((img) => {
          const el = img as unknown as { complete: boolean; naturalWidth: number };
          return el.complete && el.naturalWidth > 0;
        }),
      )
      .toBe(true);

    // Inline image.
    await clickIntoParagraph(page);
    await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.png')] });
    await menu(page, 'add', 'inlineImage');
    await page.getByTestId('dialog-insert-clear-image-button-no').click();
    await expect(page.getByTestId('body-inline-image')).toHaveAttribute('data-href', '#tiny.png');

    // Section image with "Don't ask again" + Yes: a clear image, the answer is persisted.
    await clickIntoParagraph(page);
    await menu(page, 'add', 'sectionImage');
    await page.getByTestId('dialog-insert-clear-image-dontask').check();
    await page.getByTestId('dialog-insert-clear-image-button-yes').click();
    await expect(page.getByTestId('body-image').first()).toHaveAttribute('data-href', '#undefined');
    await expect
      .poll(async () => {
        const settings = await core.rpc<{ other: Record<string, unknown> }>('settings.get');
        return [settings.other.askOnNonClearImage, settings.other.insertClearImages];
      })
      .toEqual([false, true]);

    // Not asking any more and inserting files: GIF, BMP, WebP and TIFF are accepted.
    await setSettings(core, { insertClearImages: false });
    await page.waitForTimeout(200); // the settings.changed notification reaches the UI
    for (const name of ['tiny.gif', 'tiny.bmp', 'tiny.webp', 'tiny.tif']) {
      await clickIntoParagraph(page);
      await core.enqueueDialog('dialog.openFile', { paths: [image(name)] });
      await menu(page, 'add', 'image');
      await expect(page.getByTestId('dialog-insert-clear-image')).toHaveCount(0);
      await expect(page.locator(`[data-testid="body-image"][data-href="#${name}"]`)).toBeVisible();
    }

    // Binary Objects list: unique ids, content types as loaded, conversion badges.
    await page.getByTestId('view-description').click();
    const expectations: Record<string, string> = {
      'tiny.jpg': 'image/jpeg',
      'tiny.png': 'image/png',
      'tiny.gif': 'image/gif',
      'tiny.bmp': 'image/bmp',
      'tiny.webp': 'image/webp',
      'tiny.tif': 'image/tiff',
    };
    for (const [id, type] of Object.entries(expectations)) {
      const row = page.getByTestId(`binary-objects-row-${id}`);
      await expect(row).toHaveAttribute('data-content-type', type);
      await expect(row).toHaveAttribute(
        'data-will-convert',
        type === 'image/jpeg' || type === 'image/png' ? 'false' : 'true',
      );
    }

    // Save: only JPEG / PNG binaries, JPEG / PNG inputs byte-identical, references resolve.
    const file = path.join(dir, 'insert-out.fb2');
    const xml = await saveAs(core, page, file);
    const binaries = binariesOf(xml);
    expect(binaries.map((b) => b.id).sort()).toEqual(Object.keys(expectations).sort());
    for (const binary of binaries) {
      expect(['image/jpeg', 'image/png']).toContain(binary.contentType);
    }
    expect(binaries.find((b) => b.id === 'tiny.jpg')!.payload).toBe(
      readFileSync(image('tiny.jpg')).toString('base64'),
    );
    expect(binaries.find((b) => b.id === 'tiny.png')!.payload).toBe(
      readFileSync(image('tiny.png')).toString('base64'),
    );
    const hrefs = [...xml.matchAll(/l:href="#([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((h) => h !== 'undefined');
    const ids = new Set(binaries.map((b) => b.id));
    for (const href of hrefs) expect(ids.has(href)).toBe(true);
    expect(hrefs).toEqual(expect.arrayContaining(['tiny.jpg', 'tiny.png', 'tiny.gif', 'tiny.tif']));
    // The list reflects the conversions after saving.
    await expect(page.getByTestId('binary-objects-row-tiny.gif')).toHaveAttribute(
      'data-will-convert',
      'false',
    );
  });

  test('2. a pasted image is uploaded over HTTP and embedded in the configured format', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, book(dir, 'paste.fb2'));
    const docId = await page.getByTestId('body-view').getAttribute('data-doc-id');
    await clickIntoParagraph(page);
    await dispatchFileEvent(page, 'paste', image('tiny.png'), 'pasted.png', 'image/png');
    const inline = page.getByTestId('body-inline-image');
    await expect(inline).toHaveAttribute('data-href', '#pasted.png');
    const list = await core.rpc<{ id: string; contentType: string }[]>('binary.list', { docId });
    expect(list.map((b) => [b.id, b.contentType])).toEqual([['pasted.png', 'image/png']]);

    // "Paste images as PNG": a pasted BMP becomes PNG on save.
    await setSettings(core, { pasteImageFormat: 'png' });
    await page.waitForTimeout(200);
    await clickIntoParagraph(page);
    await page.keyboard.press(LINE_END);
    await dispatchFileEvent(page, 'paste', image('tiny.bmp'), 'shot.bmp', 'image/bmp');
    await expect(
      page.locator('[data-testid="body-inline-image"][data-href="#shot.bmp"]'),
    ).toBeVisible();
    const xml = await saveAs(core, page, path.join(dir, 'paste-out.fb2'));
    const binaries = binariesOf(xml);
    expect(binaries.find((b) => b.id === 'shot.bmp')?.contentType).toBe('image/png');
    expect(binaries.find((b) => b.id === 'pasted.png')?.payload).toBe(
      readFileSync(image('tiny.png')).toString('base64'),
    );
  });

  test('drag-and-drop of an image file onto the body embeds and inserts it', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, book(dir, 'drop.fb2'));
    await clickIntoParagraph(page);
    await dispatchFileEvent(page, 'drop', image('tiny.gif'), 'dropped.gif', 'image/gif');
    await expect(
      page.locator(
        '[data-testid="body-inline-image"][data-href="#dropped.gif"], [data-testid="body-image"][data-href="#dropped.gif"]',
      ),
    ).toBeVisible();
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('binary-objects-row-dropped.gif')).toHaveAttribute(
      'data-content-type',
      'image/gif',
    );
  });

  test('4. a dangling image reference shows a placeholder and is reported by validation', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, book(dir, 'dangling.fb2', '<image l:href="#missing.png"/>'));
    const placeholder = page.getByTestId('body-image').first();
    await expect(placeholder).toHaveClass(/fb-image-missing/);
    await expect(placeholder.locator('.fb-image-placeholder')).toContainText('#missing.png');
    await menu(page, 'file', 'validate');
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    await expect(
      page
        .locator('[data-testid^="validation-issue-"][data-severity="warning"]')
        .filter({ hasText: 'missing.png' }),
    ).toHaveCount(1);
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('binary-objects-dangling')).toContainText('#missing.png');
  });

  test('5. Add > Binary Object... appends binaries that appear in the Description list', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, book(dir, 'binary.fb2'));
    await core.enqueueDialog('dialog.openFile', {
      paths: [image('alpha.png'), image('alpha.webp')],
    });
    await menu(page, 'add', 'binary');
    await expect(page.getByTestId('status-message')).toHaveText('2 binary objects added');
    await expect(page.getByTestId('body-image')).toHaveCount(0);
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('binary-objects-row-alpha.png')).toHaveAttribute(
      'data-content-type',
      'image/png',
    );
    await expect(page.getByTestId('binary-objects-row-alpha.webp')).toHaveAttribute(
      'data-content-type',
      'image/webp',
    );
    await expect(page.getByTestId('binary-objects-badge-unreferenced-alpha.png')).toBeVisible();
    // The list's own Add button runs the same flow.
    await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.jpg')] });
    await page.getByTestId('binary-objects-add').click();
    await expect(page.getByTestId('binary-objects-row-tiny.jpg')).toBeVisible();
    // Saved: the WebP with transparency becomes PNG, the others stay as they are.
    const xml = await saveAs(core, page, path.join(dir, 'binary-out.fb2'));
    const binaries = binariesOf(xml);
    expect(binaries.find((b) => b.id === 'alpha.webp')?.contentType).toBe('image/png');
    expect(binaries.find((b) => b.id === 'alpha.png')?.payload).toBe(
      readFileSync(image('alpha.png')).toString('base64'),
    );
  });

  test('6. "Save image as..." exports the binary bytes to a file', async ({ core, page }) => {
    await openViaDialog(core, page, book(dir, 'export.fb2'));
    await setSettings(core, { askOnNonClearImage: false, insertClearImages: false });
    await clickIntoParagraph(page);
    await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.jpg')] });
    await menu(page, 'add', 'image');
    const figure = page.getByTestId('body-image').first();
    await expect(figure).toHaveAttribute('data-href', '#tiny.jpg');
    const out = path.join(dir, 'exported.jpg');
    await core.enqueueDialog('dialog.saveFile', { path: out });
    await figure.click({ button: 'right' });
    const entry = page.getByTestId('context-menu-save-image-as');
    await expect(entry).toBeVisible();
    await expect(entry).toHaveText('Save image as...');
    await entry.click();
    await expect(page.getByTestId('status-message')).toContainText(out);
    expect(readFileSync(out).equals(readFileSync(image('tiny.jpg')))).toBe(true);
  });

  test('7. a picture selected before a view switch is shown selected on the way back; a click keeps it selected', async ({
    core,
    page,
  }) => {
    // The Body view comes back without taking the focus when no position is carried: from the
    // Description view, and from the Source view when the mapping is off (as for a stale serial
    // or an older core). The kept selection of a block picture must be shown, and the first click
    // on the picture must not put the caret at the document start.
    await openViaDialog(core, page, fixtureBook('modern-utf8.fb2'));
    const editor = page.getByTestId('body-editor');
    const figure = editor.locator('figure[data-testid="body-image"][data-id="img1"]');
    const statusPath = page.getByTestId('status-path');
    const PICTURE = 'body[1]/section[1]/image[1]';
    await figure.scrollIntoViewIfNeeded();
    await figure.click();
    await expect(figure).toHaveClass(/fb-selected/);
    await expect(statusPath).toHaveText(PICTURE);
    for (const away of ['description', 'source'] as const) {
      if (away === 'description') {
        await page.getByTestId('view-description').click();
        await expect(page.getByTestId('description-view')).toBeVisible();
      } else {
        await page.evaluate('window.__mfbeTest.sourceMapping.enabled = false');
        await page.getByTestId('view-source').click();
        await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
      }
      await page.getByTestId('view-body').click();
      await expect(editor).toBeVisible();
      await expect(figure, `back from ${away}`).toHaveClass(/fb-selected/);
      await expect(statusPath).toHaveText(PICTURE);
      await figure.scrollIntoViewIfNeeded();
      await figure.click();
      // A short wait lets a wrong caret show (the editor reads the browser's after the click).
      await page.waitForTimeout(300);
      await expect(figure, `clicked after the way back from ${away}`).toHaveClass(/fb-selected/);
      await expect(statusPath).toHaveText(PICTURE);
    }
    await page.evaluate('window.__mfbeTest.sourceMapping.enabled = true');
  });
});
