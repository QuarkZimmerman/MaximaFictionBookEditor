/**
 * Feature 018, User Story 2 (T026, SC-003, SC-004, SC-006): File > Import > MOBI File...
 * Foreign MOBI 7 (uncompressed/PalmDOC/HuffCDIC/Windows-1252), joint (+ damaged-KF8 fallback),
 * KF8 (.azw3 with CSS/SVG/MathML), PalmDOC (.prc), converter marks, DRM/KFX/FB2 refusals,
 * File > Open refusals, JPEG/PNG-only binaries, and fire-and-forget Save As proposal.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, type CoreHandle } from './fixtures/core';
import { findPython, hasCalibre } from './fixtures/mobi';
import { scratchDir } from './fixtures/scratch';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_SCRIPT = path.join(REPO_ROOT, 'tests/fixtures/mobi/make-fixtures.py');

let fixturesDir = '';

async function clickImportMobi(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMobi').click();
}

async function waitImportComplete(page: Page): Promise<string> {
  const summary = page.getByTestId('dialog-mobi-import-summary');
  const failed = page.getByTestId('dialog-mobi-import-failed');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          throw new Error(`Unexpected MOBI import failure: ${await failed.textContent()}`);
        }
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button').first().click();
          return true;
        }
        text = (await page.getByTestId('status-message').textContent()) ?? '';
        return text.includes('Imported from MOBI:');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return text;
}

async function importMobiFile(core: CoreHandle, page: Page, filePath: string): Promise<string> {
  await core.enqueueDialog('dialog.openFile', { paths: [filePath] });
  await clickImportMobi(page);
  return waitImportComplete(page);
}

test.describe('US2 (feature 018) - Foreign MOBI / KF8 / PalmDOC import & refusals', () => {
  test.beforeAll(() => {
    fixturesDir = scratchDir('mobi-us2-fixtures-');
    execFileSync(findPython(), [FIXTURE_SCRIPT, '--out', fixturesDir, '--no-oversized'], {
      stdio: 'pipe',
    });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('menu placement after TXT File, unsaved changes prompt, and fire-and-forget Save As proposal', async ({
    core,
    page,
  }) => {
    // 1. Menu placement: File > Import > MOBI File... right after TXT File...
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    const importItems = await page
      .locator('[data-testid^="menu-file-import-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const txtIdx = importItems.indexOf('menu-file-import-importTxt');
    const mobiIdx = importItems.indexOf('menu-file-import-importMobi');
    expect(txtIdx).toBeGreaterThanOrEqual(0);
    expect(mobiIdx).toBe(txtIdx + 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // 2. Make an unsaved edit -> Cancel on save-changes leaves book untouched, No proceeds
    const firstPara = page.locator('.ProseMirror p').first();
    await firstPara.click();
    await page.keyboard.type('Unsaved draft text');

    await clickImportMobi(page);
    const savePrompt = page.getByTestId('dialog-save-changes');
    await expect(savePrompt).toBeVisible();
    await savePrompt.getByTestId('dialog-save-changes-button-cancel').click();
    await expect(page.locator('.ProseMirror')).toContainText('Unsaved draft text');

    await core.enqueueDialog('dialog.openFile', {
      paths: [path.join(fixturesDir, 'mobi7-uncompressed.mobi')],
    });
    await clickImportMobi(page);
    await expect(savePrompt).toBeVisible();
    await savePrompt.getByTestId('dialog-save-changes-button-no').click();
    await waitImportComplete(page);

    await expect(page.locator('.ProseMirror')).toContainText('Chapter One');

    // 3. First Save As proposes description-derived filename (Author - Title.fb2), fire-and-forget
    await core.enqueueDialog('dialog.saveFile', {});
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-saveAs').click();
    await expect
      .poll(async () => {
        const reqs =
          await core.rpc<Array<{ method: string; defaultPath?: string }>>('test.dialogRequests');
        return reqs.filter((r) => r.method === 'dialog.saveFile').at(-1)?.defaultPath ?? '';
      })
      .toContain('Uncompressed Sample.fb2');
  });

  test('imports all foreign formats (MOBI 7, HuffCDIC, cp1252, joint + fallback, KF8, PalmDOC, converters) as valid FB2', async ({
    core,
    page,
  }) => {
    const cases: Array<{ file: string; expectText: string; expectSummary?: string }> = [
      { file: 'mobi7-uncompressed.mobi', expectText: 'Chapter One' },
      { file: 'mobi7-palmdoc.mobi', expectText: 'quick brown fox' },
      { file: 'mobi7-huffcdic.mobi', expectText: 'Chapter' },
      { file: 'mobi7-cp1252.mobi', expectText: 'Café' },
      { file: 'joint-valid.mobi', expectText: 'KF8' },
      {
        file: 'joint-damaged-kf8.mobi',
        expectText: 'MOBI 7',
        expectSummary: 'KF8 part of the joint file was damaged',
      },
      { file: 'kf8-rich.azw3', expectText: 'KF8' },
      { file: 'palmdoc-plain.prc', expectText: 'PalmDOC' },
      { file: 'converter-calibre.mobi', expectText: 'Calibre' },
      { file: 'converter-fb2converter.mobi', expectText: 'FB2Converter Title' },
      { file: 'converter-maxlibmobi.mobi', expectText: 'maxlibmobi' },
    ];

    for (const tc of cases) {
      // Discard previous imported unsaved book when prompted
      await core.enqueueDialog('dialog.openFile', { paths: [path.join(fixturesDir, tc.file)] });
      await clickImportMobi(page);
      const savePrompt = page.getByTestId('dialog-save-changes');
      if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
        await savePrompt.getByTestId('dialog-save-changes-button-no').click();
      }
      const msg = await waitImportComplete(page);
      if (tc.expectSummary) {
        expect(msg).toContain(tc.expectSummary);
      }
      await expect(page.locator('.ProseMirror')).toContainText(tc.expectText);

      // Verify validation pane reports zero errors (valid FB2 2.1!)
      await page.getByRole('button', { name: 'Validate' }).click();
      await expect(page.getByTestId('status-message')).toContainText(
        /No errors|error found|errors found|valid/i,
        {
          timeout: 15_000,
        },
      );
      const valText = (await page.getByTestId('status-message').textContent()) ?? '';
      if (!/No errors|valid/i.test(valText)) {
        await page.getByTestId('status-validity').click();
        const details = await page
          .locator('.mfbe-validation-panel, [data-testid*="validation"]')
          .allTextContents();
        throw new Error(`${tc.file} validation failed (${valText}): ${details.join(' | ')}`);
      }
    }
  });

  test('refuses encrypted/DRM, KFX, FB2 via All files, and File > Open on MOBI/AZW3/PRC', async ({
    core,
    page,
  }) => {
    const refusals: Array<{ file: string; expectMsg: RegExp }> = [
      { file: 'drm-encrypted.mobi', expectMsg: /encrypted|DRM/i },
      { file: 'drm-encrypted.azw3', expectMsg: /encrypted|DRM/i },
      { file: 'kfx-book.kfx', expectMsg: /KFX/i },
      { file: 'kfx-renamed.mobi', expectMsg: /KFX/i },
      { file: 'fb2-renamed.mobi', expectMsg: /FictionBook/i },
    ];

    for (const r of refusals) {
      await core.enqueueDialog('dialog.openFile', { paths: [path.join(fixturesDir, r.file)] });
      await clickImportMobi(page);
      const failed = page.getByTestId('dialog-mobi-import-failed');
      await expect(failed).toBeVisible({ timeout: 15_000 });
      await expect(failed).toContainText(r.expectMsg);
      await failed.getByRole('button').first().click();
      await expect(failed).toBeHidden();
    }

    // File > Open refuses MOBI, AZW3, PRC pointing to File > Import > MOBI File...
    for (const file of ['mobi7-uncompressed.mobi', 'kf8-rich.azw3', 'palmdoc-plain.prc']) {
      await core.enqueueDialog('dialog.openFile', { paths: [path.join(fixturesDir, file)] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      const refused = page.getByTestId('dialog-mobi-refused');
      await expect(refused).toBeVisible({ timeout: 15_000 });
      await expect(refused).toContainText('File > Import > MOBI File');
      await refused.getByRole('button').first().click();
      await expect(refused).toBeHidden();
    }

    // Confirm real Calibre-generated MOBI imports cleanly when Calibre is installed on the runner
    if (hasCalibre()) {
      const calDir = scratchDir('mobi-us2-calibre-');
      const calMobi = path.join(calDir, 'calibre-from-fb2.mobi');
      execFileSync('ebook-convert', [fixtureBook('modern-utf8.fb2'), calMobi], {
        stdio: 'pipe',
        timeout: 60_000,
      });
      await importMobiFile(core, page, calMobi);
      await expect(page.locator('.ProseMirror')).toContainText('Современная книга');
      await expect(page).toHaveTitle(/^Untitled\* - /);
    }
  });
});
