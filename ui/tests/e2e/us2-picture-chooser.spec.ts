/**
 * Feature 010, US2 (T014): giving a picture its image where it stands - the placeholders of
 * pictures without an image (D8), the double-click on them (D4), the picture chooser with its
 * enlarge buttons, filter, From file... and Cancel (D3, D6), Change picture... and Show picture on
 * the pictures' menus (D4, D5), and the cover's chooser.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const IMAGES_DIR = path.resolve(path.dirname(fixtureBook('x')), '..', 'images');
const image = (name: string) => path.join(IMAGES_DIR, name);
const base64 = (name: string) => readFileSync(image(name)).toString('base64');

/** A book with an empty, two real, a missing and an external picture, and a cover. */
function pictureBook(dir: string): string {
  const file = path.join(dir, 'pictures.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Pictures</book-title>
<coverpage><image l:href="#pic1.png"/></coverpage>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>pictures-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section>
<title><p>Chapter</p></title>
<p>First paragraph.</p>
<image l:href="#undefined"/>
<p>Between.</p>
<image l:href="#pic1.png"/>
<p>Inline <image l:href="#pic2.png"/> picture.</p>
<image l:href="#missing.png"/>
<p>Then.</p>
<image l:href="http://example.com/x.png"/>
<p>Last.</p>
</section>
</body>
<binary id="pic1.png" content-type="image/png">${base64('tiny.png')}</binary>
<binary id="pic2.png" content-type="image/png">${base64('alpha.png')}</binary>
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

const picture = (page: Page, href: string) =>
  page.locator(`[data-testid="body-image"][data-href="${href}"]`);
const chooser = (page: Page) => page.getByTestId('picture-chooser');

test.describe('US2 (010) - give a picture its image where it stands', () => {
  let dir = '';

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us2-010-'));
    await core.openApp(page);
    await openBook(core, page, pictureBook(dir));
  });

  test('1-4. an empty picture says so; a double-click chooses its image, enlarge and back, one Undo empties it again', async ({
    page,
  }) => {
    const empty = picture(page, '#undefined');
    await expect(empty.locator('.fb-image-placeholder')).toHaveText(
      'Empty picture - double-click to choose its image',
    );
    const nodeId = await empty.getAttribute('data-node-id');
    expect(nodeId).toBeTruthy();
    await expect(
      page.locator('.mfbe-tree-row[data-kind="image"]').filter({ hasText: 'Empty picture' }),
    ).toHaveCount(1);

    await empty.dblclick();
    await expect(chooser(page)).toBeVisible();
    await expect(chooser(page).getByRole('option')).toHaveCount(2);
    await page.getByTestId('picture-chooser-enlarge-pic1.png').click();
    await expect(page.getByTestId('picture-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
    await expect(chooser(page)).toBeVisible();

    await page.getByTestId('picture-chooser-item-pic2.png').dblclick();
    await expect(chooser(page)).toHaveCount(0);
    const same = page.locator(`[data-node-id="${nodeId}"]`);
    await expect(same).toHaveAttribute('data-href', '#pic2.png');

    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect(same).toHaveAttribute('data-href', '#undefined');
  });

  test('5-7, 10, 13. a picture with its image: no double-click chooser; its menu changes it, filter, From file... with Cancel and OK', async ({
    core,
    page,
  }) => {
    const pic1 = picture(page, '#pic1.png');
    await pic1.dblclick();
    await page.waitForTimeout(300);
    await expect(chooser(page)).toHaveCount(0);

    await pic1.click({ button: 'right' });
    await expect(page.getByTestId('context-menu-change-picture')).toBeVisible();
    await expect(page.getByTestId('context-menu-show-picture')).toBeVisible();
    await expect(page.getByTestId('context-menu-save-image-as')).toBeVisible();
    await page.getByTestId('context-menu-change-picture').click();
    await expect(chooser(page)).toBeVisible();
    await expect(page.getByTestId('picture-chooser-item-pic1.png')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByTestId('picture-chooser-filter').fill('pic2');
    await expect(chooser(page).getByRole('option')).toHaveCount(1);
    await page.getByTestId('picture-chooser-filter').fill('');

    // A file that is not a picture: said so, nothing added, the dialog stays.
    const notPicture = path.join(dir, 'notes.png');
    writeFileSync(notPicture, 'plain text, not a picture', 'utf8');
    await core.enqueueDialog('dialog.openFile', { paths: [notPicture] });
    await page.getByTestId('picture-chooser-add-file').click();
    await expect(page.getByTestId('picture-chooser-error')).toHaveText(
      'This file is not a picture the editor can show; nothing was added.',
    );
    await expect(chooser(page).getByRole('option')).toHaveCount(2);

    // From file..., then Cancel: the added file goes again.
    await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.gif')] });
    await page.getByTestId('picture-chooser-add-file').click();
    await expect(page.getByTestId('picture-chooser-item-tiny.gif')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByTestId('picture-chooser-button-cancel').click();
    await expect(chooser(page)).toHaveCount(0);
    await expect(pic1).toHaveCount(1);

    await pic1.click({ button: 'right' });
    await page.getByTestId('context-menu-change-picture').click();
    await expect(page.getByTestId('picture-chooser-item-tiny.gif')).toHaveCount(0);

    // From file..., then OK: the picture shows the new image.
    await core.enqueueDialog('dialog.openFile', { paths: [image('tiny.gif')] });
    await page.getByTestId('picture-chooser-add-file').click();
    await page.getByTestId('picture-chooser-button-ok').click();
    await expect(chooser(page)).toHaveCount(0);
    await expect(picture(page, '#tiny.gif')).toHaveCount(1);
    await expect(picture(page, '#pic1.png')).toHaveCount(0);
  });

  test('12, 8, 11. missing and external placeholders; the inline picture and the cover offer Change picture...', async ({
    page,
  }) => {
    await expect(picture(page, '#missing.png').locator('.fb-image-placeholder')).toHaveText(
      'Picture #missing.png not found - double-click to choose another',
    );
    await expect(
      picture(page, 'http://example.com/x.png').locator('.fb-image-placeholder'),
    ).toHaveText(
      'External picture: http://example.com/x.png - double-click to choose a picture from the book or a file',
    );

    const inline = page.locator('[data-testid="body-inline-image"][data-href="#pic2.png"]');
    await inline.click({ button: 'right' });
    await expect(page.getByTestId('context-menu-change-picture')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('view-description').click();
    // In view first: the scroll of a click's own scrolling would close the menu it opens.
    const thumb = page.getByTestId('description-cover-0-thumb');
    await thumb.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await thumb.click({ button: 'right' });
    await expect(page.getByTestId('cover-context-menu')).toBeVisible();
    await page.getByTestId('cover-context-menu-image.change').click();
    const cover = page.getByTestId('cover-picker');
    await expect(cover).toBeVisible();
    await expect(cover).toContainText('Choose a cover image');
    await expect(page.getByTestId('cover-picker-enlarge-pic1.png')).toBeVisible();
    await page.getByTestId('cover-picker-button-cancel').click();
    await expect(cover).toHaveCount(0);
  });
});
