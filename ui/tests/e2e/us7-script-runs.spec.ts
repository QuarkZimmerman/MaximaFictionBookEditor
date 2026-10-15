/**
 * Feature 002, User Story 7 - scripts stay under the user's control (T055; FR-051 to FR-053,
 * SC-009). On the generated 1 MB book (5,000 paragraphs, `tests/bench/gen-text-book.py`) with
 * the fixture scripts of `tests/scripts/fixtures/05_Runs` copied into the user scripts folder:
 *
 *  - the run bar shows the progress and Cancel; the editor refuses typing during the run;
 *    Cancel restores the document within 2 s, also while the script is busy;
 *  - one Undo restores a run that changed 5,000 paragraphs exactly and Redo applies it again
 *    (0.0.1 lost the oldest changes: the editor kept 100 history steps);
 *  - a prompt in the middle of a run shows the changes made so far; Cancel while the script
 *    waits in it closes the prompt and restores the document.
 *
 * Needs the real core and `python3`; skipped otherwise.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures', '05_Runs');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'bench', 'gen-text-book.py');
const BOOKS_DIR = path.join(REPO_ROOT, 'tests', 'bench', 'books');
const BOOK = path.join(BOOKS_DIR, 'clean-1mb.fb2');

/** FR-051: Cancel restores the document within 2 seconds. */
const CANCEL_BUDGET_MS = 2_000;

interface ScriptHooks {
  list(): { id: string }[];
  run(id: string): Promise<{ status: string; message?: string }>;
  state(): { status: string } | null;
  document(): { path?: string } | null;
  toXml(): Promise<string>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

test.beforeAll(async ({ coreServer }) => {
  if (!existsSync(BOOK)) {
    mkdirSync(BOOKS_DIR, { recursive: true });
    spawnSync('python3', [GENERATOR, '--out-dir', BOOKS_DIR, '--only', '1mb'], {
      encoding: 'utf8',
    });
  }
  if (!coreServer.hasCore || !coreServer.dataDir) return;
  const target = path.join(coreServer.dataDir, 'scripts', '05_Runs');
  if (!existsSync(target)) cpSync(FIXTURES, target, { recursive: true });
});

test.beforeEach(async ({ core }) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  test.skip(!existsSync(BOOK), 'python3 / the book generator are not available');
});

async function openBook(page: Page, core: CoreHandle): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await expect
    .poll(() => page.evaluate(() => window.__mfbeTest?.scripts?.list().length ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await expect
    .poll(() => page.evaluate(() => window.__mfbeTest?.scripts?.document()?.path ?? null), {
      timeout: 30_000,
    })
    .toBe(BOOK);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

const toXml = (page: Page) => page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

async function start(page: Page, id: string): Promise<void> {
  await page.evaluate((scriptId) => {
    void window.__mfbeTest!.scripts!.run(scriptId);
  }, id);
}

const status = (page: Page) =>
  page.evaluate(() => window.__mfbeTest!.scripts!.state()?.status ?? 'none');

/** The first paragraph of the Body view (after the first section's title). */
const firstParagraph = (page: Page) =>
  page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();

test.describe('US7 script runs', () => {
  test('run bar with progress and Cancel; no typing during the run; Cancel restores within 2 s', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const before = await toXml(page);
    const original = await firstParagraph(page).innerText();
    await start(page, 'runs.busy');

    const runText = page.getByTestId('script-run-text');
    await expect(page.getByTestId('script-run-cancel')).toBeVisible();
    await expect(runText).toHaveText(/^Marking: \d+%$|^Busy: \d+$/);
    // Every paragraph changed and shown; the script keeps the worker busy now.
    await expect(runText).toHaveText(/^Busy: \d+$/, { timeout: 30_000 });
    await expect(firstParagraph(page)).toHaveText(/^#\d+ /);

    // The user cannot change the document meanwhile.
    const editor = page.getByTestId('body-editor');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await firstParagraph(page).click();
    await page.keyboard.type('typed');
    await page.keyboard.press('Enter');
    await expect(firstParagraph(page)).not.toContainText('typed');
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();

    const cancelled = Date.now();
    await page.getByTestId('script-run-cancel').click();
    await expect.poll(() => status(page), { timeout: CANCEL_BUDGET_MS }).toBe('cancelled');
    await expect(firstParagraph(page)).toHaveText(original, { timeout: CANCEL_BUDGET_MS });
    expect(Date.now() - cancelled, 'Cancel restores the document').toBeLessThan(CANCEL_BUDGET_MS);
    expect(await toXml(page)).toBe(before);
    await expect(page.getByTestId('script-run-bar')).toHaveCount(0);
    await expect(page.getByTestId('status-message')).toHaveText(/cancelled/);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('toolbar-edit.undo')).toBeDisabled();
  });

  test('one Undo restores a run that changed 5,000 paragraphs; Redo applies it again', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const before = await toXml(page);
    const result = await page.evaluate(() => window.__mfbeTest!.scripts!.run('runs.bulk'));
    expect(result.status).toBe('done');
    const after = await toXml(page);
    expect(after.match(/<p>#\d+ /g)?.length ?? 0).toBeGreaterThanOrEqual(5_000);
    await expect(firstParagraph(page)).toHaveText(/^#\d+ /);

    const undo = page.getByTestId('toolbar-edit.undo');
    await undo.click();
    await expect(undo).toBeDisabled();
    expect(await toXml(page)).toBe(before);
    await expect(firstParagraph(page)).not.toHaveText(/^#\d+ /);

    const redo = page.getByTestId('toolbar-edit.redo');
    await redo.click();
    await expect(redo).toBeDisabled();
    expect(await toXml(page)).toBe(after);
    await expect(firstParagraph(page)).toHaveText(/^#\d+ /);
  });

  test('a prompt in the middle of a run shows the changes so far; Cancel closes it and restores', async ({
    page,
    core,
  }) => {
    await openBook(page, core);
    const paragraphs = page.getByTestId('body-editor').locator('.fb-section p.fb-p');
    const original = await paragraphs.nth(1).innerText();

    // OK: the run goes on and finishes.
    await start(page, 'runs.prompt');
    const message = page.getByTestId('dialog-script-message');
    await expect(message).toBeVisible();
    await expect(paragraphs.nth(1)).toHaveText('Changed 1');
    await message.getByTestId('dialog-script-message-button-ok').click();
    await expect.poll(() => status(page)).toBe('done');
    const finished = await toXml(page);
    expect(finished).toContain('<p>Changed 9</p>');
    expect(finished).toContain('<p>Second 19</p>');

    // Cancel on the run bar while the script waits in its message box.
    const undo = page.getByTestId('toolbar-edit.undo');
    await undo.click();
    await expect(undo).toBeDisabled();
    const before = await toXml(page);
    await start(page, 'runs.prompt');
    await expect(message).toBeVisible();
    await expect(paragraphs.nth(1)).toHaveText('Changed 1');
    await page.getByTestId('script-run-cancel').click();
    await expect(message).toHaveCount(0);
    await expect.poll(() => status(page)).toBe('cancelled');
    await expect(paragraphs.nth(1)).toHaveText(original);
    expect(await toXml(page)).toBe(before);
  });
});
