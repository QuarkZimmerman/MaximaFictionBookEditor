/**
 * Feature 018, User Story 4 (T037, SC-005): Settings > Exports > MOBI defaults, Reset / Reset all,
 * shelf-only `seriesInTitle`, `openAt = mainText` (EXTH 116), `kf8PopupFootnotes = false` (plain
 * KF8 footnotes without epub:type), `zip = true`, and per-book Save dialog option stickiness vs
 * cancelled Save dialog vs switching books.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { scratchDir } from './fixtures/scratch';

interface SaveFileRequest {
  method: string;
  defaultPath?: string;
  zipChoice?: { checked: boolean };
  selects?: Array<{ id: string; selected?: string }>;
}

async function openBook(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const savePrompt = page.getByTestId('dialog-save-changes');
  if (await savePrompt.isVisible({ timeout: 300 }).catch(() => false)) {
    await savePrompt.getByTestId('dialog-save-changes-button-no').click();
  }
  await waitForBook(page, book);
  return book;
}

async function waitExportDone(page: Page): Promise<void> {
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) throw new Error(`Export failed: ${await failed.textContent()}`);
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

async function lastSaveRequest(core: CoreHandle): Promise<SaveFileRequest> {
  const reqs = await core.rpc<SaveFileRequest[]>('test.dialogRequests');
  return reqs.filter((r) => r.method === 'dialog.saveFile').at(-1)!;
}

/** Reads EXTH 116 (start_offset) directly from Record 0 of a MOBI/KF8 binary. */
function readExth116(filePath: string): number | null {
  const buf = readFileSync(filePath);
  const numRecords = buf.readUInt16BE(76);
  if (numRecords < 1) return null;
  const rec0Off = buf.readUInt32BE(78);
  const rec1Off = numRecords > 1 ? buf.readUInt32BE(86) : buf.length;
  const rec0 = buf.subarray(rec0Off, rec1Off);
  const exthIdx = rec0.indexOf(Buffer.from('EXTH'));
  if (exthIdx < 0) return null;
  const count = rec0.readUInt32BE(exthIdx + 8);
  let p = exthIdx + 12;
  for (let i = 0; i < count && p + 8 <= rec0.length; i++) {
    const type = rec0.readUInt32BE(p);
    const len = rec0.readUInt32BE(p + 4);
    if (len < 8 || p + len > rec0.length) break;
    if (type === 116 && len === 12) {
      return rec0.readUInt32BE(p + 8);
    }
    p += len;
  }
  return null;
}

async function openMobiSettings(page: Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible();
  await page.getByTestId('settings-tab-exports').click();
  await page.getByTestId('settings-exports-format').selectOption('mobi');
  await expect(page.getByTestId('settings-page-mobi')).toBeVisible();
}

