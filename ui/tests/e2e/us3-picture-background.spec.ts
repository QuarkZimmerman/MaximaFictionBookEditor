/**
 * Feature 010, US3 (T022): transparent pictures readable on the dark theme - every picture stands
 * on white (D9), a picture with transparent areas offers the background switch on hover, in its
 * menu and in the picture view, every place showing the image follows, the choice is never saved
 * (D10); an opaque picture shows no switch.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const IMAGES_DIR = path.resolve(path.dirname(fixtureBook('x')), '..', 'images');
const base64 = (name: string) => readFileSync(path.join(IMAGES_DIR, name)).toString('base64');

/** A book with a transparent drawing (alpha.png) and an opaque photograph (tiny.jpg). */
function book(dir: string): string {
  const file = path.join(dir, 'transparent.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Drawings</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>drawings-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section>
<p>A drawing:</p>
<image l:href="#drawing.png"/>
<p>A photograph:</p>
<image l:href="#photo.jpg"/>
<p>End.</p>
</section>
</body>
<binary id="drawing.png" content-type="image/png">${base64('alpha.png')}</binary>
<binary id="photo.jpg" content-type="image/jpeg">${base64('tiny.jpg')}</binary>
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

async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  const prompt = page.getByTestId('dialog-validation-failed');
  await expect
    .poll(
      async () =>
        (await prompt.count()) > 0 ||
        /saved|found/i.test(await page.getByTestId('status-message').innerText()),
    )
    .toBe(true);
  if ((await prompt.count()) > 0) {
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  }
  // A second save may find the first one's message still shown: wait for the file itself.
  await expect.poll(() => existsSync(file)).toBe(true);
  return readFileSync(file, 'utf8');
}

const picture = (page: Page, href: string) =>
  page.locator(`[data-testid="body-image"][data-href="${href}"]`);
const imgBackground = (page: Page, href: string) =>
  picture(page, href)
    .locator('img')
    .evaluate(
      (img) =>
        (
          img.ownerDocument.defaultView as unknown as {
            getComputedStyle(element: unknown): { backgroundColor: string };
          }
        ).getComputedStyle(img).backgroundColor,
    );

test.describe('US3 (010) - transparent pictures readable on the dark theme', () => {
  let theme: unknown = undefined;

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const settings = await core.rpc<{ view: Record<string, unknown> }>('settings.get');
    theme = settings.view.theme;
    await core.rpc('settings.set', { patch: { view: { theme: 'dark' } } });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core.rpc('settings.set', { patch: { view: { theme } } }).catch(() => undefined);
  });

  test('1-7. white behind every picture; the switch for the transparent one only, followed everywhere, never saved', async ({
    core,
    page,
  }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-010-'));
    await core.openApp(page);
    await openBook(core, page, book(dir));
    const drawing = picture(page, '#drawing.png');
    const photo = picture(page, '#photo.jpg');
    await expect(drawing.locator('img')).toHaveJSProperty('complete', true);

    // D9: white behind both pictures on the dark theme.
    expect(await imgBackground(page, '#drawing.png')).toBe('rgb(255, 255, 255)');
    expect(await imgBackground(page, '#photo.jpg')).toBe('rgb(255, 255, 255)');
    const before = await saveAs(core, page, path.join(dir, 'before.fb2'));

    // D10: the switch appears on hover over the drawing, never over the photograph.
    const drawingSwitch = drawing.getByTestId('picture-bg-switch');
    await expect(drawingSwitch).toHaveJSProperty('hidden', false);
    await expect(photo.getByTestId('picture-bg-switch')).toHaveJSProperty('hidden', true);
    await drawing.hover();
    await expect(drawingSwitch).toBeVisible();
    await drawingSwitch.click();
    await expect(drawing).toHaveClass(/fb-picture-on-page/);
    expect(await imgBackground(page, '#drawing.png')).toBe('rgba(0, 0, 0, 0)');

    // Every place that shows the image follows: the Binary objects list and the picture view.
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('binary-objects-preview-drawing.png')).toHaveClass(
      /mfbe-picture-on-page/,
    );
    await expect(page.getByTestId('binary-objects-preview-photo.jpg')).not.toHaveClass(
      /mfbe-picture-on-page/,
    );
    await page.getByTestId('binary-objects-view-drawing.png').click();
    await expect(page.getByTestId('picture-view-picture')).toHaveClass(/mfbe-picture-on-page/);
    await page.getByTestId('picture-view-background').click();
    await expect(page.getByTestId('picture-view-picture')).not.toHaveClass(/mfbe-picture-on-page/);
    await page.keyboard.press('Escape');

    // The menu offers the switch too; back on the Body view the drawing is on white again.
    await page.getByTestId('view-body').click();
    await expect(drawing).not.toHaveClass(/fb-picture-on-page/);
    await drawing.click({ button: 'right' });
    await page.getByTestId('context-menu-picture-background').click();
    await expect(drawing).toHaveClass(/fb-picture-on-page/);

    // Never saved: the book is written as before the switches.
    const after = await saveAs(core, page, path.join(dir, 'after.fb2'));
    expect(after).toBe(before);
  });
});
