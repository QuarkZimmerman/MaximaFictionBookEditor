/**
 * Feature 016 (User Story 7; tasks T057): the PDF export's defects fixed and its ZIP archive (D10, D25): grouped
 * notes and two notes bodies, zero-width non-joiners, a picture's title as its caption; Save in ZIP archive
 * unticked every time, the archive with the PDF and the FBD, imported without a question; a 0.0.11 file still
 * imported.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, fixtureBook, test, type CoreHandle } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { clickExport } from './fixtures/exportCheck';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { importPdfViaMenu, pdf, pdfImportDone } from './fixtures/pdfImport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

const A5 = 'A5 (148 × 210 mm)';
const title = (xml: string): string => /<book-title>([^<]*)<\/book-title>/.exec(xml)?.[1] ?? '';

/** The Save in ZIP archive box of the last Save dialog the core was asked for. */
async function zipChoiceAsked(core: CoreHandle): Promise<{ checked?: boolean } | undefined> {
  type Asked = {
    zipChoice?: { checked?: boolean };
    params?: { zipChoice?: { checked?: boolean } };
  };
  const last = (await core.rpc<Asked[]>('test.dialogRequests')).at(-1);
  return last?.zipChoice ?? last?.params?.zipChoice;
}

test.describe('US7 (feature 016) - the PDF export: its defects fixed, and its ZIP archive', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('grouped notes, two notes bodies and zero-width non-joiners are written (1 to 3)', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const dir = scratchDir('pdf-defects-');
    const seam = startPrintSeam(core, context, { readyTimeoutMs: 120_000 });
    try {
      await openFixtureBook(core, page, fixtureBook('long-notes.fb2'));
      expect(await exportPdfTo(core, page, path.join(dir, 'notes.pdf'), A5)).toContain(
        'Exported to',
      );
      const zwnj = path.join(dir, 'zwnj.fb2');
      writeFileSync(
        zwnj,
        '<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">' +
          '<description><title-info><genre>prose</genre><author><last-name>A</last-name></author>' +
          '<book-title>Non\u200cjoiners</book-title><lang>fa</lang></title-info></description>' +
          '<body><section><p>می\u200cخواهم و\u200cیا</p></section></body></FictionBook>\n',
      );
      await openFixtureBook(core, page, zwnj);
      expect(await exportPdfTo(core, page, path.join(dir, 'zwnj.pdf'), A5)).toContain(
        'Exported to',
      );
    } finally {
      await seam.stop();
    }
  });

  test("a picture's title comes back from the PDF as its caption (4)", async ({
    core,
    page,
    context,
  }) => {
    const dir = scratchDir('pdf-caption-');
    const seam = startPrintSeam(core, context, { readyTimeoutMs: 120_000 });
    try {
      await openFixtureBook(core, page, fixtureBook('reference-all-elements.fb2'));
      const target = path.join(dir, 'reference.pdf');
      await exportPdfTo(core, page, target, A5);
      await pdfImportDone(page, await importPdfViaMenu(core, page, target));
      expect(await bookXml(core, page)).toContain('title="A caption under the picture"');
    } finally {
      await seam.stop();
    }
  });

  test('Save in ZIP archive: unticked every time; ticked, the archive holds the PDF and the FBD and imports without a question (5 to 7)', async ({
    core,
    page,
    context,
  }) => {
    // Two exports and an import.
    test.setTimeout(240_000);
    const dir = scratchDir('pdf-zip-');
    const seam = startPrintSeam(core, context, { readyTimeoutMs: 120_000 });
    try {
      await openFixtureBook(core, page, fixtureBook('reference-all-elements.fb2'));
      await exportPdfTo(core, page, path.join(dir, 'plain.pdf'), A5);
      expect((await zipChoiceAsked(core))?.checked).toBe(false);
      // Ticked: the archive instead of the PDF, named .zip.
      await core.enqueueDialog('dialog.saveFile', {
        path: path.join(dir, 'book.pdf'),
        encoding: A5,
        zip: true,
      });
      await clickExport(core, page, 'exportPdf');
      const archive = path.join(dir, 'book.zip');
      await expect(page.getByTestId('status-message')).toContainText(`Exported to ${archive}`, {
        timeout: 120_000,
      });
      expect((await zipChoiceAsked(core))?.checked).toBe(false);
      const listed = await core.rpc<{
        archive: { pdfs: { entry: string }[]; fbds: { entry: string }[] };
      }>('pdfImport.begin', { path: archive });
      expect(listed.archive.pdfs.map((p) => p.entry)).toEqual(['book.pdf']);
      expect(listed.archive.fbds.map((f) => f.entry)).toEqual(['book.fbd']);
      // D23: the same description in both - no question.
      await pdfImportDone(page, await importPdfViaMenu(core, page, archive));
      await expect(page.getByTestId('dialog-pdf-fbd-which')).toHaveCount(0);
      await expect(page.getByTestId('dialog-pdf-fbd-take')).toHaveCount(0);
      expect(title(await bookXml(core, page))).toBe('The Reference Book');
    } finally {
      await seam.stop();
    }
  });

  test('a file exported by 0.0.11 still imports (8)', async ({ core, page }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('reference-0.0.11-a5.pdf')));
    expect(title(await bookXml(core, page))).toBe('The Reference Book');
  });
});
