/**
 * Feature 011 (D51, rc.3 review) - the marks of the elements that have an id: in the Body view a
 * small "#id" tab at the element's top right (outside the text), a faint tint on paragraph-like
 * elements, an outline on quotes and poems, a "#" in a cell's corner; in the tree a "#" badge on
 * sections that have an id; *View > Show Ids* switches them off. Screenshots in the light and the
 * dark theme are attached for review.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

const BOOK = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Ids</book-title><lang>en</lang></title-info>
<document-info><author><nickname>maker</nickname></author><date>2026</date><id>ids-1</id><version>1.0</version></document-info></description>
<body>
<section id="chapter-1"><title><p>Chapter One</p></title>
<p>A plain paragraph without an id, so the difference shows.</p>
<p id="start">This paragraph has the id "start"; links can point to it as #start.</p>
<cite id="quote-1"><p>A quote that has an id.</p><text-author>Somebody</text-author></cite>
<poem id="poem-1"><stanza><v>A verse of a poem,</v><v id="line-2">a verse with an id.</v></stanza></poem>
<table id="table-1"><tr><th>Room</th><th id="count">Count</th></tr><tr><td>Hall</td><td>1</td></tr></table>
<p>Another plain paragraph.</p>
</section>
<section><title><p>Chapter Two</p></title><p>A section without an id.</p></section>
</body>
</FictionBook>
`;

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

const tab = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (element) => element.ownerDocument.defaultView!.getComputedStyle(element, '::before').content,
    );

// Show Ids goes back to its default after each test: a worker's core keeps its settings from one test
// to the next (G17 once ran after this journey with the ids hidden).
test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

test.describe('feature 011 (D51) - the marks of elements that have an id', () => {
  let dir: string;
  let file: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-ids-'));
    file = path.join(dir, 'ids.fb2');
    writeFileSync(file, BOOK, 'utf8');
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('tabs, tint, outline and badge in both themes; Show Ids switches them off', async ({
    core,
    page,
  }) => {
    await open(core, page, file);
    const body = page.getByTestId('body-editor');
    await expect(body.getByText('This paragraph has the id')).toBeVisible();
    expect(await tab(page, '.fb-p[data-id="start"]')).toBe('"#start"');
    expect(await tab(page, '.fb-section[data-id="chapter-1"]')).toBe('"#chapter-1"');
    expect(await tab(page, '.fb-cite[data-id="quote-1"]')).toBe('"#quote-1"');
    expect(await tab(page, '.fb-p:not([data-id])')).toBe('none');
    // The tree's badge on the section with an id only.
    await expect(page.locator('[data-testid$="-id"].mfbe-tree-id-badge')).toHaveCount(1);
    // The text is unchanged: the tab is not part of it.
    await expect(body.locator('.fb-p[data-id="start"]')).toHaveText(
      'This paragraph has the id "start"; links can point to it as #start.',
    );
    for (const theme of ['light', 'dark'] as const) {
      await core.rpc('settings.set', { patch: { view: { theme } } });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForTimeout(300);
      const shot = await page.screenshot({ path: test.info().outputPath(`ids-${theme}.png`) });
      await test.info().attach(`ids-${theme}`, { body: shot, contentType: 'image/png' });
    }
    // View > Show Ids off: no tab, no badge.
    await page.getByTestId('menu-view').click();
    await page.getByTestId('menu-view-showIds').click();
    await expect(page.locator('html')).not.toHaveClass(/mfbe-show-ids/);
    expect(await tab(page, '.fb-p[data-id="start"]')).toBe('none');
    await expect(page.locator('.mfbe-tree-id-badge').first()).toBeHidden();
  });
});
