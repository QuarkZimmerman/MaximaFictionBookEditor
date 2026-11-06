/**
 * Feature 008, User Story 5 (T051, SC-006): the Links bar's Href («Ссылка») list. At a link it
 * offers every jump destination of the book in book order - footnote 2 before footnote 10, the
 * sections outside the mounted window included -; at a picture the book's images. Choosing
 * applies like typing, as one undo step; Style > Link lists the destinations in the same order.
 */
import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MOD } from './fixtures/keys';

interface ModelNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ModelNode[];
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): unknown;
      select(nodeId: string, from?: number, to?: number): boolean;
    };
  };
};

const BOOK = 'href-200.fb2';

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(BOOK)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
}

async function model(page: Page): Promise<{ bodies: ModelNode[] }> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document() as { bodies: ModelNode[] });
}

/** The paragraph holding the link to `href`, and an offset inside the link's text. */
async function linkCaret(page: Page, href: string): Promise<{ nodeId: string; offset: number }> {
  const doc = await model(page);
  let found: { nodeId: string; offset: number } | null = null;
  const visit = (node: ModelNode) => {
    if (found) return;
    if (node.type === 'p' && typeof node.attrs?.nodeId === 'string') {
      let offset = 0;
      for (const child of node.content ?? []) {
        const link = child.marks?.find((m) => m.type === 'link' && m.attrs?.href === href);
        if (link) {
          found = { nodeId: node.attrs.nodeId, offset: offset + 1 };
          return;
        }
        offset += child.text?.length ?? 1;
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body);
  if (!found) throw new Error(`no link to ${href}`);
  return found;
}

async function hrefOfLink(page: Page, nodeId: string): Promise<string | undefined> {
  const doc = await model(page);
  let href: string | undefined;
  const visit = (node: ModelNode) => {
    if (node.attrs?.nodeId === nodeId) {
      for (const child of node.content ?? []) {
        const link = child.marks?.find((m) => m.type === 'link');
        if (link) href = String(link.attrs?.href);
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body);
  return href;
}

async function caretInLink(page: Page, href: string): Promise<string> {
  const caret = await linkCaret(page, href);
  const placed = await page.evaluate(
    ([id, at]) => window.__mfbeTest!.scripts!.select(id as string, at as number, at as number),
    [caret.nodeId, caret.offset],
  );
  expect(placed).toBe(true);
  await expect(page.getByTestId('links-bar-href')).toHaveValue(href);
  return caret.nodeId;
}

const optionTexts = (page: Page) =>
  page.getByTestId('links-bar-href-list').getByRole('option').allTextContents();

test.describe('US5: the Links bar list of jump destinations and images', () => {
  test('at a link: 200 destinations in book order; choosing one is one undo step', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const nodeId = await caretInLink(page, '#n_1');
    await page.getByTestId('links-bar-href-toggle').click();
    const texts = await optionTexts(page);
    expect(texts).toHaveLength(200);
    expect(texts[0]).toBe('#ch_1');
    expect(texts.indexOf('#n_2')).toBeLessThan(texts.indexOf('#n_10'));
    expect(texts).toContain('#ch_50'); // outside the mounted window of a large book
    await page
      .getByTestId('links-bar-href-list')
      .getByRole('option', { name: '#n_5', exact: true })
      .click();
    await expect.poll(() => hrefOfLink(page, nodeId)).toBe('#n_5');
    await page.getByTestId('body-editor').focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => hrefOfLink(page, nodeId)).toBe('#n_1');
  });

  test('from the keyboard: F4 opens, typing narrows, arrows and Enter choose', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    const nodeId = await caretInLink(page, '#n_3');
    const field = page.getByTestId('links-bar-href');
    await field.focus();
    await page.keyboard.press('F4');
    await expect(page.getByTestId('links-bar-href-list')).toBeVisible();
    await field.fill('n_14');
    expect(await optionTexts(page)).toEqual([
      '#n_14',
      '#n_140',
      '#n_141',
      '#n_142',
      '#n_143',
      '#n_144',
      '#n_145',
      '#n_146',
      '#n_147',
      '#n_148',
      '#n_149',
    ]);
    await page.keyboard.press('Enter');
    await expect.poll(() => hrefOfLink(page, nodeId)).toBe('#n_14');
  });

  test("at a picture: the book's 50 images in book order", async ({ core, page }) => {
    await openBook(core, page);
    const picture = page.getByTestId('body-editor').locator('img').first();
    await picture.scrollIntoViewIfNeeded();
    await picture.click();
    await expect(page.getByTestId('links-bar-href')).toHaveValue('#pic_1.png');
    await page.getByTestId('links-bar-href-toggle').click();
    const texts = await optionTexts(page);
    expect(texts).toHaveLength(50);
    expect(texts.slice(0, 3)).toEqual(['#pic_1.png', '#pic_2.png', '#pic_3.png']);
    expect(texts.indexOf('#pic_2.png')).toBeLessThan(texts.indexOf('#pic_10.png'));
    await page.keyboard.press('Escape');
  });

  test('feature 009: at a picture a click on the field opens the list, with thumbnails and the picture view', async ({
    core,
    page,
  }) => {
    // The requester at the smoke test of 0.0.7-rc.6: the picture's id lists the book's pictures
    // with a preview, and one opens enlarged as in the Description view.
    await openBook(core, page);
    const picture = page.getByTestId('body-editor').locator('img').first();
    await picture.scrollIntoViewIfNeeded();
    await picture.click();
    await expect(page.getByTestId('links-bar-href')).toHaveValue('#pic_1.png');
    await page.getByTestId('links-bar-href').click();
    const list = page.getByTestId('links-bar-href-list');
    await expect(list).toBeVisible();
    await expect(list.locator('img.mfbe-hrefcombo-thumb').first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate<number>(
          'document.querySelector("[data-testid=links-bar-href-list] img.mfbe-hrefcombo-thumb").naturalWidth',
        ),
      )
      .toBeGreaterThan(0);
    await page.getByTestId('links-bar-href-enlarge-1').click();
    await expect(page.getByTestId('picture-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture-view')).toHaveCount(0);
  });

  test('feature 009: an empty picture gets its image from the list', async ({ core, page }) => {
    // The requester at the smoke test of 0.0.7-rc.6: an empty picture could not be given an image
    // from the Body view. Selected, its Href box lists the book's pictures; a choice is applied.
    await openBook(core, page);
    // A paragraph directly in a section, where a block picture may stand.
    await page.locator('[data-testid="body-editor"] .fb-section > p.fb-p').first().click();
    await page.getByTestId('menu-add').click();
    await page.getByTestId('menu-add-image').click();
    await page.getByTestId('dialog-insert-clear-image-button-no').click();
    const empty = page
      .locator('[data-testid="body-editor"] figure.fb-image.fb-image-missing')
      .first();
    await expect(empty).toBeVisible();
    await empty.click();
    const href = page.getByTestId('links-bar-href');
    await expect(href).toHaveValue('#undefined');
    await href.click();
    const list = page.getByTestId('links-bar-href-list');
    await expect(list).toBeVisible();
    await list.locator('li[role="option"]', { hasText: /^#pic_2\.png$/ }).click();
    await expect(href).toHaveValue('#pic_2.png');
    await expect(
      page.locator('[data-testid="body-editor"] figure.fb-image.fb-image-missing'),
    ).toHaveCount(0);
  });

  test('a typed address is applied as before', async ({ core, page }) => {
    await openBook(core, page);
    const nodeId = await caretInLink(page, '#n_4');
    const field = page.getByTestId('links-bar-href');
    await field.fill('example.org');
    await field.press('Enter');
    await expect.poll(() => hrefOfLink(page, nodeId)).toBe('http://example.org');
  });

  test('Style > Link lists the destinations in the same order', async ({ core, page }) => {
    await openBook(core, page);
    const caret = await linkCaret(page, '#n_6');
    await page.evaluate(
      ([id]) => window.__mfbeTest!.scripts!.select(id as string, 0, 3),
      [caret.nodeId],
    );
    await page.getByTestId('menu-style').click();
    await page.getByTestId('menu-style-link').click();
    const dialog = page.getByTestId('dialog-link');
    await expect(dialog).toBeVisible();
    const values = await dialog
      .locator('datalist option')
      .evaluateAll((options) => options.map((o) => (o as { value: string }).value));
    expect(values[0]).toBe('#ch_1');
    expect(values.indexOf('#n_2')).toBeLessThan(values.indexOf('#n_10'));
    expect(values).toHaveLength(200);
    await page.keyboard.press('Escape');
  });
});
