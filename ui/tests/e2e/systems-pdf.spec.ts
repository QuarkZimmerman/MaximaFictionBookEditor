/**
 * Feature 014 (SC-009; tasks T060), tagged `@platform` so that the Windows and macOS legs run it as
 * the Linux one does: the reference book and five other books exported in A4 and A6 through the
 * print seam, each file's page count and per-page text (read by pdf.js) written to
 * build/pdf-systems/<platform>.json. The pdf-systems CI job compares the three
 * (tests/pdf/compare-systems.mjs): Windows and Linux page for page, macOS - whose engine hyphenates
 * - by the text in order.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { test } from './fixtures/core';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-systems');
const BOOKS = [
  'reference-all-elements.fb2',
  'pictures-alt.fb2',
  'russian-untitled-notes.fb2',
  'german-book.fb2',
  'nested-sections.fb2',
  'notes-6.fb2',
];
const SIZES = ['A4 (210 × 297 mm)', 'A6 (105 × 148 mm)'];

test('the books in A4 and A6, as this system prints them @platform', async ({
  core,
  page,
  context,
}) => {
  test.skip(!core.hasCore, 'needs the core');
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  const { pdfPageTexts } = (await import(
    pathToFileURL(path.join(ROOT, 'tests', 'pdf', 'text-compare.mjs')).href
  )) as { pdfPageTexts(bytes: Uint8Array): Promise<string[]> };
  await core.openApp(page);
  const seam = startPrintSeam(core, context);
  const records: { book: string; size: string; pages: number; texts: string[] }[] = [];
  try {
    for (const book of BOOKS) {
      await openFixtureBook(core, page, book);
      for (const size of SIZES) {
        const file = path.join(OUT, `${path.basename(book, '.fb2')}-${size.slice(0, 2)}.pdf`);
        await exportPdfTo(core, page, file, size);
        const texts = await pdfPageTexts(new Uint8Array(readFileSync(file)));
        records.push({ book, size, pages: texts.length, texts });
      }
    }
  } finally {
    await seam.stop();
  }
  writeFileSync(
    path.join(OUT, `${process.platform}.json`),
    `${JSON.stringify({ platform: process.platform, records }, null, 1)}\n`,
  );
});
