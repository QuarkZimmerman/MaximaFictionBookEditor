/**
 * Feature 008, User Story 2 (T022): a book opened from outside the editor while it runs. The
 * relayed request is driven by `test.simulateOpenRequest`; the shell's part (a new copy, an
 * activation) is recorded by the headless core and read back with `test.copies`.
 */
import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  waitForStartupDocument,
  type CoreHandle,
} from './fixtures/core';

interface Copies {
  records: unknown[];
  newCopies: string[][];
  activations: { slot: number; path: string }[];
  acks: string[];
}

const BOOK_A = 'notes-6.fb2';
const BOOK_B = 'notes-none.fb2';

async function openBook(core: CoreHandle, page: Page, name: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [fixtureBook(name)] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, name);
}

/** The new-copy requests made since `from` (the test core may be shared by a worker's tests). */
async function newCopiesSince(core: CoreHandle, from: number): Promise<string[][]> {
  return (await core.rpc<Copies>('test.copies')).newCopies.slice(from);
}

async function baseline(core: CoreHandle): Promise<number> {
  return (await core.rpc<Copies>('test.copies')).newCopies.length;
}

async function request(core: CoreHandle, name: string, target = 'ask'): Promise<string> {
  const { requestId } = await core.rpc<{ requestId: string }>('test.simulateOpenRequest', {
    paths: [fixtureBook(name)],
    target,
  });
  return requestId;
}

test.describe('US2: a book opened from outside while the editor runs', () => {
  // The worker's core is shared: a remembered answer of an earlier test must not carry over.
  test.beforeEach(async ({ core }) => {
    await core.rpc('settings.set', { patch: { other: { openFromOutside: 'ask' } } });
  });

  test('an untouched copy opens the book at once, and the request is acknowledged', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const started = Date.now();
    const id = await request(core, BOOK_A, 'untouched');
    await waitForBook(page, BOOK_A);
    expect(Date.now() - started).toBeLessThan(3000); // SC-001
    await expect(page.getByTestId('open-elsewhere-dialog')).toHaveCount(0);
    const copies = await core.rpc<Copies>('test.copies');
    expect(copies.acks).toContain(id);
  });

  test('with a book open the question appears; Enter chooses New window', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const from = await baseline(core);
    await openBook(core, page, BOOK_A);
    await request(core, BOOK_B);
    const dialog = page.getByTestId('open-elsewhere-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('open-elsewhere-text')).toContainText(BOOK_B);
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => newCopiesSince(core, from)).toEqual([[fixtureBook(BOOK_B)]]);
    await waitForBook(page, BOOK_A); // this copy keeps its book
  });

  test('This window opens the book here; Escape cancels', async ({ core, page }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const from = await baseline(core);
    await openBook(core, page, BOOK_A);
    await request(core, BOOK_B);
    await expect(page.getByTestId('open-elsewhere-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('open-elsewhere-dialog')).toHaveCount(0);
    await waitForBook(page, BOOK_A);
    await request(core, BOOK_B);
    await page.getByTestId('open-elsewhere-dialog-button-this').click();
    await waitForBook(page, BOOK_B);
    expect(await newCopiesSince(core, from)).toEqual([]);
  });

  test("Don't ask again remembers the answer; Settings shows it", async ({ core, page }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    await openBook(core, page, BOOK_A);
    await request(core, BOOK_B);
    await expect(page.getByTestId('open-elsewhere-dialog')).toBeVisible();
    await page.getByTestId('open-elsewhere-remember').check();
    await page.getByTestId('open-elsewhere-dialog-button-this').click();
    await waitForBook(page, BOOK_B);
    await expect
      .poll(async () => {
        const s = await core.rpc<{ other: { openFromOutside: string } }>('settings.get');
        return s.other.openFromOutside;
      })
      .toBe('thisWindow');
    await request(core, BOOK_A);
    await waitForBook(page, BOOK_A);
    await expect(page.getByTestId('open-elsewhere-dialog')).toHaveCount(0);
  });

  test('a blocking dialog sends the book to a new copy; Find does not', async ({ core, page }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const from = await baseline(core);
    await openBook(core, page, BOOK_A);
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-find').click();
    await request(core, BOOK_B);
    await expect(page.getByTestId('open-elsewhere-dialog')).toBeVisible(); // Find is modeless
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('open-elsewhere-dialog')).toHaveCount(0);
    // The question itself is a blocking dialog: a second request meanwhile goes to a new copy.
    await request(core, BOOK_B);
    await expect(page.getByTestId('open-elsewhere-dialog')).toBeVisible();
    await request(core, BOOK_B);
    await expect.poll(async () => (await newCopiesSince(core, from)).length).toBe(1);
  });

  test('several books at once: the first asks, the others go to new copies meanwhile', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const from = await baseline(core);
    await openBook(core, page, BOOK_A);
    await core.rpc('test.simulateOpenRequest', {
      paths: [fixtureBook(BOOK_B), fixtureBook('fbe-pictures.fb2')],
    });
    await expect(page.getByTestId('open-elsewhere-dialog')).toBeVisible();
    await expect
      .poll(() => newCopiesSince(core, from))
      .toEqual([[fixtureBook('fbe-pictures.fb2')]]);
    await page.getByTestId('open-elsewhere-dialog-button-this').click();
    await waitForBook(page, BOOK_B);
  });

  test('a book already open here only takes the focus', async ({ core, page }) => {
    await core.openApp(page);
    await waitForStartupDocument(page);
    const from = await baseline(core);
    await openBook(core, page, BOOK_A);
    await request(core, BOOK_A);
    await expect(page.getByTestId('open-elsewhere-dialog')).toHaveCount(0);
    await waitForBook(page, BOOK_A);
    expect(await newCopiesSince(core, from)).toEqual([]);
  });
});
