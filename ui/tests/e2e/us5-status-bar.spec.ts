/**
 * Feature 009, user story 5 - more in the status bar (T061; FR-050 to FR-057, data-model §8).
 *
 * The character pane names the character before the caret (a no-break space, a Cyrillic letter)
 * and a double-click copies its code; a selection shows its counts in the Body and the Source
 * view, which also shows line and column; the encoding pane shows the file's encoding; the
 * validity pane shows the last check until the text changes, and a click validates; the
 * right-click menu hides and shows panes, kept after a restart. An @perf case keeps the panes
 * within 100 ms of a caret move in a 10 MB book. Needs the real core (MFBE_CORE_BIN).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { MAC } from './fixtures/keys';

const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/gen-large-book.py',
);
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
const LINE_END = MAC ? 'Meta+ArrowRight' : 'End';

async function openBook(core: CoreHandle, page: Page, file: string, timeout?: number) {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file, timeout);
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true', {
    timeout,
  });
}

/** The caret at the end of the first Body paragraph holding `text`. */
async function caretAfter(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid="body-editor"] p.fb-p', { hasText: text }).first().click();
  await page.keyboard.press(LINE_END);
}

test.describe('US5 (feature 009) - more in the status bar', () => {
  test.beforeEach(async ({ core, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('1-3. the character pane names the character before the caret; a double-click copies the code', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    await caretAfter(page, 'Сед темпор');
    await page.keyboard.type('x\u00A0');
    const character = page.getByTestId('status-character');
    await expect(character).toHaveText('U+00A0 &#160; No-break space');
    await page.keyboard.type('\u0430');
    await expect(character).toHaveText('U+0430 &#1072; Cyrillic letter');
    await page.keyboard.type('a');
    await expect(character).toHaveText('U+0061 &#97; Latin letter');
    await character.dblclick();
    await expect(page.getByTestId('status-message')).toHaveText('Copied U+0061');
    await expect.poll(() => page.evaluate<string>('navigator.clipboard.readText()')).toBe('U+0061');
  });

  test('4, 5. a selection shows its counts in the Body view; the Source view adds line and column', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    const paragraph = page
      .locator('[data-testid="body-editor"] p.fb-p', { hasText: 'Сед темпор' })
      .first();
    await paragraph.click({ clickCount: 3 });
    await expect(page.getByTestId('status-selection')).toHaveText(
      /^Characters: \d+, words: 14, paragraphs: 1$/,
    );

    await page.getByTestId('view-source').click();
    const content = page.locator('.cm-content');
    await content.click();
    await expect(page.getByTestId('status-position')).toHaveText(/^Ln \d+, Col \d+$/);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('status-selection')).toHaveText(
      /^Characters: \d+, words: \d+, lines: 3$/,
    );
  });

  test('6-8. the encoding, and the validity from the last check until the text changes', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8');
    const validity = page.getByTestId('status-validity');
    await expect(validity).toHaveText('Not checked');
    await validity.click();
    await expect(validity).toHaveText(/^(Valid|Errors: \d+)$/);
    const checked = await validity.innerText();
    await caretAfter(page, 'Сед темпор');
    await page.keyboard.type(' more');
    await expect(validity).toHaveText('Not checked');
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-validate').click();
    await expect(validity).toHaveText(checked);
  });

  test('9. the right-click menu hides and shows panes, kept after a restart', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    await expect(page.getByTestId('status-encoding')).toBeVisible();
    await page.getByTestId('statusbar').click({ button: 'right' });
    const menu = page.getByTestId('status-menu');
    await expect(menu.getByTestId('status-menu-encoding')).toHaveAttribute('aria-checked', 'true');
    await menu.getByTestId('status-menu-encoding').click();
    await expect(page.getByTestId('status-encoding')).toHaveCount(0);

    // A restart keeps it: the setting lives in the core.
    await core.openApp(page);
    await openBook(core, page, fixtureBook('notes-6.fb2'));
    await expect(page.getByTestId('status-validity')).toBeVisible();
    await expect(page.getByTestId('status-encoding')).toHaveCount(0);
    await page.getByTestId('statusbar').click({ button: 'right' });
    await page.getByTestId('status-menu').getByTestId('status-menu-encoding').click();
    await expect(page.getByTestId('status-encoding')).toBeVisible();
  });
});

test.describe('US5 (feature 009) - a 10 MB book', () => {
  let dir = '';
  test.afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test(
    'FR-057: the panes follow the caret within 100 ms',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us5-perf-'));
      const book = path.join(dir, 'large.fb2');
      const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
        encoding: 'utf8',
      });
      test.skip(made.status !== 0, 'python3 / the generator are not available');
      await core.openApp(page);
      await openBook(core, page, book, 30_000);
      await page.locator('[data-testid="body-editor"] .fb-section p.fb-p').first().click();
      const character = page.getByTestId('status-character');
      await expect(character).toBeVisible();
      await page.keyboard.press(LINE_END);
      const samples: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        // Each letter typed shows up in the character pane (the caret is after it).
        const [letter, code] = i % 2 === 0 ? ['\u0416', 'U+0416'] : ['\u0436', 'U+0436'];
        const started = Date.now();
        await page.keyboard.type(letter);
        await expect
          .poll(() => character.innerText(), { intervals: [5], timeout: 5_000 })
          .toContain(code);
        samples.push(Date.now() - started);
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)]!;
      test
        .info()
        .annotations.push({ type: 'perf', description: `pane update median ${median} ms` });
      expect(median, 'a caret move to the panes').toBeLessThan(100 * PERF_FACTOR);
    },
  );
});
