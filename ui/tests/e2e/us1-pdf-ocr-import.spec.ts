/**
 * Feature 020 (T024, US1): Headless Playwright E2E journey for interactive PDF OCR import.
 * Covers image-only EN/RU scans (with contradictory scanner /Lang metadata override),
 * garbled-layer rescue vs refusal when Use OCR is unchecked, rotated 90/180/270 scans,
 * session-sticky Use OCR checkbox across native-checks and fallback-modal paths, and
 * mid-run cancellation within 3 s leaving the open book untouched.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, shownDocId, test } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { importPdfViaMenu, PdfImportFailed, pdfImportDone } from './fixtures/pdfImport';

const OCR_PDFS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/pdf/ocr',
);
const ocrPdf = (name: string): string => path.join(OCR_PDFS, name);

test.describe('US1 (feature 020) - interactive image-only, rotated and garbled PDF OCR import', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('imports 10-page EN and RU image-only PDFs with correct <lang> and OCR summary', async ({
    core,
    page,
  }) => {
    const enSummary = await pdfImportDone(
      page,
      await importPdfViaMenu(core, page, ocrPdf('scan-en-10p.pdf'), { useOcr: true }),
      90_000,
    );
    const enXml = await bookXml(core, page);
    expect(enXml).toContain('<lang>en</lang>');
    for (const word of [
      'lantern',
      'breakwater',
      'chestnuts',
      'observatory',
      'locomotive',
      'midnight',
    ]) {
      expect(enXml).toContain(word);
    }
    expect(enSummary).toContain('Pages recognized with OCR: 10');

    // Russian scan carries contradictory /Lang (en) metadata — OCR primaryLang "ru" must win.
    const ruSummary = await pdfImportDone(
      page,
      await importPdfViaMenu(core, page, ocrPdf('scan-ru-10p.pdf'), { useOcr: true }),
      90_000,
    );
    const ruXml = await bookXml(core, page);
    expect(ruXml).toContain('<lang>ru</lang>');
    for (const word of ['смотритель', 'пекарне', 'обсерватории', 'телескопа', 'паровоз']) {
      expect(ruXml).toContain(word);
    }
    expect(ruSummary).toContain('Pages recognized with OCR: 10');
  });

  test('rescues garbled-layer PDF with OCR on and refuses cleanly with OCR off', async ({
    core,
    page,
  }) => {
    const beforeOff = await importPdfViaMenu(core, page, ocrPdf('garbled-ru.pdf'), {
      useOcr: false,
    });
    const refused = await pdfImportDone(page, beforeOff).then(
      () => '',
      (err: unknown) => (err instanceof PdfImportFailed ? err.message : String(err)),
    );
    expect(refused).toContain('reads mostly as garbage');

    await pdfImportDone(
      page,
      await importPdfViaMenu(core, page, ocrPdf('garbled-ru.pdf'), { useOcr: true }),
      60_000,
    );
    const xml = await bookXml(core, page);
    expect(xml).toContain('<lang>ru</lang>');
    expect(xml).toContain('смотритель');
    expect(xml).toContain('пекарне');
  });

  test('rotates 90/180/270 scanned pages upright via OSD', async ({ core, page }) => {
    await pdfImportDone(
      page,
      await importPdfViaMenu(core, page, ocrPdf('scan-rotated.pdf'), { useOcr: true }),
      60_000,
    );
    const xml = await bookXml(core, page);
    expect(xml).toContain('Navigation');
    expect(xml).toContain('lighthouse');
    expect(xml).toContain('archipelago');
  });

  test('fallback options modal appears when native dialog omits checks and stays session-sticky without mutating Settings', async ({
    core,
    page,
  }) => {
    // 1. Trigger fallback modal (useOcr: null omits `checks` from dialog.openFile answer)
    const before = await importPdfViaMenu(core, page, ocrPdf('garbled-ru.pdf'), { useOcr: null });
    const modal = page.getByTestId('dialog-pdf-import-options');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const checkbox = modal.getByTestId('pdf-import-options-use-ocr');
    await expect(checkbox).toBeChecked();
    // Uncheck Use OCR and confirm -> refuses garbled PDF, and remembers false for this session
    await checkbox.uncheck();
    await modal.getByRole('button', { name: 'Import' }).click();
    const refused = await pdfImportDone(page, before).then(
      () => '',
      (err: unknown) => (err instanceof PdfImportFailed ? err.message : String(err)),
    );
    expect(refused).toContain('reads mostly as garbage');

    // 2. Subsequent import starts with Use OCR unchecked (session-sticky!)
    await importPdfViaMenu(core, page, ocrPdf('garbled-ru.pdf'), { useOcr: null });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByTestId('pdf-import-options-use-ocr')).not.toBeChecked();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    // 3. Global Settings.imports.pdf.useOcr must remain true (untouched by session toggle)
    const settings = await core.rpc<{ imports?: { pdf?: { useOcr?: boolean } } }>('settings.get');
    expect(settings.imports?.pdf?.useOcr).toBe(true);
  });

  test('cancelling mid-run stops promptly and leaves open book untouched', async ({
    core,
    page,
  }) => {
    const initialDocId = await shownDocId(page);
    await importPdfViaMenu(core, page, ocrPdf('scan-en-10p.pdf'), {
      question: false,
      useOcr: true,
    });
    const modal = page.getByTestId('modal-job');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const t0 = Date.now();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden({ timeout: 5_000 });
    expect(Date.now() - t0).toBeLessThan(3_500);
    expect(await shownDocId(page)).toBe(initialDocId);
  });
});
