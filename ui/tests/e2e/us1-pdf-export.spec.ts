/**
 * Feature 014, User Story 1 (tasks T020): File > Export > Export as PDF... writes the book in the
 * page size chosen in the Save dialog. The pages are laid out by the interface, printed by the test
 * browser through the core's seam (fixtures/printSeam.ts), and written by the core. The files go to
 * build/pdf-export/, where CI's veraPDF step checks them (tools/ci/verapdf.sh).
 *
 * Checked here: the menu entry and the Save dialog's nine sizes with A4 proposed, and the editor's
 * own window when the dialog cannot carry the list; the reference book in every size, each page at
 * the size's exact dimensions, its text read back by pdf.js (tests/pdf/text-compare.mjs); the
 * progress with Cancel, which writes nothing, and the book left as it was; the words the export adds
 * in the book's language; the characters drawn with a system font listed; and no request leaving
 * the machine.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, recordOutside, test, type CoreHandle } from './fixtures/core';
import { expectedText, exportPdfTo, openFixtureBook, type Expected } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-export');

/** D3: the nine sizes as the Save dialog lists them, and their size in points. */
const SIZES: { id: string; label: string; width: number; height: number }[] = [
  { id: 'a4', label: 'A4 (210 × 297 mm)', width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 },
  { id: 'b5', label: 'B5 (176 × 250 mm)', width: (176 * 72) / 25.4, height: (250 * 72) / 25.4 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', width: (148 * 72) / 25.4, height: (210 * 72) / 25.4 },
  { id: 'b6', label: 'B6 (125 × 176 mm)', width: (125 * 72) / 25.4, height: (176 * 72) / 25.4 },
  { id: 'a6', label: 'A6 (105 × 148 mm)', width: (105 * 72) / 25.4, height: (148 * 72) / 25.4 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', width: 612, height: 1008 },
  { id: 'letter', label: 'Letter (8.5 × 11 in)', width: 612, height: 792 },
  { id: 'executive', label: 'Executive (7.25 × 10.5 in)', width: 522, height: 756 },
  { id: 'statement', label: 'Statement (5.5 × 8.5 in)', width: 396, height: 612 },
];

interface TextTools {
  pdfPageTexts(bytes: Uint8Array): Promise<string[]>;
  compareText(
    pages: string[],
    expected: Expected,
  ): {
    ok: boolean;
    missing: string[];
    outOfOrder: string[];
    extra: string[];
    brokenWords: string[];
  };
}
interface PdfJs {
  getDocument(options: { data: Uint8Array; verbosity: number; isEvalSupported: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        view: number[];
        getStructTree(): Promise<StructNode | null>;
      }>;
    }>;
    destroy(): Promise<void>;
  };
}
interface StructNode {
  role?: string;
  alt?: string;
  children?: StructNode[];
}

const textTools = (): Promise<TextTools> =>
  import(pathToFileURL(path.join(ROOT, 'tests', 'pdf', 'text-compare.mjs')).href);
const pdfJs = (): Promise<PdfJs> =>
  import(
    pathToFileURL(path.join(ROOT, 'ui', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))
      .href
  );

/** The page sizes in points, and every Figure's alternative text, as pdf.js reads the file. */
async function readPdf(file: string): Promise<{ sizes: number[][]; figures: string[] }> {
  const { getDocument } = await pdfJs();
  const task = getDocument({
    data: new Uint8Array(readFileSync(file)),
    verbosity: 0,
    isEvalSupported: false,
  });
  const pdf = await task.promise;
  const sizes: number[][] = [];
  const figures: string[] = [];
  const visit = (node: StructNode | null | undefined): void => {
    if (!node) return;
    if (node.role === 'Figure' && node.alt) figures.push(node.alt);
    for (const child of node.children ?? []) visit(child);
  };
  for (let n = 1; n <= pdf.numPages; n++) {
    const pdfPage = await pdf.getPage(n);
    sizes.push([pdfPage.view[2] - pdfPage.view[0], pdfPage.view[3] - pdfPage.view[1]]);
    visit(await pdfPage.getStructTree());
  }
  await task.destroy();
  return { sizes, figures };
}

/** What the export must leave as it was: the book's text, file, title and undo state. */
async function trace(core: CoreHandle, page: Page, book: string) {
  await page.getByTestId('menu-edit').click();
  const undo = await page.getByTestId('menu-edit-undo').getAttribute('aria-disabled');
  await page.keyboard.press('Escape');
  return {
    recent: await core.rpc('doc.recent'),
    text: await page.evaluate(() => window.__mfbeTest!.scripts!.toXml()),
    title: await page.title(),
    undo,
    file: readFileSync(book).toString('base64'),
  };
}

/** A copy of the fixture `name` in a scratch folder, with `edit` applied to its text. */
function variant(name: string, file: string, edit: (xml: string) => string): string {
  const copy = path.join(scratchDir('pdf-us1-'), file);
  writeFileSync(copy, edit(readFileSync(fixtureBook(name), 'utf8')), 'utf8');
  return copy;
}

test.describe('US1: export a searchable PDF in a chosen page size (feature 014)', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs the core');
    mkdirSync(OUT, { recursive: true });
  });

  test('the reference book in all nine sizes: exact pages, its text read back whole', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(900_000);
    const outside = await recordOutside(context);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    const { compareText, pdfPageTexts } = await textTools();
    try {
      const book = await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const expected = await expectedText(page, book);
      expect(expected.blocks.length).toBeGreaterThan(20);
      for (const size of SIZES) {
        const target = path.join(OUT, `reference-${size.id}.pdf`);
        await exportPdfTo(core, page, target, size.label);
        const { sizes, figures } = await readPdf(target);
        for (const [width, height] of sizes) {
          expect(width).toBeCloseTo(size.width, 2);
          expect(height).toBeCloseTo(size.height, 2);
        }
        // FR-010: the cover's alternative text, in the book's language (English here).
        expect(figures[0]).toBe('Cover');
        const result = compareText(
          await pdfPageTexts(new Uint8Array(readFileSync(target))),
          expected,
        );
        expect({ size: size.id, ...result }).toEqual({
          size: size.id,
          ok: true,
          missing: [],
          outOfOrder: [],
          extra: [],
          brokenWords: [],
        });
      }
      expect(seam.failed).toEqual([]);
      expect(seam.printed.map((r) => r.paperWidthIn * 72)).toEqual(
        SIZES.map((s) => expect.closeTo(s.width, 6)),
      );

      // D2, D3: the Save dialog offered the nine sizes, A4 proposed, under "Page size:" (records of
      // test.dialogRequests are flat: the request's fields at the top level).
      const requests = await core.rpc<
        {
          method: string;
          encodingChoices?: string[];
          selectedEncoding?: string;
          encodingLabel?: string;
        }[]
      >('test.dialogRequests');
      // The first export proposes A4; later ones the size kept for the book (D25).
      const save = requests.filter((r) => r.method === 'dialog.saveFile')[0];
      expect(save?.encodingChoices).toEqual(SIZES.map((s) => s.label));
      expect(save?.selectedEncoding).toBe('A4 (210 × 297 mm)');
      expect(save?.encodingLabel).toBe('Page size:');
      // FR-084: nothing left the machine.
      expect(outside).toEqual([]);
    } finally {
      await seam.stop();
    }
  });

  test('a book with pictures in A4: the core draws each picture from the book (R4)', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'pictures-alt.fb2');
      const target = path.join(OUT, 'pictures-alt-a4.pdf');
      await exportPdfTo(core, page, target, 'A4 (210 × 297 mm)');
      const text = readFileSync(target).toString('latin1');
      expect(text.startsWith('%PDF-1.7')).toBe(true);
      // The pictures are the core's own image objects, not the browser engine's.
      expect(text).toContain('/MfbeIm');
      expect(seam.printed[0].paperWidthIn).toBeCloseTo(210 / 25.4, 6);
    } finally {
      await seam.stop();
    }
  });

  test("a Save dialog without the list: the size is asked in the editor's own window", async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const target = path.join(OUT, 'reference-letter-own-window.pdf');
      // The test hooks answer without `encoding`, as a dialog that cannot carry the list does.
      await core.enqueueDialog('dialog.saveFile', { path: target });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-export').hover();
      await page.getByTestId('menu-file-export-exportPdf').click();
      const window = page.getByTestId('dialog-pdf-page-size');
      await window.waitFor({ timeout: 30_000 });
      await expect(page.getByTestId('dialog-pdf-page-size-select')).toHaveValue('a4');
      await page.getByTestId('dialog-pdf-page-size-select').selectOption('letter');
      await page.getByTestId('dialog-pdf-page-size-button-ok').click();
      await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}`, {
        timeout: 300_000,
      });
      expect(seam.printed.at(-1)?.paperWidthIn).toBe(8.5);
      expect(seam.printed.at(-1)?.paperHeightIn).toBe(11);

      // Its Cancel writes nothing.
      const never = path.join(OUT, 'never-written.pdf');
      await core.enqueueDialog('dialog.saveFile', { path: never });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-export').hover();
      await page.getByTestId('menu-file-export-exportPdf').click();
      await window.waitFor({ timeout: 30_000 });
      await page.getByTestId('dialog-pdf-page-size-button-cancel').click();
      await expect(window).toBeHidden();
      expect(existsSync(never)).toBe(false);
    } finally {
      await seam.stop();
    }
  });

  test('Cancel during the export writes nothing and leaves the book as it was', async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      const book = path.join(scratchDir('pdf-us1-cancel-'), 'many-sections.fb2');
      copyFileSync(fixtureBook('many-sections.fb2'), book);
      await openFixtureBook(core, page, book);
      const before = await trace(core, page, book);
      const target = path.join(OUT, 'cancelled.pdf');
      await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'A6 (105 × 148 mm)' });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-export').hover();
      await page.getByTestId('menu-file-export-exportPdf').click();
      // D4: the progress, with Cancel.
      await page.getByTestId('modal-job').waitFor({ timeout: 30_000 });
      await page.getByTestId('modal-job-cancel').click({ timeout: 10_000 });
      await expect(page.getByTestId('modal-job')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByTestId('status-message')).toContainText(
        'The export was cancelled; no file was written.',
      );
      expect(existsSync(target)).toBe(false);
      expect(await trace(core, page, book)).toEqual(before);
    } finally {
      await seam.stop();
    }
  });

  test("the words the export adds follow the book's language; characters no shipped font has are listed", async ({
    core,
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      // FR-010: Russian, and German (which the editor has no words for: English).
      for (const [lang, alt] of [
        ['ru', 'Обложка'],
        ['de', 'Cover'],
      ] as const) {
        const book = variant('reference-all-elements.fb2', `reference-${lang}.fb2`, (xml) =>
          xml.replace('<lang>en</lang>', `<lang>${lang}</lang>`),
        );
        await openFixtureBook(core, page, book);
        const target = path.join(OUT, `reference-${lang}-a5.pdf`);
        await exportPdfTo(core, page, target, 'A5 (148 × 210 mm)');
        expect((await readPdf(target)).figures[0]).toBe(alt);
      }
      // D7: Hebrew is drawn with a system font, and the summary lists its letters.
      const hebrew = variant('reference-all-elements.fb2', 'reference-hebrew.fb2', (xml) =>
        xml.replace('<section', '<section><p>שלום</p></section><section'),
      );
      await openFixtureBook(core, page, hebrew);
      const summary = await exportPdfTo(
        core,
        page,
        path.join(OUT, 'reference-hebrew-a5.pdf'),
        'A5 (148 × 210 mm)',
      );
      expect(summary).toContain('Drawn with a system font');
      expect(summary).toContain('ש ל ו ם');
    } finally {
      await seam.stop();
    }
  });
});
