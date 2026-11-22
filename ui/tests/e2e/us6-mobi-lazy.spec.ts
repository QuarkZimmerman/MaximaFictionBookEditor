/**
 * Feature 018, User Story 6 (T045, SC-008, SC-009):
 * 1. Strict on-demand lazy loading: zero MOBI chunks at start-up, editing, and Settings > Exports >
 *    MOBI; exporting loads only `mobi-export` (never `mobi-import` or `epub-*`); importing loads
 *    only `mobi-import` (never `mobi-export` or `epub-*`).
 * 2. Hostile / malformed / oversized fixture safety: every `--hostile` fixture from
 *    `tests/fixtures/mobi/make-fixtures.py` ends safely in a valid book or refusal dialog with
 *    zero crashes, zero hangs, zero script execution (`window.__MFBE_XSS__`), and zero external
 *    network requests.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  expect,
  fixtureBook,
  shownDocId,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { findPython } from './fixtures/mobi';
import { scratchDir } from './fixtures/scratch';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_SCRIPT = path.join(REPO_ROOT, 'tests/fixtures/mobi/make-fixtures.py');

const ANY_MOBI_CHUNK = /\/(mobi-export|mobi-import|mobi-shared)-[\w-]+\.js$/;
const MOBI_EXPORT_CHUNK = /\/mobi-export-[\w-]+\.js$/;
const MOBI_IMPORT_CHUNK = /\/mobi-import-[\w-]+\.js$/;
const ANY_EPUB_CHUNK = /\/(epub-export|epub-import|epub-shared)-[\w-]+\.js$/;

declare const window: { __MFBE_XSS__?: unknown };

async function openBook(core: CoreHandle, page: Page, name: string): Promise<void> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
}

async function exportMobiOnce(core: CoreHandle, page: Page, target: string): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    zip: false,
    selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
  });
  await clickExport(core, page, 'exportMobi');
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        return ((await page.getByTestId('status-message').textContent()) ?? '').includes(
          'Exported to',
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function clickImportMobi(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMobi').click();
}

test.describe('US6 (feature 018) - Lazy loading isolation & hostile fixture safety', () => {
  test.beforeEach(({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('zero MOBI chunks load at start-up, editing, or Settings; export loads only mobi-export', async ({
    core,
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await core.openApp(page);
    await openBook(core, page, 'reference-all-elements.fb2');

    // Edit text in Body view
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.type(' ');

    // Open Settings > Exports > MOBI and inspect controls, then cancel
    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await page.getByTestId('settings-tab-exports').click();
    await page.getByTestId('settings-exports-format').selectOption('mobi');
    await expect(page.getByTestId('settings-page-mobi')).toBeVisible();
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();

    // Still zero MOBI chunks fetched!
    expect(requested.filter((u) => ANY_MOBI_CHUNK.test(u))).toEqual([]);

    // Export twice -> mobi-export loads ONCE, mobi-import & epub-* NEVER load!
    const dir = scratchDir('mobi-us6-lazy-exp-');
    await exportMobiOnce(core, page, path.join(dir, 'one.mobi'));
    await exportMobiOnce(core, page, path.join(dir, 'two.mobi'));

    expect(requested.filter((u) => MOBI_EXPORT_CHUNK.test(u))).toHaveLength(1);
    expect(requested.filter((u) => MOBI_IMPORT_CHUNK.test(u))).toEqual([]);
    expect(requested.filter((u) => ANY_EPUB_CHUNK.test(u))).toEqual([]);
  });

  test('import loads only mobi-import (once), never mobi-export or epub-*', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us6-lazy-imp-');
    execFileSync(findPython(), [FIXTURE_SCRIPT, '--out', dir, '--no-oversized'], { stdio: 'pipe' });
    const sample = path.join(dir, 'mobi7-uncompressed.mobi');

    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    await core.openApp(page);
    expect(requested.filter((u) => ANY_MOBI_CHUNK.test(u))).toEqual([]);

    for (let i = 0; i < 2; i++) {
      await core.enqueueDialog('dialog.openFile', { paths: [sample] });
      await clickImportMobi(page);
      const savePrompt = page.getByTestId('dialog-save-changes');
      if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
        await savePrompt.getByTestId('dialog-save-changes-button-no').click();
      }
      const summary = page.getByTestId('dialog-mobi-import-summary');
      const failed = page.getByTestId('dialog-mobi-import-failed');
      await expect
        .poll(
          async () => {
            if (await failed.isVisible())
              throw new Error(`Import failed: ${await failed.textContent()}`);
            if (await summary.isVisible()) {
              await summary.getByRole('button').first().click();
              return true;
            }
            return ((await page.getByTestId('status-message').textContent()) ?? '').includes(
              'Imported from MOBI:',
            );
          },
          { timeout: 60_000 },
        )
        .toBe(true);
    }

    expect(requested.filter((u) => MOBI_IMPORT_CHUNK.test(u))).toHaveLength(1);
    expect(requested.filter((u) => MOBI_EXPORT_CHUNK.test(u))).toEqual([]);
    expect(requested.filter((u) => ANY_EPUB_CHUNK.test(u))).toEqual([]);
  });

  test('every hostile / malformed / oversized fixture is handled safely with zero XSS or network calls', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    const dir = scratchDir('mobi-us6-hostile-');
    execFileSync(findPython(), [FIXTURE_SCRIPT, '--out', dir, '--hostile'], { stdio: 'pipe' });

    const hostileFiles = readdirSync(dir)
      .filter((name) => name.startsWith('hostile-'))
      .sort();
    expect(hostileFiles.length).toBeGreaterThanOrEqual(10);

    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (
        !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url) &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        externalRequests.push(url);
      }
    });

    await core.openApp(page);

    const expectedRefused = new Set([
      'hostile-truncated-header.mobi',
      'hostile-oob-offset.mobi',
      'hostile-too-many-records.mobi',
      'hostile-decomp-bomb.mobi',
      'hostile-huff-loop.mobi',
      'hostile-random.mobi',
      'hostile-oversized.mobi',
    ]);

    for (const name of hostileFiles) {
      const prevDoc = await shownDocId(page);
      await core.enqueueDialog('dialog.openFile', { paths: [path.join(dir, name)] });
      await clickImportMobi(page);
      const savePrompt = page.getByTestId('dialog-save-changes');
      if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
        await savePrompt.getByTestId('dialog-save-changes-button-no').click();
      }

      const summary = page.getByTestId('dialog-mobi-import-summary');
      const failed = page.getByTestId('dialog-mobi-import-failed');
      let outcome: 'refused' | 'imported' = 'imported';
      let dialogText = '';

      await expect
        .poll(
          async () => {
            if (await failed.isVisible()) {
              outcome = 'refused';
              dialogText = (await failed.textContent()) ?? '';
              await failed.getByRole('button').first().click();
              return true;
            }
            if (await summary.isVisible()) {
              outcome = 'imported';
              dialogText = (await summary.textContent()) ?? '';
              await summary.getByRole('button').first().click();
              return true;
            }
            const curDoc = await shownDocId(page);
            if (curDoc === prevDoc) return false;
            const status = (await page.getByTestId('status-message').textContent()) ?? '';
            if (status.includes('Imported from MOBI:')) {
              outcome = 'imported';
              dialogText = status;
              return true;
            }
            return false;
          },
          { timeout: 30_000, message: `Hostile fixture ${name} did not finish cleanly` },
        )
        .toBe(true);

      if (expectedRefused.has(name)) {
        expect(outcome, name).toBe('refused');
      }
      if (name === 'hostile-scripts-remote.mobi') {
        expect(outcome).toBe('imported');
        await expect(page.locator('.ProseMirror')).toContainText('Safe visible paragraph.');
        expect(dialogText).toMatch(/Scripts|Remote/i);
      }

      // Zero script execution!
      const xss = await page.evaluate(() => window.__MFBE_XSS__);
      expect(xss, `XSS triggered by ${name}`).toBeUndefined();
    }

    expect(externalRequests).toEqual([]);
  });
});
