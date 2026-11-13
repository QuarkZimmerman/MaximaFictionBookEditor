/**
 * Feature 014, User Story 1 (tasks T020): File > Export > Export as PDF... writes the book in the
 * page size chosen in the Save dialog. The pages are laid out by the interface, printed by the test
 * browser through the core's seam (fixtures/printSeam.ts), and written by the core. The files go to
 * build/pdf-export/, where CI's veraPDF step checks them (tools/ci/verapdf.sh).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures/core';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../build/pdf-export');

test.describe('US1: export a searchable PDF in a chosen page size (feature 014)', () => {
  test('the reference book in A5: the Save dialog offers the sizes, the file is a PDF', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    mkdirSync(OUT, { recursive: true });
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const target = path.join(OUT, 'reference-a5.pdf');
      await exportPdfTo(core, page, target, 'A5 (148 × 210 mm)');
      const bytes = readFileSync(target);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(seam.failed).toEqual([]);
      expect(seam.printed).toHaveLength(1);
      expect(seam.printed[0].paperWidthIn).toBeCloseTo(148 / 25.4, 6);
      expect(seam.printed[0].paperHeightIn).toBeCloseTo(210 / 25.4, 6);
      // The Save dialog offered the nine sizes, A4 proposed, under the "Page size:" label (D2, D3).
      // test.dialogRequests records are flat: the request's fields at the top level.
      const requests = await core.rpc<
        {
          method: string;
          encodingChoices?: string[];
          selectedEncoding?: string;
          encodingLabel?: string;
        }[]
      >('test.dialogRequests');
      const save = requests.filter((r) => r.method === 'dialog.saveFile').pop();
      expect(save?.encodingChoices).toEqual([
        'A4 (210 × 297 mm)',
        'B5 (176 × 250 mm)',
        'A5 (148 × 210 mm)',
        'B6 (125 × 176 mm)',
        'A6 (105 × 148 mm)',
        'Legal (8.5 × 14 in)',
        'Letter (8.5 × 11 in)',
        'Executive (7.25 × 10.5 in)',
        'Statement (5.5 × 8.5 in)',
      ]);
      expect(save?.selectedEncoding).toBe('A4 (210 × 297 mm)');
      expect(save?.encodingLabel).toBe('Page size:');
    } finally {
      await seam.stop();
    }
  });

  test('a book with pictures in A4: the core draws each picture from the book (R4)', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    mkdirSync(OUT, { recursive: true });
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'pictures-alt.fb2');
      const target = path.join(OUT, 'pictures-alt-a4.pdf');
      await exportPdfTo(core, page, target, 'A4 (210 × 297 mm)');
      const text = readFileSync(target).toString('latin1');
      expect(text.startsWith('%PDF-')).toBe(true);
      // The pictures are the core's own image objects, not the browser engine's.
      expect(text).toContain('/MfbeIm');
      expect(seam.printed[0].paperWidthIn).toBeCloseTo(210 / 25.4, 6);
    } finally {
      await seam.stop();
    }
  });
});
