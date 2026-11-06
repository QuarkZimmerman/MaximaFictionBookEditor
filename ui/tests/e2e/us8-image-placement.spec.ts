/**
 * Feature 009, user story 8 - where Add > Image puts a block picture (T079; D28, data-model §11).
 *
 * In a paragraph directly in a section the caret decides: at its start the picture stands
 * before the paragraph, inside it the paragraph is split around the picture, at its end the
 * picture follows it, and an empty paragraph gives its place. One Undo takes the picture out
 * and joins the halves again. The "Insert clear image?" question and the file choice work as
 * before. Needs the real core (MFBE_CORE_BIN).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MOD } from './fixtures/keys';

const BOOK = fixtureBook('notes-6.fb2');
const PICTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/images/opaque-rgb.png',
);

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/**
 * The caret in the paragraph starting with `text`: at its start, its end or an offset into its
 * first text. Set as the DOM selection, which the editor follows (the paragraphs wrap, so Home
 * and End would stop at the ends of a visual line).
 */
async function caretIn(page: Page, text: string, where: 'start' | 'end' | number): Promise<void> {
  const placed = await page.evaluate<boolean>(`(() => {
    const p = [...document.querySelectorAll('[data-testid="body-editor"] p.fb-p')]
      .find((el) => el.textContent.startsWith(${JSON.stringify(text)}));
    if (!p) return false;
    p.closest('[contenteditable="true"]').focus();
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
    const where = ${JSON.stringify(where)};
    const range = document.createRange();
    if (where === 'end') {
      range.setStart(texts[texts.length - 1], texts[texts.length - 1].length);
    } else {
      // The text may be split into several nodes (the spelling marks of macOS, for one): the
      // offset counts across them.
      let rest = where === 'start' ? 0 : where;
      const node = texts.find((text) => {
        if (rest <= text.length) return true;
        rest -= text.length;
        return false;
      });
      range.setStart(node, rest);
    }
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return true;
  })()`);
  expect(placed, text).toBe(true);
  await page.waitForTimeout(50);
}

/** Add > Image, answering the "Insert clear image?" question. */
async function addImage(page: Page, clear: boolean): Promise<void> {
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-image').click();
  const question = page.getByTestId('dialog-insert-clear-image');
  await expect(question).toBeVisible();
  await question.getByTestId(`dialog-insert-clear-image-button-${clear ? 'no' : 'yes'}`).click();
}

/** The index of the paragraph starting with `prefix` among `blocks`. */
const at = (blocks: string[], prefix: string) =>
  blocks.findIndex((b) => b.startsWith(`p:${prefix}`));

/** The blocks around the paragraph starting with `text`: "p:<its text>" or "image". */
function blocksAround(page: Page, text: string): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const all = [...document.querySelectorAll('[data-testid="body-editor"] p.fb-p')];
    const p = all.find((el) => el.textContent.startsWith(${JSON.stringify(text)}));
    if (!p) return [];
    const out = [];
    for (const el of p.parentElement.children) {
      if (el.matches('p.fb-p')) out.push('p:' + el.textContent);
      else if (el.classList.contains('fb-image')) out.push('image');
    }
    return out;
  })()`);
}

test.describe('US8 (feature 009) - where a block picture goes', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('1-4. start, inside, end and an empty paragraph; one Undo joins the halves', async ({
    core,
    page,
  }) => {
    await openBook(core, page);

    // At the start of a paragraph: before it.
    await caretIn(page, 'Сит адиписцинг', 'start');
    await addImage(page, true);
    let blocks = await blocksAround(page, 'Сит адиписцинг');
    expect(blocks[at(blocks, 'Сит адиписцинг') - 1], blocks.join(' | ')).toBe('image');

    // Inside: split around the picture.
    await caretIn(page, 'Магна ипсум', 'Магна '.length);
    await addImage(page, true);
    blocks = await blocksAround(page, 'Магна ');
    const half = blocks.indexOf('p:Магна ');
    expect(half, blocks.join(' | ')).toBeGreaterThanOrEqual(0);
    expect(blocks[half + 1]).toBe('image');
    expect(blocks[half + 2]).toMatch(/^p:ипсум амет/);
    // One Undo: the picture is gone and the paragraph whole again.
    await page.keyboard.press(`${MOD}+z`);
    await expect(
      page.locator('[data-testid="body-editor"] p.fb-p', { hasText: /^Магна ипсум амет/ }),
    ).toHaveCount(1);

    // At the end: after it.
    await caretIn(page, 'Лорем сит адиписцинг', 'end');
    await addImage(page, true);
    blocks = await blocksAround(page, 'Лорем сит ади');
    expect(blocks[at(blocks, 'Лорем сит адиписцинг') + 1], blocks.join(' | ')).toBe('image');

    // An empty paragraph gives its place.
    await caretIn(page, 'Лаборе магна', 'end');
    await page.keyboard.press('Enter');
    await addImage(page, true);
    blocks = await blocksAround(page, 'Лаборе магна');
    const after = at(blocks, 'Лаборе магна');
    expect(blocks[after + 1], blocks.join(' | ')).toBe('image');
    expect(blocks[after + 2]).toMatch(/^p:Долор консектетур/);
  });

  test('7. the file choice still works: the picture embedded and placed by the caret', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await caretIn(page, 'Долоре лорем сит', 'start');
    await core.enqueueDialog('dialog.openFile', { paths: [PICTURE] });
    await addImage(page, false);
    // The file is embedded first (binary.add), then the picture placed.
    await expect(page.locator('[data-testid="body-editor"] .fb-image')).toHaveCount(1);
    const blocks = await blocksAround(page, 'Долоре лорем');
    expect(blocks[at(blocks, 'Долоре лорем сит') - 1], blocks.join(' | ')).toBe('image');
    await page.getByTestId('view-description').click();
    await expect(page.getByTestId('binary-objects-row-opaque-rgb.png')).toBeVisible();
  });
});
