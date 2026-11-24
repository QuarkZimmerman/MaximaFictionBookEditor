/**
 * Feature 019 (T047, T063; US3): Error resilience, skip vs atomic overwrite, self-overwrite and
 * open-book refusal, uncluttered on-screen Failed/Skipped report with filters, Save report...
 * writing full UTF-8 report including Warnings on converted files (and write-failure recovery),
 * plus session-only memory restoring options while always resetting Overwrite to unchecked.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, fixtureBook, test, waitForBook } from './fixtures/core';
import {
  makeTempDir,
  openBatchDialog,
  repoFixture,
  resetBatchSettings,
  writeStoredZip,
} from './fixtures/batchHelpers';

/**
 * Takes a real MOBI file and flips the PalmDOC/MOBI header encryption field (offset +12 in
 * record 0) to 2 (Mobipocket encryption) so core's MOBI reader refuses it as encrypted/DRM.
 */
function makeEncryptedMobiFrom(mobiBytes: Buffer): Buffer {
  const buf = Buffer.from(mobiBytes);
  const record0Offset = buf.readUInt32BE(78);
  buf.writeUInt16BE(2, record0Offset + 12);
  return buf;
}

test.describe('US3: Error resilience, Overwrite/Skip, Report & Save report @platform', () => {
  test('continues past bad/encrypted files, skips or overwrites atomically, filters on-screen report, saves full UTF-8 report with warnings, and persists settings on reopen', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(180_000);
    resetBatchSettings(core.dataDir);
    await core.openApp(page);

    const work = makeTempDir('mfbe-us3-errors');
    try {
      // Seed one real .mobi so we can derive a genuine encrypted MOBI without external tools.
      const seedSrc = path.join(work, 'seed-src');
      const seedOut = path.join(work, 'seed-out');
      mkdirSync(seedSrc, { recursive: true });
      copyFileSync(fixtureBook('modern-utf8.fb2'), path.join(seedSrc, 'base.fb2'));
      await core.rpc('settings.set', { patch: { mobi: { format: 'joint', zip: false } } });

      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').click();
      await page.getByTestId('batch-export-format').selectOption('mobi');
      await page.getByTestId('batch-source-input').fill(seedSrc);
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-destination-input').fill(seedOut);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      const baseMobiBytes = readFileSync(path.join(seedOut, 'base.mobi'));

      // Assemble mixed source tree: valid, valid-with-warnings, existing target, encrypted MOBI,
      // password-protected PDF, corrupt EPUB, and damaged ZIP.
      const srcDir = path.join(work, 'mixed-src');
      const dstDir = path.join(work, 'mixed-dst');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(dstDir, { recursive: true });

      const secretBodyPhrase = 'UNIQUE-PRIVATE-PROSE-DO-NOT-LEAK-IN-REPORT-918273';
      writeFileSync(
        path.join(srcDir, '01-valid.md'),
        `# Clean Valid Book\n\n${secretBodyPhrase}\n`,
        'utf8',
      );
      writeFileSync(
        path.join(srcDir, '02-warnings.md'),
        `# Book With Warnings\n\n![Missing](does-not-exist-local.png)\n\n![Remote](https://example.invalid/remote.png)\n\n${secretBodyPhrase}\n`,
        'utf8',
      );
      writeFileSync(
        path.join(srcDir, '03-existing.md'),
        '# Overwrite Candidate\n\nFreshly converted body text.\n',
        'utf8',
      );
      const existingOutPath = path.join(dstDir, '03-existing.fb2');
      const sentinelText = 'SENTINEL-EXISTING-CONTENT-DO-NOT-TOUCH';
      writeFileSync(existingOutPath, sentinelText, 'utf8');

      copyFileSync(
        repoFixture('pdf', 'import', 'password-user.pdf'),
        path.join(srcDir, '04-locked.pdf'),
      );
      writeFileSync(path.join(srcDir, '05-drm.mobi'), makeEncryptedMobiFrom(baseMobiBytes));
      copyFileSync(repoFixture('epub', 'not-zip.epub'), path.join(srcDir, '06-corrupt.epub'));
      writeFileSync(path.join(srcDir, '07-damaged.zip'), Buffer.from('NOT-A-VALID-ZIP-ARCHIVE'));

      // Run 1: Import -> FB2 with Overwrite existing files UNCHECKED.
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-dir-import').click();
      await page.getByTestId('batch-import-all').check();
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-destination-input').fill(dstDir);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-overwrite').uncheck();
      await page.getByTestId('dialog-batch-converter-button-start').click();

      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('batch-count-total')).toContainText('7');
      await expect(page.getByTestId('batch-count-converted')).toContainText('2');
      await expect(page.getByTestId('batch-count-skipped')).toContainText('1');
      await expect(page.getByTestId('batch-count-failed')).toContainText('4');

      // Valid and warning books succeeded; pre-existing target remained completely unmodified.
      expect(existsSync(path.join(dstDir, '01-valid.fb2'))).toBe(true);
      expect(existsSync(path.join(dstDir, '02-warnings.fb2'))).toBe(true);
      expect(readFileSync(existingOutPath, 'utf8')).toBe(sentinelText);

      // On-screen report lists Failed (4) + Skipped (1) ONLY — never clutters with 02-warnings.md!
      const issuesList = page.getByTestId('batch-issues-list');
      await expect(issuesList.locator('[data-testid="batch-issue-failed"]')).toHaveCount(4);
      await expect(issuesList.locator('[data-testid="batch-issue-skipped"]')).toHaveCount(1);
      await expect(issuesList).not.toContainText('02-warnings.md');

      // Filter buttons toggle Failed / Skipped / All cleanly.
      await page.getByTestId('batch-filter-failed').click();
      await expect(issuesList.locator('[data-testid="batch-issue-failed"]')).toHaveCount(4);
      await expect(issuesList.locator('[data-testid="batch-issue-skipped"]')).toHaveCount(0);

      await page.getByTestId('batch-filter-skipped').click();
      await expect(issuesList.locator('[data-testid="batch-issue-failed"]')).toHaveCount(0);
      await expect(issuesList.locator('[data-testid="batch-issue-skipped"]')).toHaveCount(1);

      await page.getByTestId('batch-filter-all').click();
      await expect(issuesList.locator('li')).toHaveCount(5);

      // Save report... write-error recovery: choosing an existing directory path fails cleanly
      // and keeps the on-screen report intact so the user can retry another path.
      const unwritableDirTarget = path.join(work, 'cannot-overwrite-dir');
      mkdirSync(unwritableDirTarget, { recursive: true });
      await core.enqueueDialog('dialog.saveFile', { path: unwritableDirTarget });
      await page.getByTestId('dialog-batch-converter-button-save-report').click();
      await expect(page.getByTestId('batch-report-save-notice')).toBeVisible();
      await expect(page.getByTestId('batch-report-save-notice')).toHaveAttribute('role', 'alert');
      // On-screen report still visible with all 5 issues intact!
      await expect(issuesList.locator('li')).toHaveCount(5);

      // Save report... success: writes full UTF-8 plain-text report including Warnings on converted files.
      const reportPath = path.join(work, 'batch-report.txt');
      await core.enqueueDialog('dialog.saveFile', { path: reportPath });
      await page.getByTestId('dialog-batch-converter-button-save-report').click();
      await expect(page.getByTestId('batch-report-save-notice')).toHaveAttribute('role', 'status');
      expect(existsSync(reportPath)).toBe(true);

      const reportText = readFileSync(reportPath, 'utf8');
      expect(reportText).toContain('Failed (4)');
      expect(reportText).toContain('04-locked.pdf');
      expect(reportText).toContain('05-drm.mobi');
      expect(reportText).toContain('06-corrupt.epub');
      expect(reportText).toContain('07-damaged.zip');
      expect(reportText).toContain('Skipped (1)');
      expect(reportText).toContain('03-existing.md');
      expect(reportText).toContain('Warnings on converted files (1)');
      expect(reportText).toContain('02-warnings.md');
      expect(reportText).toContain('does-not-exist-local.png');
      // Must never leak private book prose into the saved report!
      expect(reportText).not.toContain(secretBodyPhrase);

      // Run 2: Enable Overwrite existing files -> existing file is atomically replaced.
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-overwrite').check();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      await expect(page.getByTestId('batch-count-skipped')).toContainText('0');
      await expect(page.getByTestId('batch-count-failed')).toContainText('4');

      const overwrittenContent = readFileSync(existingOutPath, 'utf8');
      expect(overwrittenContent).not.toBe(sentinelText);
      expect(overwrittenContent).toContain('Freshly converted body text.');

      // Close and reopen dialog: persistent batch-converter.json restores direction, paths, and Overwrite!
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();
      await openBatchDialog(page);
      await expect(page.getByTestId('batch-dir-import')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('batch-source-input')).toHaveValue(srcDir);
      await expect(page.getByTestId('batch-destination-input')).toHaveValue(dstDir);
      await expect(page.getByTestId('batch-overwrite')).toBeChecked();
      await page.getByTestId('dialog-batch-converter-button-close').click();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test('Fix broken checkbox repairs malformed FB2 XML in memory when checked and skips broken XML when unchecked without popups', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(120_000);
    resetBatchSettings(core.dataDir);
    await core.openApp(page);

    const work = makeTempDir('mfbe-us3-fix-broken');
    try {
      const srcDir = path.join(work, 'src');
      const outFixed = path.join(work, 'out-fixed');
      const outSkipped = path.join(work, 'out-skipped');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(outFixed, { recursive: true });
      mkdirSync(outSkipped, { recursive: true });

      copyFileSync(fixtureBook('modern-utf8.fb2'), path.join(srcDir, '01-valid.fb2'));
      copyFileSync(fixtureBook('malformed.fb2'), path.join(srcDir, '02-malformed.fb2'));
      const crossedXml =
        '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">\n' +
        '<description><title-info><genre>prose</genre><author><last-name>Tester</last-name></author>' +
        '<book-title>Crossed Tags</book-title><lang>en</lang></title-info></description>\n' +
        '<body><section><p>Start <emphasis>unclosed emphasis</p>' +
        '<p>Preserved second paragraph</p></section></body>\n' +
        '</FictionBook>\n';
      const crossedPath = path.join(srcDir, '03-crossed.fb2');
      writeFileSync(crossedPath, crossedXml, 'utf8');
      writeFileSync(path.join(srcDir, '04-empty.fb2'), Buffer.alloc(0));

      const malformedOrig = readFileSync(path.join(srcDir, '02-malformed.fb2'));
      const crossedOrig = readFileSync(crossedPath);

      // Run 1: Fix broken CHECKED (default) -> both broken FB2 files repaired in memory, converted,
      // logged in Fixed summary & Fixed report section; source files untouched; zero popups!
      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').click();
      await page.getByTestId('batch-export-format').selectOption('txt');
      await page.getByTestId('batch-zip-output').uncheck();
      await expect(page.getByTestId('batch-fix-broken')).toBeChecked();
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-destination-input').fill(outFixed);
      await page.getByTestId('dialog-batch-converter-button-start').click();

      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('dialog-parse-error')).toHaveCount(0);
      await expect(page.getByTestId('batch-count-total')).toContainText('4');
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      await expect(page.getByTestId('batch-count-fixed')).toContainText('2');
      await expect(page.getByTestId('batch-count-skipped')).toContainText('0');
      await expect(page.getByTestId('batch-count-failed')).toContainText('1');

      // Converted output preserved both paragraphs; source files untouched on disk!
      const crossedTxt = readFileSync(path.join(outFixed, '03-crossed.txt'), 'utf8');
      expect(crossedTxt).toContain('unclosed emphasis');
      expect(crossedTxt).toContain('Preserved second paragraph');
      expect(readFileSync(path.join(srcDir, '02-malformed.fb2')).equals(malformedOrig)).toBe(true);
      expect(readFileSync(crossedPath).equals(crossedOrig)).toBe(true);

      // Fixed filter lists both repaired files.
      await page.getByTestId('batch-filter-fixed').click();
      await expect(
        page.getByTestId('batch-issues-list').locator('[data-testid="batch-issue-fixed"]'),
      ).toHaveCount(2);

      // Saved report contains Fixed summary count and Fixed (2) section.
      const fixedReportPath = path.join(work, 'report-fixed.txt');
      await core.enqueueDialog('dialog.saveFile', { path: fixedReportPath });
      await page.getByTestId('dialog-batch-converter-button-save-report').click();
      await expect(page.getByTestId('batch-report-save-notice')).toHaveAttribute('role', 'status');
      const fixedReportText = readFileSync(fixedReportPath, 'utf8');
      expect(fixedReportText).toMatch(/Fixed:\s+2/);
      expect(fixedReportText).toContain('Fixed (2)');
      expect(fixedReportText).toContain('02-malformed.fb2');
      expect(fixedReportText).toContain('03-crossed.fb2');

      // Run 2: Fix broken UNCHECKED -> both broken XML files skipped (not converted, not failed);
      // 0-byte non-FB2 still fails; zero popups!
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-fix-broken').uncheck();
      await page.getByTestId('batch-destination-input').fill(outSkipped);
      await page.getByTestId('dialog-batch-converter-button-start').click();

      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('dialog-parse-error')).toHaveCount(0);
      await expect(page.getByTestId('batch-count-total')).toContainText('4');
      await expect(page.getByTestId('batch-count-converted')).toContainText('1');
      await expect(page.getByTestId('batch-count-fixed')).toContainText('0');
      await expect(page.getByTestId('batch-count-skipped')).toContainText('2');
      await expect(page.getByTestId('batch-count-failed')).toContainText('1');

      expect(existsSync(path.join(outSkipped, '01-valid.txt'))).toBe(true);
      expect(existsSync(path.join(outSkipped, '02-malformed.txt'))).toBe(false);
      expect(existsSync(path.join(outSkipped, '03-crossed.txt'))).toBe(false);

      const skippedReportPath = path.join(work, 'report-skipped.txt');
      await core.enqueueDialog('dialog.saveFile', { path: skippedReportPath });
      await page.getByTestId('dialog-batch-converter-button-save-report').click();
      await expect(page.getByTestId('batch-report-save-notice')).toHaveAttribute('role', 'status');
      const skippedReportText = readFileSync(skippedReportPath, 'utf8');
      expect(skippedReportText).toMatch(/Skipped:\s+2/);
      expect(skippedReportText).toContain('Skipped (2)');
      expect(skippedReportText).toContain('02-malformed.fb2');
      expect(skippedReportText).toContain('03-crossed.fb2');

      await page.getByTestId('dialog-batch-converter-button-close').click();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test('refuses self-overwrite and overwriting the currently open editor book without modifying either file', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(90_000);
    await core.openApp(page);

    const work = makeTempDir('mfbe-us3-guards');
    try {
      // 1) Open-book overwrite refusal: open a book in the editor, then try to overwrite it via Import -> FB2.
      const openBookDir = path.join(work, 'open-dir');
      const openBookSrc = path.join(work, 'import-over-open');
      mkdirSync(openBookDir, { recursive: true });
      mkdirSync(openBookSrc, { recursive: true });

      const openBookPath = path.join(openBookDir, 'currently-open.fb2');
      copyFileSync(fixtureBook('modern-utf8.fb2'), openBookPath);
      const originalOpenBytes = readFileSync(openBookPath);

      await core.enqueueDialog('dialog.openFile', { paths: [openBookPath] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, openBookPath);

      writeFileSync(
        path.join(openBookSrc, 'currently-open.txt'),
        'Attempt to overwrite open book\n\nShould be refused safely.\n',
        'utf8',
      );

      await openBatchDialog(page);
      await page.getByTestId('batch-dir-import').click();
      await page.getByTestId('batch-import-all').check();
      await page.getByTestId('batch-source-input').fill(openBookSrc);
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-destination-input').fill(openBookDir);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-overwrite').check();
      await page.getByTestId('dialog-batch-converter-button-start').click();

      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('0');
      await expect(page.getByTestId('batch-count-failed')).toContainText('1');
      expect(readFileSync(openBookPath).equals(originalOpenBytes)).toBe(true);

      // 2) Self-overwrite refusal: in-place FB2 -> TXT with ZIP output on Book.zip holding Book.fb2
      // resolves to Book.zip == sourcePath and MUST fail safely without touching Book.zip!
      const selfDir = path.join(work, 'self-overwrite');
      mkdirSync(selfDir, { recursive: true });
      const selfZipPath = path.join(selfDir, 'Book.zip');
      writeStoredZip(selfZipPath, [
        { name: 'Book.fb2', content: readFileSync(fixtureBook('modern-utf8.fb2')) },
      ]);
      const originalZipBytes = readFileSync(selfZipPath);

      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-dir-export').click();
      await page.getByTestId('batch-export-format').selectOption('txt');
      await page.getByTestId('batch-source-input').fill(selfDir);
      await page.getByTestId('batch-in-place').check();
      await page.getByTestId('batch-zip-output').check();
      await page.getByTestId('batch-overwrite').check();
      await page.getByTestId('dialog-batch-converter-button-start').click();

      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('0');
      await expect(page.getByTestId('batch-count-failed')).toContainText('1');
      expect(readFileSync(selfZipPath).equals(originalZipBytes)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
