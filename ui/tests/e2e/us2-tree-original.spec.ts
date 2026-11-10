/**
 * Feature 011, User Story 2 - the Document tree as FictionBook Editor 2.7 shows it (D33-D39,
 * FR-010-FR-016; contracts/tree.md). Runs against the real core with
 * `tests/fixtures/books/nested-sections.fb2`: rows and their places, icons, open and closed rows,
 * the menu bar above the tree and the toolbar below it, *Elements* and its choice kept after a
 * restart, `*`, and the caret's row opening its ancestors.
 */

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const BOOK = fixtureBook('nested-sections.fb2');

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
}

/** The tree row whose caption is `caption`. */
function row(page: Page, caption: string | RegExp): Locator {
  return page.getByTestId('tree-rows').getByRole('treeitem').filter({ hasText: caption });
}

async function rowsOfKind(page: Page, kind: string): Promise<number> {
  return page.getByTestId('tree-rows').locator(`[data-row-kind="${kind}"]`).count();
}

async function elements(page: Page): Promise<Locator> {
  await page.getByTestId('tree-menu-elements').click();
  const popup = page.getByTestId('tree-menu-elements-popup');
  await expect(popup).toBeVisible();
  return popup;
}

test.describe('US2 (feature 011) - the Document tree as the original shows it', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await openBook(core, page);
  });

  test('rows, icons and open or closed rows at the original’s starting choices', async ({
    page,
  }) => {
    // No title rows; the subtitle under its section with the three-stars icon (D36, D37).
    expect(await rowsOfKind(page, 'title')).toBe(0);
    const gate = row(page, 'The Gate');
    const subtitle = row(page, 'At the door');
    await expect(subtitle).toHaveAttribute('data-row-kind', 'subtitle');
    const gateLevel = Number(await gate.getAttribute('aria-level'));
    await expect(subtitle).toHaveAttribute('aria-level', String(gateLevel + 1));
    await expect(subtitle.locator('img')).toHaveAttribute('src', /struct-06\.png$/);
    // The poem starts closed and holds its stanzas; the table starts closed and holds its cells.
    const poem = row(page, 'The Lantern');
    await expect(poem).toHaveAttribute('aria-expanded', 'false');
    expect(await rowsOfKind(page, 'stanza')).toBe(0);
    await poem.getByRole('button').click();
    await expect.poll(() => rowsOfKind(page, 'stanza')).toBe(2);
    const table = row(page, 'Room');
    await expect(table).toHaveAttribute('data-row-kind', 'table');
    await expect(table).toHaveAttribute('aria-expanded', 'false');
    await table.getByRole('button').click();
    await expect.poll(() => rowsOfKind(page, 'th')).toBe(3);
    expect(await rowsOfKind(page, 'td')).toBe(6);
    await expect(row(page, /^212$/)).toHaveAttribute('data-row-kind', 'td');
    // Quotes and epigraphs have no rows until they are ticked (D39).
    expect(await rowsOfKind(page, 'cite')).toBe(0);
    expect(await rowsOfKind(page, 'epigraph')).toBe(0);
  });

  test('the menu bar above the tree, the toolbar below it in the original’s order', async ({
    page,
  }) => {
    const bar = await page.getByTestId('tree-menubar').boundingBox();
    const content = await page.getByTestId('tree-content').boundingBox();
    const toolbar = await page.getByTestId('tree-toolbar').boundingBox();
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(content!.y + 1);
    expect(toolbar!.y).toBeGreaterThanOrEqual(content!.y + content!.height - 1);
    const buttons = page.getByTestId('tree-toolbar').getByRole('button');
    await expect(buttons).toHaveCount(7);
    const ids = await buttons.evaluateAll((list) => list.map((b) => b.getAttribute('data-testid')));
    expect(ids).toEqual([
      'tree-toolbar-up',
      'tree-toolbar-down',
      'tree-toolbar-right',
      'tree-toolbar-right-smart',
      'tree-toolbar-left',
      'tree-toolbar-merge',
      'tree-toolbar-delete',
    ]);
  });

  test('Elements: a choice applies at once and is kept after a restart', async ({ core, page }) => {
    let popup = await elements(page);
    await expect(popup.getByRole('menuitemcheckbox', { name: 'Quote' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await popup.getByRole('menuitemcheckbox', { name: 'Quote' }).click();
    await expect.poll(() => rowsOfKind(page, 'cite')).toBe(1);
    await expect(row(page, 'Whoever reads this')).toHaveAttribute('data-row-kind', 'cite');
    popup = await elements(page);
    await popup.getByRole('menuitemcheckbox', { name: 'Subtitle' }).click();
    await expect.poll(() => rowsOfKind(page, 'subtitle')).toBe(0);
    // A restart keeps both choices (one set for every book, D34).
    await core.openApp(page);
    popup = await elements(page);
    await expect(popup.getByRole('menuitemcheckbox', { name: 'Subtitle' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(popup.getByRole('menuitemcheckbox', { name: 'Quote' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Back to the starting choices for the worker's other journeys.
    await popup.getByRole('menuitemcheckbox', { name: 'Subtitle' }).click();
    popup = await elements(page);
    await popup.getByRole('menuitemcheckbox', { name: 'Quote' }).click();
  });

  test('* opens every row', async ({ page }) => {
    const tree = page.getByTestId('tree-content');
    await row(page, 'The Gate').click();
    await tree.press('*');
    await expect(row(page, 'The Lantern')).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => rowsOfKind(page, 'td')).toBe(6);
    expect(await rowsOfKind(page, 'stanza')).toBe(2);
  });

  test('the caret’s row opens the rows above it', async ({ page }) => {
    await page.getByTestId('body-view').getByText('a shadow on the wall').click();
    const selected = page.getByTestId('tree-rows').locator('[data-selected="true"]');
    await expect(selected).toHaveAttribute('data-row-kind', 'stanza');
    await expect(row(page, 'The Lantern')).toHaveAttribute('aria-expanded', 'true');
  });
});
