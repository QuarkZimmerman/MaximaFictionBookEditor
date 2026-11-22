/**
 * Feature 019 (T038; US2): Batch import all 5 supported formats (EPUB, MOBI / KF8, PDF, TXT,
 * Markdown) to valid UTF-8 FB2 2.1 (bare .fb2 and .fb2.zip), including .zip inputs (single-book,
 * multi-book, .md.zip with bundled images, archive & sibling .fbd metadata), format-subset
 * filtering, round-trip fidelity, JPEG/PNG-only picture enforcement, and silent skipping of
 * bookless ZIPs and non-book files.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, fixtureBook, test } from './fixtures/core';
import {
  makeTempDir,
  openBatchDialog,
  repoFixture,
  TINY_PNG_BYTES,
  writeStoredZip,
} from './fixtures/batchHelpers';

interface OpenedEphemeral {
  document: {
    docId: string;
    sourceEncoding: string;
    schemaHint: '2.1' | 'legacy' | 'unknown';
    binaries: Array<{ id: string; contentType: string }>;
    description?: {
      titleInfo?: {
        bookTitle?: string;
        authors?: Array<{ firstName?: string; lastName?: string }>;
      };
    };
  };
  warnings: Array<{ code: string; severity: string; message?: string; path?: string; line?: number }>;
}

async function inspectFb2(
  core: import('./fixtures/core').CoreHandle,
  fb2Path: string,
): Promise<{ doc: OpenedEphemeral['document']; issues: OpenedEphemeral['warnings'] }> {
  const opened = (await core.rpc('doc.open', {
    path: fb2Path,
    ephemeral: true,
  })) as OpenedEphemeral;
  const doc = opened.document;
  const validated = (await core.rpc('doc.validate', { docId: doc.docId })) as {
    issues?: OpenedEphemeral['warnings'];
  };
  await core.rpc('doc.close', { docId: doc.docId });
  return { doc, issues: validated.issues ?? [] };
}

test.describe('US2: Batch import formats to FB2', () => {
  test('imports all 5 formats (bare + ZIP + .md.zip + companion .fbd + multi-book ZIP), applies format filters, and supports .fb2.zip output', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(180_000);
    await core.openApp(page);

    const work = makeTempDir('mfbe-us2-import');
    try {
      // Step 0: Produce a real editor-made MOBI (.mobi) and EPUB (.epub) from modern-utf8.fb2
      // via Batch Export so US2 tests real round-trip fidelity as well as foreign files.
      const seedSrc = path.join(work, 'seed-fb2');
      const seedMobiOut = path.join(work, 'seed-mobi');
      mkdirSync(seedSrc, { recursive: true });
      copyFileSync(fixtureBook('modern-utf8.fb2'), path.join(seedSrc, 'roundtrip.fb2'));
      await core.rpc('settings.set', { patch: { mobi: { format: 'joint', zip: false } } });

      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').check();
      await page.getByTestId('batch-export-format').selectOption('mobi');
      await page.getByTestId('batch-source-input').fill(seedSrc);
      await page.getByTestId('batch-destination-input').fill(seedMobiOut);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('1');
      const mobiSample = path.join(seedMobiOut, 'roundtrip.mobi');
      expect(existsSync(mobiSample)).toBe(true);

      // Step 1: Assemble the mixed import source tree covering all 5 formats + ZIP variants + FBD + ignored files.
      const srcDir = path.join(work, 'import-src');
      mkdirSync(srcDir, { recursive: true });

      const epubFixture = repoFixture('epub', 'epub-3.0.epub');
      const pdfFixture = repoFixture('pdf', 'import', 'tagged.pdf');
      const fbdFixture = repoFixture('books', 'descriptor.fbd');
      const mdFixture = repoFixture('markdown', 'structure.md');

      // 1) Bare EPUB
      copyFileSync(epubFixture, path.join(srcDir, 'bare-epub.epub'));
      // 2) EPUB wrapped inside a single-book ZIP
      writeStoredZip(path.join(srcDir, 'zipped-epub.zip'), [
        { name: 'inner-book.epub', content: readFileSync(epubFixture) },
      ]);
      // 3) Bare round-trip MOBI
      copyFileSync(mobiSample, path.join(srcDir, 'roundtrip-mobi.mobi'));
      // 4) Bare PDF
      copyFileSync(pdfFixture, path.join(srcDir, 'bare-pdf.pdf'));
      // 5) Bare TXT + sibling companion .fbd
      writeFileSync(
        path.join(srcDir, 'plain-with-fbd.txt'),
        'Chapter One\n\nA simple plain text book paired with an external descriptor.\n',
        'utf8',
      );
      copyFileSync(fbdFixture, path.join(srcDir, 'plain-with-fbd.fbd'));
      // 6) Bare Markdown
      copyFileSync(mdFixture, path.join(srcDir, 'bare-markdown.md'));
      // 7) .md.zip bundle with embedded PNG image
      writeStoredZip(path.join(srcDir, 'illustrated.md.zip'), [
        {
          name: 'book.md',
          content: '# Illustrated Bundle\n\nOpening paragraph.\n\n![Tiny](images/tiny.png)\n',
        },
        { name: 'images/tiny.png', content: TINY_PNG_BYTES },
      ]);
      // 8) Multi-book ZIP containing two books (one TXT with archive .fbd, one Markdown in subfolder)
      writeStoredZip(path.join(srcDir, 'bundle.zip'), [
        {
          name: 'first.txt',
          content: 'First Book\n\nHello from inside a multi-book archive.\n',
        },
        { name: 'first.fbd', content: readFileSync(fbdFixture) },
        {
          name: 'nested/second.md',
          content: '# Second Book\n\nNested markdown inside multi-book archive.\n',
        },
      ]);
      // Ignored non-book inputs: bookless ZIP and loose PNG image
      writeStoredZip(path.join(srcDir, 'bookless.zip'), [
        { name: 'cover.png', content: TINY_PNG_BYTES },
        { name: 'notes.dat', content: 'not a book' },
      ]);
      writeFileSync(path.join(srcDir, 'loose-image.png'), TINY_PNG_BYTES);

      // Total convertible books: 7 single-book inputs + 2 inside bundle.zip = 9 books.
      // Step 2: Switch to Import -> FB2 and verify format filter defaults & 0-selected guard.
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-dir-import').check();
      await expect(page.getByTestId('batch-import-all')).toBeChecked();
      for (const fmt of ['epub', 'mobi', 'pdf', 'txt', 'markdown']) {
        await expect(page.getByTestId(`batch-import-fmt-${fmt}`)).toBeChecked();
      }
      // Unchecking "All supported formats" clears all 5 and disables Start.
      await page.getByTestId('batch-import-all').uncheck();
      await expect(page.getByTestId('dialog-batch-converter-button-start')).toBeDisabled();
      // Re-checking "All supported formats" restores all 5.
      await page.getByTestId('batch-import-all').check();
      // ZIP output defaults unchecked for Import -> FB2 and is enabled.
      await expect(page.getByTestId('batch-zip-output')).toBeEnabled();
      await expect(page.getByTestId('batch-zip-output')).not.toBeChecked();

      // Step 3: Run full All-formats import -> bare .fb2 (keep tree enabled).
      const outAll = path.join(work, 'out-all-fb2');
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-destination-input').fill(outAll);
      await page.getByTestId('batch-include-subfolders').check();
      await page.getByTestId('batch-keep-tree').check();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('9');
      await expect(page.getByTestId('batch-count-failed')).toContainText('0');
      await expect(page.getByTestId('batch-count-skipped')).toContainText('0');

      const expectedOutputs = [
        path.join(outAll, 'bare-epub.fb2'),
        path.join(outAll, 'zipped-epub.fb2'),
        path.join(outAll, 'roundtrip-mobi.fb2'),
        path.join(outAll, 'bare-pdf.fb2'),
        path.join(outAll, 'plain-with-fbd.fb2'),
        path.join(outAll, 'bare-markdown.fb2'),
        path.join(outAll, 'illustrated.fb2'),
        path.join(outAll, 'bundle', 'first.fb2'),
        path.join(outAll, 'bundle', 'nested', 'second.fb2'),
      ];
      for (const outPath of expectedOutputs) {
        expect(existsSync(outPath), `expected output ${outPath}`).toBe(true);
        const xmlHead = readFileSync(outPath, 'utf8').slice(0, 200);
        expect(xmlHead.toLowerCase()).toContain('utf-8');
        const { doc, issues } = await inspectFb2(core, outPath);
        expect(doc.sourceEncoding.toLowerCase()).toBe('utf-8');
        // Foreign books without a genre/cover inherit blank.fb2's empty template placeholders;
        // every structural/body error must be zero (matches epubImport.ts FR-030 rule).
        const realErrors = issues.filter(
          (i) => i.severity === 'error' && i.code !== 'genre.unknown',
        );
        expect(
          realErrors,
          `${path.basename(outPath)} unexpected errors: ${JSON.stringify(realErrors)}`,
        ).toEqual([]);
        for (const bin of doc.binaries) {
          expect(['image/jpeg', 'image/png']).toContain(bin.contentType);
        }
      }

      // Verify round-trip MOBI and FBD-paired outputs validate strictly as schemaHint '2.1' with 0 errors.
      const { doc: rtMobiDoc, issues: rtMobiIssues } = await inspectFb2(
        core,
        path.join(outAll, 'roundtrip-mobi.fb2'),
      );
      expect(rtMobiDoc.schemaHint).toBe('2.1');
      expect(rtMobiIssues.filter((i) => i.severity === 'error')).toEqual([]);

      // Verify sibling .fbd AND archive .fbd were applied unattended.
      const { doc: txtWithFbdDoc } = await inspectFb2(core, path.join(outAll, 'plain-with-fbd.fb2'));
      expect(txtWithFbdDoc.description?.titleInfo?.bookTitle).toBe('Только описание');
      expect(txtWithFbdDoc.schemaHint).toBe('2.1');
      const { doc: archiveFbdDoc } = await inspectFb2(core, path.join(outAll, 'bundle', 'first.fb2'));
      expect(archiveFbdDoc.description?.titleInfo?.bookTitle).toBe('Только описание');
      expect(archiveFbdDoc.schemaHint).toBe('2.1');

      // Verify .md.zip embedded its bundled PNG picture into the FB2!
      const { doc: illustratedDoc } = await inspectFb2(core, path.join(outAll, 'illustrated.fb2'));
      expect(illustratedDoc.binaries.length).toBeGreaterThanOrEqual(1);
      expect(illustratedDoc.binaries.some((b) => b.contentType === 'image/png')).toBe(true);

      // Verify bookless.zip and loose-image.png produced no output.
      expect(existsSync(path.join(outAll, 'bookless.fb2'))).toBe(false);
      expect(existsSync(path.join(outAll, 'loose-image.fb2'))).toBe(false);

      // Step 4: Subset filter (MOBI + PDF only) + Save output in ZIP archive (.fb2.zip).
      const outSubsetZip = path.join(work, 'out-subset-zip');
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-import-all').uncheck();
      await page.getByTestId('batch-import-fmt-mobi').check();
      await page.getByTestId('batch-import-fmt-pdf').check();
      await expect(page.getByTestId('batch-import-all')).not.toBeChecked();
      await page.getByTestId('batch-zip-output').check();
      await page.getByTestId('batch-destination-input').fill(outSubsetZip);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('2');
      await expect(page.getByTestId('batch-count-failed')).toContainText('0');

      const mobiZipOut = path.join(outSubsetZip, 'roundtrip-mobi.fb2.zip');
      const pdfZipOut = path.join(outSubsetZip, 'bare-pdf.fb2.zip');
      expect(existsSync(mobiZipOut)).toBe(true);
      expect(existsSync(pdfZipOut)).toBe(true);
      expect(existsSync(path.join(outSubsetZip, 'bare-epub.fb2.zip'))).toBe(false);
      expect(existsSync(path.join(outSubsetZip, 'bare-markdown.fb2.zip'))).toBe(false);

      // Confirm core opens produced .fb2.zip outputs cleanly as valid UTF-8 FB2 2.1.
      const { doc: reopenedMobi } = await inspectFb2(core, mobiZipOut);
      expect(reopenedMobi.sourceEncoding.toLowerCase()).toBe('utf-8');
      expect(reopenedMobi.schemaHint).toBe('2.1');
      const { doc: reopenedPdf, issues: pdfIssues } = await inspectFb2(core, pdfZipOut);
      expect(reopenedPdf.sourceEncoding.toLowerCase()).toBe('utf-8');
      expect(
        pdfIssues.filter((i) => i.severity === 'error' && i.code !== 'genre.unknown'),
      ).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
