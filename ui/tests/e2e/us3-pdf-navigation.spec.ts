/**
 * Feature 014, User Story 3 (tasks T038, T042): bookmarks, links and notes. pdf.js reads the exported
 * files back: the outline as the book's contents; every link leading to a destination of the file;
 * each note at the foot of the page that refers to it, its label leading back; notes nothing refers
 * to after the text; a reference to a missing note kept as text and listed; and the structure the
 * engine tagged (D20): headings, paragraphs, figures with their text, tables and links.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, fixtureBook, test } from './fixtures/core';
import { expectedText, exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-export');

interface OutlineItem {
  title: string;
  dest: unknown;
  items: OutlineItem[];
}
interface Annotation {
  subtype: string;
  dest?: unknown;
  url?: string;
}
interface StructNode {
  role?: string;
  alt?: string;
  children?: StructNode[];
}
interface PdfPage {
  getTextContent(o: { disableNormalization: boolean }): Promise<{ items: { str?: string }[] }>;
  getAnnotations(): Promise<Annotation[]>;
  getStructTree(): Promise<StructNode | null>;
}
interface Pdf {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getOutline(): Promise<OutlineItem[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

async function open(file: string): Promise<{ pdf: Pdf; close: () => Promise<void> }> {
  const { getDocument } = (await import(
    pathToFileURL(path.join(ROOT, 'ui', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))
      .href
  )) as {
    getDocument(o: { data: Uint8Array; verbosity: number; isEvalSupported: boolean }): {
      promise: Promise<Pdf>;
      destroy(): Promise<void>;
    };
  };
  const task = getDocument({
    data: new Uint8Array(readFileSync(file)),
    verbosity: 0,
    isEvalSupported: false,
  });
  return { pdf: await task.promise, close: () => task.destroy() };
}

async function pageOf(pdf: Pdf, dest: unknown): Promise<number> {
  const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[]);
  expect(explicit, `destination ${JSON.stringify(dest)}`).toBeTruthy();
  return (await pdf.getPageIndex(explicit![0])) + 1;
}

test.describe('US3: bookmarks, links and notes (feature 014)', () => {
  test('the reference book: outline, links, footnotes and structure', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const target = path.join(OUT, 'navigation-a5.pdf');
      await exportPdfTo(core, page, target, 'A5 (148 × 210 mm)');
      const { pdf, close } = await open(target);
      try {
        // D17: the cover page, the title page, then the sections nested.
        const outline = (await pdf.getOutline()) ?? [];
        expect(outline.slice(0, 2).map((item) => item.title)).toEqual(['Cover', 'Title page']);
        expect(await pageOf(pdf, outline[0].dest)).toBe(1);
        expect(await pageOf(pdf, outline[1].dest)).toBe(2);
        const part = outline.find((item) => item.title === 'Part Two');
        expect(part?.items.map((item) => item.title)).toContain('Chapter Two');

        // D18, D19: every internal link resolves; each note is on the page that refers to it.
        let notesSeen = 0;
        let backLinks = 0;
        const roles = new Map<string, number>();
        const visit = (node: StructNode | null | undefined): void => {
          if (!node) return;
          if (node.role) roles.set(node.role, (roles.get(node.role) ?? 0) + 1);
          for (const child of node.children ?? []) visit(child);
        };
        for (let n = 1; n <= pdf.numPages; n++) {
          const pdfPage = await pdf.getPage(n);
          const text = (await pdfPage.getTextContent({ disableNormalization: true })).items
            .map((item) => item.str ?? '')
            .join('');
          for (const annotation of await pdfPage.getAnnotations()) {
            if (annotation.subtype !== 'Link' || annotation.url) continue;
            const to = await pageOf(pdf, annotation.dest);
            if (typeof annotation.dest === 'string' && /^mfbe-ref-/.test(annotation.dest)) {
              // A footnote's label leads back to its reference, on the same page here.
              expect(to).toBe(n);
              backLinks++;
            }
            if (annotation.dest === 'n1' || annotation.dest === 'n2') {
              expect(to).toBe(n);
              notesSeen++;
            }
          }
          if (text.includes('The first note.')) expect(text).toContain('A note');
          visit(await pdfPage.getStructTree());
        }
        expect(notesSeen).toBe(2);
        expect(backLinks).toBe(2);
        // D20 (T042): the structure the engine tagged.
        for (const role of ['H1', 'H2', 'P', 'Figure', 'Table', 'TR', 'TD', 'Link']) {
          expect(roles.get(role) ?? 0, role).toBeGreaterThan(0);
        }
      } finally {
        await close();
      }
    } finally {
      await seam.stop();
    }
  });

  test('notes nothing refers to come after the text; a missing note is listed', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      const book = path.join(scratchDir('pdf-us3-'), 'notes-variant.fb2');
      writeFileSync(
        book,
        readFileSync(fixtureBook('reference-all-elements.fb2'), 'utf8')
          .replace(
            '<section id="n2">',
            '<section id="n3"><p>A note nothing refers to.</p></section><section id="n2">',
          )
          .replace(
            'a second note<a',
            'a missing note<a l:href="#nope" type="note">[9]</a>, a second note<a',
          ),
        'utf8',
      );
      await openFixtureBook(core, page, book);
      const target = path.join(OUT, 'navigation-notes-a5.pdf');
      const summary = await exportPdfTo(core, page, target, 'A5 (148 × 210 mm)');
      expect(summary).toContain('Link to #nope written as text');
      const { pdf, close } = await open(target);
      try {
        const last = await pdf.getPage(pdf.numPages);
        const text = (await last.getTextContent({ disableNormalization: true })).items
          .map((item) => item.str ?? '')
          .join(' ');
        expect(text).toContain('Notes');
        expect(text).toContain('A note nothing refers to.');
        const outline = (await pdf.getOutline()) ?? [];
        expect(outline.at(-1)?.title).toBe('Notes');
      } finally {
        await close();
      }
    } finally {
      await seam.stop();
    }
  });

  test('a note longer than the room at its page foot continues at the next one (D19)', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      const sentence = 'This long note goes on at the foot of the next page. ';
      const book = path.join(scratchDir('pdf-us3-long-'), 'long-note.fb2');
      writeFileSync(
        book,
        readFileSync(fixtureBook('reference-all-elements.fb2'), 'utf8').replace(
          '<section id="n2">',
          `<section id="n2"><p>The start of the long note. ${sentence.repeat(60)}The end of the long note.</p>`,
        ),
        'utf8',
      );
      await openFixtureBook(core, page, book);
      const expected = path.join(OUT, 'navigation-long-note-a6.expected.json');
      writeFileSync(expected, JSON.stringify(await expectedText(page, book)));
      const target = path.join(OUT, 'navigation-long-note-a6.pdf');
      await exportPdfTo(core, page, target, 'A6 (105 × 148 mm)');
      const { pdf, close } = await open(target);
      try {
        const texts: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const items = (
            await (await pdf.getPage(n)).getTextContent({ disableNormalization: true })
          ).items;
          texts.push(items.map((item) => item.str ?? '').join(' '));
        }
        const first = texts.findIndex((t) => t.includes('The start of the long note.'));
        const last = texts.findIndex((t) => t.includes('The end of the long note.'));
        expect(first).toBeGreaterThanOrEqual(0);
        // Its start at the foot of the page that refers to it, its end at a later page's foot.
        expect(last).toBeGreaterThan(first);
      } finally {
        await close();
      }
      // The whole text reads back, the long note's parts joined across the pages.
      const compare = spawnSync(
        'node',
        [path.join(ROOT, 'tests', 'pdf', 'text-compare.mjs'), target, expected],
        {
          encoding: 'utf8',
        },
      );
      expect(compare.stdout + compare.stderr).toContain('in order, words whole');
    } finally {
      await seam.stop();
    }
  });
});
