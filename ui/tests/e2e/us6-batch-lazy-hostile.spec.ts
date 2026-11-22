/**
 * Feature 019 (T059; US6): On-demand lazy chunk loading (zero batch/format chunks at start-up,
 * editing, or Settings; `FB2 -> TXT` loads only `batch-converter` + `txt-export` without unrelated
 * format chunks), safety against hostile inputs (0-byte, random bytes, malformed XML, bomb ZIP,
 * path-escape ZIP, POSIX symlink cycle, remote image URLs, Cyrillic/Ukrainian paths), zero
 * external network requests, zero leftover temp dirs, and clean editor exit within 20 s.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  expect,
  fixtureBook,
  recordOutside,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
} from './fixtures/core';
import { makeTempDir, openBatchDialog, repoFixture } from './fixtures/batchHelpers';

function batchStateEntries(dataDir: string | undefined): string[] {
  if (!dataDir) return [];
  const batchDir = path.join(dataDir, 'state', 'batch');
  if (!existsSync(batchDir)) return [];
  return readdirSync(batchDir);
}

test.describe('US6: On-demand loading, hostile inputs, and clean shutdown', () => {
  test('never loads batch-converter or format chunks during start-up/editing/Settings, and FB2 -> TXT loads only batch-converter + txt-export', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(90_000);

    const requestedAssets: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/assets/')) {
        requestedAssets.push(url.slice(url.lastIndexOf('/assets/') + 8));
      }
    });

    await core.openApp(page);

    // Open a real book, edit it, and open + close Settings -> still zero batch or format chunks!
    const sample = fixtureBook('modern-utf8.fb2');
    await core.enqueueDialog('dialog.openFile', { paths: [sample] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, sample);

    await page.getByTestId('menu-tools').click();
    await page.getByTestId('menu-tools-settings').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await page.getByTestId('dialog-settings-button-cancel').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();

    const forbiddenUpfront = [
      /^batch-converter-/,
      /^epub-/,
      /^mobi-/,
      /^pdf-export-/,
      /^pdf-import-/,
      /^txt-export-/,
      /^txt-import-/,
      /^import-shared-/,
    ];
    for (const pattern of forbiddenUpfront) {
      expect(
        requestedAssets.filter((a) => pattern.test(a)),
        `unexpected upfront chunk matching ${pattern}: ${requestedAssets.join(', ')}`,
      ).toEqual([]);
    }

    // Run FB2 -> TXT in Batch Converter -> loads batch-converter + txt-export only (never epub/mobi/pdf/txt-import)!
    const work = makeTempDir('mfbe-us6-lazy');
    const srcDir = path.join(work, 'src');
    const dstDir = path.join(work, 'dst');
    mkdirSync(srcDir, { recursive: true });
    copyFileSync(sample, path.join(srcDir, 'tiny.fb2'));
    try {
      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').check();
      await page.getByTestId('batch-export-format').selectOption('txt');
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-destination-input').fill(dstDir);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('1');
      await page.getByTestId('dialog-batch-converter-button-close').click();

      expect(requestedAssets.some((a) => /^batch-converter-/.test(a))).toBe(true);
      expect(
        requestedAssets.some((a) => /^txt-export-/.test(a) || /^txtExportWorker-/.test(a)),
      ).toBe(true);

      const forbiddenUnrelated = [
        /^epub-/,
        /^mobi-/,
        /^pdf-export-/,
        /^pdf-import-/,
        /^txt-import-/,
      ];
      for (const pattern of forbiddenUnrelated) {
        expect(
          requestedAssets.filter((a) => pattern.test(a)),
          `unrelated format chunk loaded during FB2 -> TXT (${pattern})`,
        ).toEqual([]);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test('handles hostile tree safely with Cyrillic/Ukrainian paths, zero network calls, zero leftover temp dirs, and clean shutdown within 20 s', async ({
    core,
    page,
    context,
  }) => {
    const coreBin = process.env.MFBE_CORE_BIN;
    test.skip(!core.hasCore || !coreBin, 'needs MFBE_CORE_BIN');
    test.setTimeout(120_000);

    const outside = await recordOutside(context);
    const work = makeTempDir('mfbe-us6-hostile');
    const dedicatedDataDir = path.join(work, 'core-data');
    mkdirSync(dedicatedDataDir, { recursive: true });

    const dedicated = await startCoreWith(coreBin!, dedicatedDataDir, []);
    try {
      await page.goto(dedicated.url);
      await waitForStartupDocument(page);

      const srcDir = path.join(work, 'hostile-src');
      const unicodeDir = path.join(srcDir, 'Книги', 'Українська');
      mkdirSync(unicodeDir, { recursive: true });

      // 1) Valid FB2 in Cyrillic/Ukrainian nested folder
      copyFileSync(fixtureBook('modern-utf8.fb2'), path.join(unicodeDir, 'Їжак і Сонце.fb2'));
      // 2) Valid FB2 referencing remote HTTP/HTTPS URLs (must NEVER contact network)
      const remoteUrlFb2 = readFileSync(fixtureBook('modern-utf8.fb2'), 'utf8').replace(
        '</body>',
        '<section><p><image l:href="https://198.51.100.42/tracker.png"/><a l:href="http://198.51.100.42/ping">link</a></p></section></body>',
      );
      writeFileSync(path.join(srcDir, 'remote-refs.fb2'), remoteUrlFb2, 'utf8');
      // 3) Malformed XML .fb2
      copyFileSync(fixtureBook('malformed.fb2'), path.join(srcDir, 'malformed.fb2'));
      // 4) 0-byte files across formats (distinct stems so each format adapter runs individually)
      for (const ext of ['fb2', 'epub', 'mobi', 'pdf']) {
        writeFileSync(path.join(srcDir, `empty-${ext}.${ext}`), Buffer.alloc(0));
      }
      // 5) Random/garbage binary bytes renamed to book extensions
      const garbage = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff, 0x13, 0x37, 0x99, 0xaa]);
      for (const ext of ['fb2', 'epub', 'mobi', 'pdf']) {
        writeFileSync(path.join(srcDir, `garbage-${ext}.${ext}`), garbage);
      }
      // 6) Decompression bomb & path-escape ZIP archives
      copyFileSync(repoFixture('epub', 'zip-bomb.epub'), path.join(srcDir, 'bomb.zip'));
      copyFileSync(repoFixture('epub', 'zip-bomb.epub'), path.join(srcDir, 'bomb.epub'));
      copyFileSync(repoFixture('epub', 'path-escape.epub'), path.join(srcDir, 'escape.zip'));
      // 7) Hostile Markdown fixture (remote images, HTML injection, etc.)
      copyFileSync(repoFixture('markdown', 'hostile.md'), path.join(srcDir, 'hostile.md'));
      // 8) Directory symlink cycle on POSIX (must never hang scanning!)
      if (process.platform !== 'win32') {
        symlinkSync(srcDir, path.join(unicodeDir, 'cycle-back'));
      }

      // Pass A: FB2 -> EPUB over hostile tree (valid Unicode book & remote-refs succeed; bad FB2s & bomb ZIP fail safely).
      const outEpub = path.join(work, 'out-epub');
      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').check();
      await page.getByTestId('batch-export-format').selectOption('epub');
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-destination-input').fill(outEpub);
      await page.getByTestId('batch-include-subfolders').check();
      await page.getByTestId('batch-keep-tree').check();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });

      const unicodeOut = path.join(outEpub, 'Книги', 'Українська', 'Їжак і Сонце.epub');
      expect(existsSync(unicodeOut), `expected Cyrillic/Ukrainian output ${unicodeOut}`).toBe(true);
      expect(existsSync(path.join(outEpub, 'remote-refs.epub'))).toBe(true);
      const exportFailedText = (await page.getByTestId('batch-count-failed').textContent()) ?? '';
      expect(Number(/(\d+)/.exec(exportFailedText)?.[1] ?? '0')).toBeGreaterThanOrEqual(3);
      expect(batchStateEntries(dedicatedDataDir)).toEqual([]);

      // Pass B: Import -> FB2 (All formats) over hostile tree (hostile.md succeeds; bad epub/mobi/pdf/zip fail safely).
      const outFb2 = path.join(work, 'out-fb2');
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-dir-import').check();
      await page.getByTestId('batch-import-all').check();
      await page.getByTestId('batch-destination-input').fill(outFb2);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });

      expect(existsSync(path.join(outFb2, 'hostile.fb2'))).toBe(true);
      expect(existsSync(path.join(outFb2, 'escape.fb2'))).toBe(false);
      await expect(page.getByTestId('batch-count-converted')).toContainText('1');
      const importFailedText = (await page.getByTestId('batch-count-failed').textContent()) ?? '';
      expect(Number(/(\d+)/.exec(importFailedText)?.[1] ?? '0')).toBeGreaterThanOrEqual(8);
      expect(batchStateEntries(dedicatedDataDir)).toEqual([]);

      // Zero external network requests attempted across both full hostile runs!
      expect(outside).toEqual([]);

      // Close Batch Converter dialog and trigger clean exit via File -> Exit within 20 s!
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();

      const exitStart = Date.now();
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-exit').click();
      await dedicated.stop();
      expect(Date.now() - exitStart).toBeLessThan(20_000);
      expect(batchStateEntries(dedicatedDataDir)).toEqual([]);
    } finally {
      await dedicated.stop().catch(() => undefined);
      rmSync(work, { recursive: true, force: true });
    }
  });
});
