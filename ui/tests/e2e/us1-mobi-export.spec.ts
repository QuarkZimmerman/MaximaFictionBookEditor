/**
 * Feature 018, User Story 1 (T017, SC-001): File > Export > Export as MOBI...
 * Exports any open FB2 book (valid or invalid) to MOBI 7 (.mobi), joint MOBI 7 + KF8 (.mobi),
 * or KF8 (.azw3), verified with Calibre's `ebook-meta` and `ebook-convert`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { scratchDir } from './fixtures/scratch';

interface SaveRequest {
  method: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  selects?: Array<{
    id: string;
    label: string;
    selected: string;
    choices: Array<{ value: string; label: string; extension?: string }>;
  }>;
  zipChoice?: { label: string; checked: boolean };
}

async function openBook(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book);
  return book;
}

async function lastSaveRequest(core: CoreHandle): Promise<SaveRequest> {
  const requests = await core.rpc<SaveRequest[]>('test.dialogRequests');
  return requests.filter((r) => r.method === 'dialog.saveFile').at(-1)!;
}

async function waitMobiExportEnds(page: Page, targetBasename: string): Promise<string> {
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          throw new Error(`MOBI export failed: ${await failed.textContent()}`);
        }
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button').first().click();
          return true;
        }
        text = (await page.getByTestId('status-message').textContent()) ?? '';
        return text.includes('Exported to') && text.includes(targetBasename);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return text;
}

function calibreMeta(filePath: string): string {
  return execFileSync('ebook-meta', [filePath], { encoding: 'utf8', timeout: 30_000 });
}

function calibreToTxt(filePath: string, outDir: string): string {
  const txtPath = path.join(outDir, `${path.basename(filePath)}.txt`);
  execFileSync('ebook-convert', [filePath, txtPath], {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: 'pipe',
  });
  return readFileSync(txtPath, 'utf8');
}

test.describe('US1 (feature 018) - MOBI / KF8 export', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('menu placement after Export as TXT and reference book export in MOBI 7, joint, and KF8', async ({
    core,
    page,
  }) => {
    const book = await openBook(core, page, 'reference-all-elements.fb2');
    const recentBefore = await core.rpc('doc.recent');
    const dir = scratchDir('mobi-us1-ref-');

    // Scenario 1: File > Export > Export as MOBI... directly after Export as TXT...
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    const exportItems = await page
      .locator('[data-testid^="menu-file-export-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const txtIdx = exportItems.indexOf('menu-file-export-exportTxt');
    const mobiIdx = exportItems.indexOf('menu-file-export-exportMobi');
    expect(txtIdx).toBeGreaterThanOrEqual(0);
    expect(mobiIdx).toBe(txtIdx + 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // 1) MOBI 7 (.mobi, default)
    const mobi7Path = path.join(dir, 'ref-mobi7.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: mobi7Path,
      zip: false,
      selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
    });
    expect(await clickExport(core, page, 'exportMobi')).toBe(false);
    await waitMobiExportEnds(page, 'ref-mobi7.mobi');

    const saveReq = await lastSaveRequest(core);
    expect(path.dirname(saveReq.defaultPath ?? '')).toBe(path.dirname(book));
    expect(saveReq.defaultPath).toMatch(/The Reference Book\.mobi$/);
    expect(saveReq.selects?.map((s) => s.id)).toEqual(['format', 'tocPlacement']);
    expect(saveReq.selects?.[0]?.selected).toBe('mobi7');
    expect(saveReq.selects?.[1]?.selected).toBe('afterTitle');
    expect(saveReq.zipChoice?.checked).toBe(false);

    expect(statSync(mobi7Path).size).toBeGreaterThan(1024);
    const meta7 = calibreMeta(mobi7Path);
    expect(meta7).toContain('The Reference Book');
    expect(meta7).toContain('Anna B. Example');
    const txt7 = calibreToTxt(mobi7Path, dir);
    expect(txt7).toContain('Chapter One');
    expect(txt7).toContain('The annotation of the reference book.');
    expect(txt7).toContain('Notes');

    // 2) Joint MOBI 7 + KF8 (.mobi) with inline TOC = none (native INDX still written)
    const jointPath = path.join(dir, 'ref-joint.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: jointPath,
      zip: false,
      selects: { format: 'joint', tocPlacement: 'none' },
    });
    expect(await clickExport(core, page, 'exportMobi')).toBe(false);
    await waitMobiExportEnds(page, 'ref-joint.mobi');

    const metaJoint = calibreMeta(jointPath);
    expect(metaJoint).toContain('The Reference Book');
    const txtJoint = calibreToTxt(jointPath, dir);
    expect(txtJoint).toContain('Chapter One');
    expect(txtJoint).not.toContain('Contents\n\nChapter One');

    // 3) KF8 (.azw3)
    const kf8Path = path.join(dir, 'ref-kf8.azw3');
    await core.enqueueDialog('dialog.saveFile', {
      path: kf8Path,
      zip: false,
      selects: { format: 'kf8', tocPlacement: 'end' },
    });
    expect(await clickExport(core, page, 'exportMobi')).toBe(false);
    await waitMobiExportEnds(page, 'ref-kf8.azw3');

    const metaKf8 = calibreMeta(kf8Path);
    expect(metaKf8).toContain('The Reference Book');
    const txtKf8 = calibreToTxt(kf8Path, dir);
    expect(txtKf8).toContain('Chapter One');
    expect(txtKf8).toContain('A caption under the picture');

    // Editor state & recent files untouched
    expect(await core.rpc('doc.recent')).toEqual(recentBefore);
  });

  test('fallback MobiExportOptions modal when platform dialog omits selects, and Save cancel writes nothing', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'modern-utf8.fb2');
    const dir = scratchDir('mobi-us1-fallback-');

    // Cancel Save dialog -> writes nothing, no modal shown
    await core.enqueueDialog('dialog.saveFile', {});
    await clickExport(core, page, 'exportMobi');
    await expect(page.getByTestId('dialog-mobi-export-options')).toBeHidden();

    // Dialog returns path only (no selects/zip) -> fallback modal asks
    const target = path.join(dir, 'fallback-choice.mobi');
    await core.enqueueDialog('dialog.saveFile', { path: target });
    await clickExport(core, page, 'exportMobi');
    const modal = page.getByTestId('dialog-mobi-export-options');
    await expect(modal).toBeVisible();
    await modal.getByTestId('dialog-mobi-export-format').selectOption('kf8');
    await modal.getByTestId('dialog-mobi-export-toc').selectOption('none');
    await modal.getByRole('button', { name: 'OK' }).click();

    const expectedAzw3 = path.join(dir, 'fallback-choice.azw3');
    await waitMobiExportEnds(page, 'fallback-choice.azw3');
    expect(existsSync(expectedAzw3)).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(calibreMeta(expectedAzw3)).toContain('Современная книга');

    // Fallback modal Cancel -> writes nothing
    const cancelledPath = path.join(dir, 'should-not-exist.mobi');
    await core.enqueueDialog('dialog.saveFile', { path: cancelledPath });
    await clickExport(core, page, 'exportMobi');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(existsSync(cancelledPath)).toBe(false);
  });

  test('invalid book asks confirmation, exports valid MOBI, and shows summary', async ({
    core,
    page,
  }) => {
    await openBook(core, page, 'invalid-for-export.fb2');
    const dir = scratchDir('mobi-us1-invalid-');
    const target = path.join(dir, 'invalid-for-export.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: target,
      zip: false,
      selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
    });
    expect(await clickExport(core, page, 'exportMobi')).toBe(true);
    const summaryText = await waitMobiExportEnds(page, 'invalid-for-export.mobi');
    expect(summaryText).toContain('#nowhere');
    expect(summaryText).toContain("book's title");
    expect(existsSync(target)).toBe(true);
    expect(calibreToTxt(target, dir).length).toBeGreaterThan(0);
  });

  test('book-language added words (Russian vs German fallback) and unsaved Source edits reflected', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us1-lang-');

    await openBook(core, page, 'russian-untitled-notes.fb2');
    const ruPath = path.join(dir, 'ru.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: ruPath,
      zip: false,
      selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitMobiExportEnds(page, 'ru.mobi');
    const ruTxt = calibreToTxt(ruPath, dir);
    expect(ruTxt).toContain('Примечания');

    await openBook(core, page, 'german-book.fb2');
    const dePath = path.join(dir, 'de.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: dePath,
      zip: false,
      selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitMobiExportEnds(page, 'de.mobi');
    const deTxt = calibreToTxt(dePath, dir);
    expect(deTxt).toContain('Notes');

    // Unsaved Source edit is applied and exported without writing back to disk
    await page.getByRole('button', { name: 'Source' }).click();
    const editor = page.getByTestId('source-editor');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Ein Buch');
    const titleLine = editor.locator('.cm-line', { hasText: 'Ein Buch' }).first();
    await titleLine.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    // Move before </book-title> (13 chars) and insert a marker directly in Source XML
    for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' UNSAVED_SOURCE_MARKER');
    await expect(editor).toContainText('Ein Buch UNSAVED_SOURCE_MARKER</book-title>');

    const editedPath = path.join(dir, 'de-edited.mobi');
    await core.enqueueDialog('dialog.saveFile', {
      path: editedPath,
      zip: false,
      selects: { format: 'mobi7', tocPlacement: 'none' },
    });
    await clickExport(core, page, 'exportMobi');
    await waitMobiExportEnds(page, 'de-edited.mobi');
    expect(calibreMeta(editedPath)).toContain('UNSAVED_SOURCE_MARKER');
    expect(calibreToTxt(editedPath, dir)).toContain('UNSAVED_SOURCE_MARKER');
  });
});