test.describe('US4 (feature 018) - MOBI settings defaults & per-book dialog stickiness', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('Settings > Exports > MOBI configures all six defaults, applies seriesInTitle / openAt / kf8PopupFootnotes / zip, and keeps per-book Save choices', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us4-settings-');

    // 1. Open Settings > Exports > MOBI, test Reset & Reset all, then save custom defaults
    await openMobiSettings(page);
    await page.getByTestId('settings-mobi-format').selectOption('joint');
    await page.getByTestId('settings-mobi-tocPlacement').selectOption('none');
    await page.getByTestId('settings-mobi-seriesInTitle').selectOption('seriesAndNumber');
    await page.getByTestId('settings-mobi-openAt').selectOption('mainText');
    await page.getByTestId('settings-mobi-kf8PopupFootnotes').uncheck();
    await page.getByTestId('settings-mobi-zip').check();

    // Test individual reset + reset all
    await page.getByTestId('settings-mobi-reset-format').click();
    await expect(page.getByTestId('settings-mobi-format')).toHaveValue('mobi7');
    await page.getByTestId('settings-mobi-reset-all').click();
    await expect(page.getByTestId('settings-mobi-zip')).not.toBeChecked();
    await expect(page.getByTestId('settings-mobi-kf8PopupFootnotes')).toBeChecked();

    // Configure non-default values and click OK
    await page.getByTestId('settings-mobi-format').selectOption('joint');
    await page.getByTestId('settings-mobi-tocPlacement').selectOption('none');
    await page.getByTestId('settings-mobi-seriesInTitle').selectOption('seriesAndNumber');
    await page.getByTestId('settings-mobi-openAt').selectOption('mainText');
    await page.getByTestId('settings-mobi-kf8PopupFootnotes').uncheck();
    await page.getByTestId('settings-mobi-zip').check();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();

    // 2. Open reference book (has <sequence name="The Series" number="3"/>)
    await openBook(core, page, 'reference-all-elements.fb2');

    // First export: verify Save dialog proposes Settings defaults (joint, none, zip=true, .zip)
    const zipTarget = path.join(dir, 'settings-default.zip');
    await core.enqueueDialog('dialog.saveFile', {
      path: zipTarget,
      zip: true,
      selects: { format: 'joint', tocPlacement: 'none' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitExportDone(page);

    const req1 = await lastSaveRequest(core);
    expect(req1.defaultPath).toMatch(/\.zip$/);
    expect(req1.zipChoice?.checked).toBe(true);
    expect(req1.selects?.find((s) => s.id === 'format')?.selected).toBe('joint');
    expect(req1.selects?.find((s) => s.id === 'tocPlacement')?.selected).toBe('none');
    expect(existsSync(zipTarget)).toBe(true);

    // Extract .mobi from ZIP and verify shelf title prefix via Calibre ebook-meta + EXTH 116 > 0
    const extractedMobi = path.join(dir, 'extracted.mobi');
    execFileSync(
      'python3',
      [
        '-c',
        `import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    names = z.namelist()
    assert any(n.endswith('.mobi') for n in names), names
    assert any(n.endswith('.fbd') for n in names), names
    m = [n for n in names if n.endswith('.mobi')][0]
    open(sys.argv[2], 'wb').write(z.read(m))`,
        zipTarget,
        extractedMobi,
      ],
      { stdio: 'pipe' },
    );
    const metaOut = execFileSync('ebook-meta', [extractedMobi], { encoding: 'utf8' });
    expect(metaOut).toContain('The Series #3 — The Reference Book');
    expect(readExth116(extractedMobi)).toBeGreaterThan(0);

    // 3. Switch `seriesInTitle` to `numberBefore`, export bare KF8 `.azw3` overriding Save dialog
    await openMobiSettings(page);
    await page.getByTestId('settings-mobi-seriesInTitle').selectOption('numberBefore');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();

    const kf8Target = path.join(dir, 'plain-footnotes.azw3');
    await core.enqueueDialog('dialog.saveFile', {
      path: kf8Target,
      zip: false,
      selects: { format: 'kf8', tocPlacement: 'end' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitExportDone(page);

    const kf8Meta = execFileSync('ebook-meta', [kf8Target], { encoding: 'utf8' });
    expect(kf8Meta).toContain('3_The Reference Book');
    expect(readExth116(kf8Target)).toBeGreaterThan(0);

    // Verify kf8PopupFootnotes = false emitted plain footnotes (zero epub:type="noteref"/"footnote")
    execFileSync('ebook-convert', [kf8Target, path.join(dir, 'unpacked.htmlz')], {
      stdio: 'pipe',
      timeout: 60_000,
    });
    const htmlzText = execFileSync(
      'python3',
      [
        '-c',
        `import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    print(z.read('index.html').decode('utf-8', 'replace'))`,
        path.join(dir, 'unpacked.htmlz'),
      ],
      { encoding: 'utf8' },
    );
    expect(htmlzText).not.toContain('epub:type="noteref"');
    expect(htmlzText).not.toContain('epub:type="footnote"');

    // 4. Per-book stickiness: next export on SAME book proposes kept choices (kf8, end, zip=false)
    //    AND cancelling the Save dialog leaves those kept choices intact!
    await core.enqueueDialog('dialog.saveFile', {}); // user cancels Save dialog
    await clickExport(core, page, 'exportMobi');
    await expect
      .poll(async () => (await lastSaveRequest(core)).selects?.find((s) => s.id === 'format')?.selected)
      .toBe('kf8');
    const cancelledReq = await lastSaveRequest(core);
    expect(cancelledReq.defaultPath).toMatch(/\.azw3$/);
    expect(cancelledReq.zipChoice?.checked).toBe(false);
    expect(cancelledReq.selects?.find((s) => s.id === 'tocPlacement')?.selected).toBe('end');

    // 5. Switch to another book: Save dialog returns to live Settings defaults (joint, none, zip=true)
    await openBook(core, page, 'modern-utf8.fb2');
    await core.enqueueDialog('dialog.saveFile', {}); // cancel so we just inspect the proposed options
    await clickExport(core, page, 'exportMobi');
    await expect
      .poll(async () => (await lastSaveRequest(core)).selects?.find((s) => s.id === 'format')?.selected)
      .toBe('joint');
    const otherBookReq = await lastSaveRequest(core);
    expect(otherBookReq.defaultPath).toMatch(/\.zip$/);
    expect(otherBookReq.zipChoice?.checked).toBe(true);
    expect(otherBookReq.selects?.find((s) => s.id === 'tocPlacement')?.selected).toBe('none');

    // 6. Re-importing the shelf-prefixed bare .mobi restores the ORIGINAL FB2 title (no prefix!)
    await core.enqueueDialog('dialog.openFile', { paths: [extractedMobi] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importMobi').click();
    const summary = page.getByTestId('dialog-mobi-import-summary');
    await expect
      .poll(
        async () => {
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
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();
  });
});
