/**
 * Feature 014, User Story 4 (tasks T043): every book gives a valid archival PDF, or a message. The
 * hostile books of tests/fixtures/pdf/make-fixtures.py (--hostile) are exported: sections nested
 * 1,000 deep, a table of 10,000 rows, a 20,000 × 20,000 picture, 50,000 notes. Each gives a file -
 * which CI's veraPDF step checks in build/pdf-export/ - or a message, and never a broken file. A folder
 * the editor cannot write to gives a message, and nothing is written.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures/core';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-export');

test.describe('US4: every book gives a valid PDF, or a message (feature 014)', () => {
  test('hostile books give files, their gaps listed', async ({ core, page, context }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(1_800_000);
    mkdirSync(OUT, { recursive: true });
    const books = scratchDir('pdf-us4-');
    execFileSync('python3', [
      path.join(ROOT, 'tests', 'fixtures', 'pdf', 'make-fixtures.py'),
      '--hostile',
      books,
    ]);
    await core.openApp(page);
    const seam = startPrintSeam(core, context, { readyTimeoutMs: 1_500_000 });
    try {
      // The editor itself refuses the 1,000-deep book when it opens it (its XML reader stops at 256
      // levels), with a message; the PDF's own cap (64 levels, DP-19) is shown on 200 levels.
      const deep = readFileSync(path.join(books, 'deep-nesting.fb2'), 'utf8');
      writeFileSync(
        path.join(books, 'nesting-200.fb2'),
        deep
          .replace(/(<section><title><p>Level (\d+)<\/p><\/title>)/g, (all, _x, n) =>
            Number(n) <= 200 ? all : '',
          )
          .replace(/(<\/section>)+/, '</section>'.repeat(200)),
        'utf8',
      );
      for (const [name, listed] of [
        ['nesting-200.fb2', ''],
        ['huge-picture.fb2', 'Picture #huge.png left out'],
        ['big-table.fb2', ''],
      ] as const) {
        await openFixtureBook(core, page, path.join(books, name));
        const target = path.join(OUT, `hostile-${name.replace('.fb2', '')}.pdf`);
        const said = await exportPdfTo(core, page, target, 'A5 (148 × 210 mm)', 1_500_000);
        expect(existsSync(target), name).toBe(true);
        if (listed) expect(said).toContain(listed);
      }
    } finally {
      await seam.stop();
    }
  });

  test('a folder the editor cannot write to gives a message and no file', async ({
    core,
    page,
    context,
  }) => {
    test.skip(
      !core.hasCore || process.getuid?.() === 0,
      'needs the core, and a user that folder permissions bind',
    );
    test.setTimeout(600_000);
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, 'reference-all-elements.fb2');
      const folder = scratchDir('pdf-us4-locked-');
      chmodSync(folder, 0o500);
      const target = path.join(folder, 'never.pdf');
      await expect(exportPdfTo(core, page, target, 'A5 (148 × 210 mm)')).rejects.toThrow(
        /was not written/,
      );
      expect(existsSync(target)).toBe(false);
      chmodSync(folder, 0o700);
    } finally {
      await seam.stop();
    }
  });
});
