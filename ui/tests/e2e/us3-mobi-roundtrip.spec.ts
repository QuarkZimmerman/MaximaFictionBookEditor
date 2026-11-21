/**
 * Feature 018, User Story 3 (T034, SC-002, FR-041): Reversible round-trip across MOBI 7, joint
 * MOBI 7 + KF8, and KF8 (.azw3), zero garbage in Calibre, partial external-edit fallback
 * (metadata-only patch & HTML-only patch), and invalid FB2 round-trip.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { clickExport } from './fixtures/exportCheck';
import { hasCalibre, inspectMobiBinary, mobiPlainText } from './fixtures/mobi';
import { scratchDir } from './fixtures/scratch';

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

async function exportMobiFormat(
  core: CoreHandle,
  page: Page,
  target: string,
  format: 'mobi7' | 'joint' | 'kf8',
): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    zip: false,
    selects: { format, tocPlacement: 'afterTitle' },
  });
  await clickExport(core, page, 'exportMobi');
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  const base = path.basename(target);
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        const msg = (await page.getByTestId('status-message').textContent()) ?? '';
        return msg.includes('Exported to') && msg.includes(base);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function importMobi(core: CoreHandle, page: Page, target: string): Promise<string> {
  await core.enqueueDialog('dialog.openFile', { paths: [target] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMobi').click();
  const savePrompt = page.getByTestId('dialog-save-changes');
  if (await savePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
    await savePrompt.getByTestId('dialog-save-changes-button-no').click();
  }
  const summary = page.getByTestId('dialog-mobi-import-summary');
  const failed = page.getByTestId('dialog-mobi-import-failed');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Import failed: ${await failed.textContent()}`);
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

test.describe('US3 (feature 018) - Reversible MFBE round-trip & partial external-edit fallback', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('exports and round-trips reference-all-elements.fb2 across MOBI 7, joint, and KF8 with zero Calibre garbage', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us3-rt-');

    for (const [fmt, ext] of [
      ['mobi7', 'mobi'],
      ['joint', 'mobi'],
      ['kf8', 'azw3'],
    ] as const) {
      await openBook(core, page, 'reference-all-elements.fb2');
      const outPath = path.join(dir, `ref-${fmt}.${ext}`);
      await exportMobiFormat(core, page, outPath, fmt);

      // Verify no MFBE JSON / binary garbage appears in visible text output (Calibre or decompressed HTML)
      const calTxt = mobiPlainText(outPath, dir);
      expect(calTxt).not.toContain('htmlSha256');
      expect(calTxt).not.toContain('MFBE');

      // Re-import into editor
      await importMobi(core, page, outPath);

      // Check restored description & body fidelity via Source view / Description view / validation
      await page.getByRole('button', { name: 'Description' }).click();
      await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();
      await page.getByRole('button', { name: 'Body' }).click();
      await expect(page.locator('.ProseMirror')).toContainText('Chapter One');

      // Validate: restored book must be 100% valid FB2 2.1
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
        throw new Error(`${fmt} round-trip validation failed (${valText}): ${details.join(' | ')}`);
      }
    }

    // Export modern-utf8.fb2 (has leading body cover duplicate + annotation + version/history) as
    // default joint .mobi: verify single cover, dedicated annotation page, closing history colophon
    // page, and clean round-trip of history + valid FB2.
    await openBook(core, page, 'modern-utf8.fb2');
    const modernJoint = path.join(dir, 'modern-joint.mobi');
    await exportMobiFormat(core, page, modernJoint, 'joint');
    const modernInspected = inspectMobiBinary(modernJoint);
    expect(modernInspected.htmlText).not.toContain('id="fb2-cover"');
    expect(modernInspected.htmlText).toContain('id="fb2-annotation"');
    expect(modernInspected.htmlText).toContain('id="fb2-history"');
    expect(modernInspected.htmlText).toContain('Версия 2.1');
    expect(modernInspected.htmlText).toContain('v2.1 — вычитка');

    await importMobi(core, page, modernJoint);
    const restoredModernXml = await bookXml(core, page);
    expect(restoredModernXml).toContain('<history>');
    expect(restoredModernXml).toContain('v2.1 — вычитка');
    expect(restoredModernXml).toContain('<annotation>');
    expect(restoredModernXml).toContain('Второй абзац аннотации.');
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('status-message')).toContainText(/No errors|valid/i, {
      timeout: 15_000,
    });
  });

  test('partial external-edit fallback preserves external metadata edit while keeping MFBE body, and invalid FB2 round-trips cleanly', async ({
    core,
    page,
  }) => {
    const dir = scratchDir('mobi-us3-ext-');
    await openBook(core, page, 'reference-all-elements.fb2');
    const patchedPath = path.join(dir, 'externally-edited.mobi');
    await exportMobiFormat(core, page, patchedPath, 'mobi7');

    // Patch EXTH metadata externally with Calibre `ebook-meta` when Calibre is installed
    if (hasCalibre()) {
      execFileSync('ebook-meta', [patchedPath, '--title', 'Externally Retitled Book'], {
        stdio: 'pipe',
        timeout: 30_000,
      });
      await importMobi(core, page, patchedPath);
      await page.getByRole('button', { name: 'Description' }).click();
      await expect(page.locator('input[value="Externally Retitled Book"]').first()).toBeVisible();
    }

    // Direct binary patch of EXTH 503 inside our exported .mobi (keeping EXTH 59901 intact!)
    // guarantees we specifically exercise `mfbeStatus == "externallyModified"` with `mfbeHtmlMatches=true, mfbeMetaMatches=false`!
    const directPath = path.join(dir, 'direct-meta-patch.mobi');
    await openBook(core, page, 'reference-all-elements.fb2');
    await exportMobiFormat(core, page, directPath, 'mobi7');
    const buf = Buffer.from(readFileSync(directPath));
    const needle = Buffer.from('The Reference Book', 'utf8');
    const replacement = Buffer.from('Patched Title Book', 'utf8');
    expect(needle.length).toBe(replacement.length);
    // Replace the FIRST occurrence (inside Record 0 EXTH 503 / full_name, leaving compressed text untouched!)
    const pos = buf.indexOf(needle);
    expect(pos).toBeGreaterThan(0);
    replacement.copy(buf, pos);
    const pos2 = buf.indexOf(needle, pos + needle.length);
    if (pos2 > 0 && pos2 < 65536) replacement.copy(buf, pos2);
    writeFileSync(directPath, buf);

    const directMsg = await importMobi(core, page, directPath);
    expect(directMsg).toContain('modified outside the editor');
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(
      page.locator('input[value="The Series #3 \u2014 Patched Title Book"]').first(),
    ).toBeVisible();

    // Direct binary patch of HTML text record ONLY (leaving Record 0 EXTH & EXTH 59901 intact!):
    // exercises `mfbeStatus == "externallyModified"` with `mfbeHtmlMatches=false, mfbeMetaMatches=true`
    // -> edited body text is kept (parsed as foreign) while MFBE description is preserved.
    const htmlPatchPath = path.join(dir, 'direct-html-patch.mobi');
    await openBook(core, page, 'reference-all-elements.fb2');
    await exportMobiFormat(core, page, htmlPatchPath, 'mobi7');
    const htmlBuf = Buffer.from(readFileSync(htmlPatchPath));
    // Note: PalmDOC space-compresses " J" into a single byte, while "anuary" (from "1 January 2026")
    // has no prior 3-byte repeat so it sits verbatim as literal ASCII bytes in the text record!
    const htmlNeedle = Buffer.from('anuary', 'utf8');
    const htmlReplacement = Buffer.from('ZZZary', 'utf8');
    expect(htmlNeedle.length).toBe(htmlReplacement.length);
    const htmlPos = htmlBuf.indexOf(htmlNeedle);
    expect(htmlPos).toBeGreaterThan(0);
    htmlReplacement.copy(htmlBuf, htmlPos);
    writeFileSync(htmlPatchPath, htmlBuf);

    const htmlPatchMsg = await importMobi(core, page, htmlPatchPath);
    expect(htmlPatchMsg).toContain('modified outside the editor');
    await page.getByRole('button', { name: 'Body' }).click();
    await expect(page.locator('.ProseMirror')).toContainText('1 JZZZary 2026');
    await page.getByRole('button', { name: 'Description' }).click();
    await expect(page.locator('input[value="The Reference Book"]').first()).toBeVisible();
    await expect(page.locator('input[value="Example Press"]').first()).toBeVisible();

    // Round-trip an invalid FB2 -> re-imported book opens cleanly with valid FB2 bodies
    await openBook(core, page, 'invalid-for-export.fb2');
    const invPath = path.join(dir, 'invalid-rt.mobi');
    await exportMobiFormat(core, page, invPath, 'mobi7');
    await importMobi(core, page, invPath);
    await page.getByRole('button', { name: 'Body' }).click();
    await expect(page.locator('.ProseMirror').first()).toBeVisible();
  });
});
