/**
 * Feature 007, User Story 7 (T106; spec FR-060 to FR-063, data-model §4): inline pictures
 * outside table cells show at their natural size, scaled down proportionally only when they are
 * wider than the text area they are in, never enlarged - in the Body view's text and in the
 * description's annotation and history fields. They sit on the baseline and a tall one makes
 * its line taller; a paragraph that starts with a picture has no indent, so the picture never
 * overflows. Pictures in table cells keep feature 006's display; Fast Mode shows placeholders;
 * saving writes the book unchanged.
 *
 * Book: `tests/fixtures/books/inline-pictures.fb2` (photo-572x603.jpg, icon-16x16.png). Runs
 * against the real core; skipped in core-less mode.
 */

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const PHOTO = { width: 572, height: 603 };
const TOL = 1;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

let dir = '';
test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us7-'));
});
test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function openBook(core: CoreHandle, page: Page): Promise<string> {
  const file = path.join(dir, `inline-pictures-${Date.now()}.fb2`);
  copyFileSync(fixtureBook('inline-pictures.fb2'), file);
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, path.basename(file));
  await expect(page.getByTestId('body-editor')).toBeVisible();
  await picturesLoaded(page.getByTestId('body-editor'));
  return file;
}

async function picturesLoaded(scope: Locator): Promise<void> {
  // Every picture with a source has decoded (a placeholder's img has none).
  await expect
    .poll(() =>
      scope.evaluate((root) =>
        [...root.querySelectorAll('img')]
          .filter((img) => img.getAttribute('src'))
          .filter((img) => {
            const image = img as unknown as { complete: boolean; naturalWidth: number };
            return !(image.complete && image.naturalWidth > 0);
          })
          .map((img) => img.closest('[data-href]')?.getAttribute('data-href') ?? '?'),
      ),
    )
    .toEqual([]);
}

function box(element: Locator): Promise<Box> {
  return element.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  });
}

/** The content box of a text block: its rect without padding and borders. */
function contentBox(element: Locator): Promise<Box> {
  return element.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const style = el.ownerDocument.defaultView!.getComputedStyle(el);
    const left = r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = r.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    return { left, top: r.top, right, bottom: r.bottom, width: right - left, height: r.height };
  });
}

/** The expected size of the photo in a text area `width` wide: natural, scaled down to fit. */
function fitted(width: number): { width: number; height: number } {
  const factor = Math.min(1, width / PHOTO.width);
  return { width: PHOTO.width * factor, height: PHOTO.height * factor };
}

async function expectPhotoFits(block: Locator, picture: Locator): Promise<void> {
  const area = await contentBox(block);
  const shown = await box(picture);
  const expected = fitted(area.width);
  expect(Math.abs(shown.width - expected.width)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(shown.height - expected.height)).toBeLessThanOrEqual(TOL);
  expect(shown.left).toBeGreaterThanOrEqual(area.left - TOL);
  expect(shown.right).toBeLessThanOrEqual(area.right + TOL);
}

/** Makes the paragraph `id` of the Body view `width` px wide in content (resizes the window). */
async function textWidth(page: Page, block: Locator, width: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const area = await contentBox(block);
    const viewport = page.viewportSize()!;
    const next = Math.round(viewport.width + (width - area.width));
    if (Math.abs(area.width - width) <= TOL) return;
    await page.setViewportSize({ width: next, height: viewport.height });
    await page.waitForTimeout(100);
  }
}

const block = (page: Page, id: string) =>
  page.locator(`[data-testid="body-editor"] [data-id="${id}"]`);
// The node view puts the reference on the picture's box (nodeviews/image.ts).
const photoIn = (scope: Locator) => scope.locator('[data-href="#photo-572x603.jpg"] img').first();
const iconIn = (scope: Locator) => scope.locator('[data-href="#icon-16x16.png"] img').first();

