/**
 * Feature 011, User Story 4 - the tree navigates within the Source view (D9-D12; FR-030-FR-033;
 * SC-004). With `tests/fixtures/books/nested-sections.fb2`: in the Source view a click and the
 * arrows bring each kind of row's opening tag into view with the focus kept in the tree; a
 * double-click and Enter move the focus into the Source view; the Body and Description views keep
 * 0.0.8's behaviour; Go To and Go To Source keep their meanings; unapplied edits are searched as they
 * stand and left as they are.
 */

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { DOC_START } from './fixtures/keys';

const BOOK = fixtureBook('nested-sections.fb2');

interface Hooks {
  sourceSelection(): { anchor: number; head: number } | null;
  sourceText(): string | null;
}
declare const window: { __mfbeTest?: { sourceMapping?: Hooks } };
declare const document: { activeElement: { closest(selector: string): unknown } | null };

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
}

function row(page: Page, caption: string | RegExp): Locator {
  return page.getByTestId('tree-rows').getByRole('treeitem').filter({ hasText: caption }).first();
}

/** The Source text from the caret on (the first characters). */
function atCaret(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hooks = window.__mfbeTest?.sourceMapping;
    const selection = hooks?.sourceSelection();
    const text = hooks?.sourceText();
    if (!selection || !text) return '';
    return text.slice(Math.min(selection.anchor, selection.head)).slice(0, 40);
  });
}

function focusIn(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target) => !!document.activeElement?.closest(target), selector);
}

async function toSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-editor')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__mfbeTest?.sourceMapping?.sourceText() ?? ''))
    .toContain('<body');
}

test.describe('US4 (feature 011) - the tree in the Source view', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page);
  });

  test('1, 2. a click and the arrows show each kind of row’s element; the focus stays in the tree', async ({
    page,
  }) => {
    await toSource(page);
    await page.getByTestId('tree-content').focus();
    await page.getByTestId('tree-content').press('*');
    for (const [caption, tag] of [
      ['The Gate', '<section'],
      ['At the door', '<subtitle'],
      ['The Lantern', '<poem'],
      ['Room', '<table'],
      [/^Item$/, '<th'],
      [/^212$/, '<td'],
      ['Chapter 1. Arrival', '<section'],
    ] as const) {
      await row(page, caption).click();
      await expect.poll(() => atCaret(page), String(caption)).toMatch(new RegExp(`^${tag}[\\s>]`));
      expect(await focusIn(page, '[data-testid="tree-content"]'), String(caption)).toBe(true);
      await expect(page.getByTestId('source-editor')).toBeVisible();
    }
    // The stanza rows: the arrow keys move through them and the Source view follows.
    await row(page, 'The Lantern').click();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => atCaret(page)).toMatch(/^<stanza[\s>]/);
    expect(await focusIn(page, '[data-testid="tree-content"]')).toBe(true);
  });

  test('3. a double-click and Enter put the focus into the Source view', async ({ page }) => {
    await toSource(page);
    await row(page, 'The Gate').dblclick();
    await expect.poll(() => atCaret(page)).toMatch(/^<section[\s>]/);
    await expect.poll(() => focusIn(page, '.cm-editor')).toBe(true);
    await expect(page.getByTestId('source-editor')).toBeVisible();
    await row(page, 'The Letter').click();
    await page.getByTestId('tree-content').press('Enter');
    await expect.poll(() => focusIn(page, '.cm-editor')).toBe(true);
    await expect.poll(() => atCaret(page)).toMatch(/^<section[\s>]/);
  });

  test('4, 5. the Body and Description views keep 0.0.8’s behaviour', async ({ page }) => {
    await row(page, 'The Letter').dblclick();
    await expect(page.getByTestId('body-editor')).toBeFocused();
    await page.getByTestId('view-description').click();
    await row(page, 'The Gate').click();
    await expect(page.getByTestId('description-view')).toBeVisible();
    await row(page, 'The Gate').dblclick();
    await expect(page.getByTestId('body-editor')).toBeVisible();
  });

  test('6. Go To shows the Body view, Go To Source keeps the Source view', async ({ page }) => {
    await toSource(page);
    await row(page, 'The Gate').click({ button: 'right' });
    await page.getByTestId('tree-menu-viewSource').click();
    await expect(page.getByTestId('source-editor')).toBeVisible();
    await expect.poll(() => atCaret(page)).toMatch(/^<section[\s>]/);
    await row(page, 'The Gate').click({ button: 'right' });
    await page.getByTestId('tree-menu-view').click();
    await expect(page.getByTestId('body-editor')).toBeVisible();
  });

  test('7. unapplied edits: the click goes where Go To Source goes and changes nothing', async ({
    page,
  }) => {
    await toSource(page);
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press(DOC_START);
    await page.keyboard.type('<!-- pending -->');
    const before = await page.evaluate(() => window.__mfbeTest?.sourceMapping?.sourceText() ?? '');
    expect(before.startsWith('<!-- pending -->')).toBe(true);
    await row(page, 'The Letter').click();
    await expect.poll(() => atCaret(page)).toMatch(/^<section[\s>]/);
    const after = await page.evaluate(() => window.__mfbeTest?.sourceMapping?.sourceText() ?? '');
    expect(after).toBe(before);
  });
});