test.describe('US7 - inline pictures at their natural size', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs the real core (MFBE_CORE_BIN)');
  });

  test('the photo shows at 572x603 in a 700 px text area and fills a 400 px one; the icon stays 16x16', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openBook(core, page);
    const alone = block(page, 'alone');
    await textWidth(page, alone, 700);
    const photo = photoIn(alone);
    const wide = await box(photo);
    expect(Math.abs(wide.width - PHOTO.width)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(wide.height - PHOTO.height)).toBeLessThanOrEqual(TOL);
    const icon = await box(iconIn(block(page, 'icon-alone')));
    expect([Math.round(icon.width), Math.round(icon.height)]).toEqual([16, 16]);

    await textWidth(page, alone, 400);
    const area = await contentBox(alone);
    expect(Math.abs(area.width - 400)).toBeLessThanOrEqual(TOL + 1);
    await expectPhotoFits(alone, photo);
    const narrow = await box(photo);
    expect(Math.abs(narrow.width - area.width)).toBeLessThanOrEqual(TOL);
    // Never enlarged: the icon keeps its size in the narrow window too.
    const smallIcon = await box(iconIn(block(page, 'icon-alone')));
    expect([Math.round(smallIcon.width), Math.round(smallIcon.height)]).toEqual([16, 16]);
  });

  test('a paragraph that starts with a picture has no indent, and nothing scrolls sideways', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openBook(core, page);
    const first = block(page, 'first-child');
    await expect(first).toHaveClass(/fb-starts-with-picture/);
    await expect(first).toHaveCSS('text-indent', '0px');
    // A paragraph whose picture comes after text keeps its indent.
    await expect(block(page, 'running')).not.toHaveClass(/fb-starts-with-picture/);
    await expect(block(page, 'running')).not.toHaveCSS('text-indent', '0px');
    for (const width of [700, 420]) {
      await textWidth(page, first, width);
      const area = await contentBox(first);
      const photo = await box(photoIn(first));
      expect(Math.abs(photo.left - area.left)).toBeLessThanOrEqual(TOL);
      await expectPhotoFits(first, photoIn(first));
      const scroll = await page.getByTestId('body-editor').evaluate((el) => {
        let node: typeof el | null = el;
        while (node) {
          if (node.scrollWidth > node.clientWidth + 1) {
            const style = node.ownerDocument.defaultView!.getComputedStyle(node);
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') return node.className;
          }
          node = node.parentElement;
        }
        return '';
      });
      expect(scroll).toBe('');
    }
  });

  test('titles, epigraphs, verses, cites, superscripts, note links and the description fields follow the same rule', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openBook(core, page);
    for (const id of ['title', 'epigraph', 'poem', 'cite', 'sup', 'note-link']) {
      const scope = block(page, id);
      await scope.scrollIntoViewIfNeeded();
      await expectPhotoFits(scope, photoIn(scope));
      const icon = iconIn(scope);
      if ((await icon.count()) > 0) {
        const size = await box(icon);
        expect([Math.round(size.width), Math.round(size.height)]).toEqual([16, 16]);
      }
    }
    await page.getByTestId('view-description').click();
    for (const field of ['description-annotation', 'description-history']) {
      const scope = page.getByTestId(field);
      await scope.scrollIntoViewIfNeeded();
      await picturesLoaded(scope);
      const paragraph = scope.locator('p').first();
      await expectPhotoFits(paragraph, photoIn(scope));
    }
  });

  test('pictures sit on the baseline; a tall one makes its line taller and the text stays beside it', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openBook(core, page);
    const running = block(page, 'running');
    await textWidth(page, running, 900);
    const photo = photoIn(running);
    await expect(photo).toHaveCSS('vertical-align', 'baseline');
    await expect(running.locator('.fb-inline-image').first()).toHaveCSS(
      'vertical-align',
      'baseline',
    );
    const picture = await box(photo);
    const paragraph = await box(running);
    expect(paragraph.height).toBeGreaterThanOrEqual(picture.height - TOL);
    // The words just before the photo stand on the line the photo stands on: the bottom of
    // their glyph box is the baseline plus the font's descent.
    const words = await running.evaluate((el) => {
      const walker = el.ownerDocument.createTreeWalker(el, 4);
      const node = walker.nextNode();
      const range = el.ownerDocument.createRange();
      const text = node?.textContent ?? '';
      const at = text.indexOf('photo');
      range.setStart(node!, at);
      range.setEnd(node!, at + 'photo'.length);
      const r = range.getBoundingClientRect();
      const size = parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).fontSize);
      return { top: r.top, bottom: r.bottom, fontSize: size };
    });
    expect(words.bottom).toBeGreaterThanOrEqual(picture.bottom - TOL);
    expect(words.bottom - picture.bottom).toBeLessThanOrEqual(words.fontSize * 0.45);
    expect(words.top).toBeGreaterThanOrEqual(picture.top);
  });

  test('a picture in a table cell keeps feature 006’s display; Fast Mode shows placeholders', async ({
    core,
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openBook(core, page);
    const cell = page.locator('[data-testid="body-editor"] [data-id="cell"] td').first();
    await cell.scrollIntoViewIfNeeded();
    const photo = photoIn(cell);
    await expect(photo).toHaveCSS('vertical-align', 'middle');
    await expect(cell.locator('.fb-inline-image').first()).toHaveCSS('vertical-align', 'top');
    const size = await box(photo);
    const lineCap = await cell.evaluate((el) => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      return (
        ((parseFloat(style.fontSize) * parseFloat(style.lineHeight)) / parseFloat(style.fontSize)) *
        10
      );
    });
    expect(size.height).toBeLessThanOrEqual(lineCap + TOL);

    await page.getByTestId('menu-view').click();
    await page.getByTestId('menu-view-fastMode').click();
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-fast-mode', 'true');
    const alone = block(page, 'alone');
    await expect(photoIn(alone)).toBeHidden();
    await expect(alone.locator('.fb-image-placeholder')).toBeVisible();
    await page.getByTestId('menu-view').click();
    await page.getByTestId('menu-view-fastMode').click();
    await expect(page.getByTestId('body-view')).not.toHaveAttribute('data-fast-mode', 'true');
  });

  test('saving writes the book unchanged, apart from what the editor fills in at save', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const out = path.join(dir, 'saved.fb2');
    await core.enqueueDialog('dialog.saveFile', { path: out, encoding: 'utf-8' });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    // The editor's own validation may ask first (as in us3-description's saveAs).
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
    // Whitespace inside a binary's base64 is not content: the editor writes the payload up to
    // the closing tag, the fixture generator ends it with a line break.
    const normalise = (text: string) =>
      text
        .replace(/\r\n/g, '\n')
        .replace(
          /(<binary[^>]*>)([\s\S]*?)(<\/binary>)/g,
          (_all, open: string, payload: string, close: string) =>
            `${open}${payload.replace(/\s+/g, '')}${close}`,
        )
        .replace(/<program-used>[^<]*<\/program-used>/, '')
        .replace(/<date[^>]*>[^<]*<\/date>(?=\s*<id>)/, '')
        .replace(/<id>[^<]*<\/id>(?=\s*<version>)/, '')
        .replace(/<version>[^<]*<\/version>(?=\s*<history>)/, '');
    expect(normalise(readFileSync(out, 'utf8'))).toBe(
      normalise(readFileSync(fixtureBook('inline-pictures.fb2'), 'utf8')),
    );
  });
});
