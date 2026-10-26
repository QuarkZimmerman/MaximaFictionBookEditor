/**
 * Feature 006, User Story 2 - the seeded fuzz of SC-003 in the page (T073; FR-035, FR-045,
 * FR-046; C76; I27; data-model §16.4; quickstart §2 "Automated", §13, §17; research R8.15).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. A small valid book - a complete description and one section with one
 * paragraph - is written into a temporary folder and opened through File → Open; then
 * `__mfbeTest.tables.fuzz(seed, 1000)` runs 1,000 random commands on the Body editor (seed 6, or
 * `MFBE_FUZZ_SEED`), Undo and Redo of random steps included, on tables up to 12 × 12, and the
 * core validates the document after every step (`doc.validate`, 0 errors). A failure prints the
 * seed, the step, the command and the table before and after it as model JSON. 1,000 core
 * validations do not fit the default time-out, so the journey sets its own (quickstart open
 * point 8).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, waitForBook } from './fixtures/core';

interface FuzzReport {
  seed: number;
  steps: number;
  validations: number;
  failures: unknown[];
  commands: string[];
}

declare const window: {
  __mfbeTest?: {
    scripts?: { document(): { docId: string } };
    tables?: { fuzz(seed: number, steps: number): Promise<FuzzReport> };
  };
};

/** A valid FB2 book: a complete description and one section with one paragraph. */
function book(dir: string): string {
  const file = path.join(dir, 'fuzz.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Tables fuzz</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>tables-fuzz-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section><p>Only text.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

test.describe('US2 (feature 006) - the seeded fuzz in the page', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us2-fuzz-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('1,000 random commands on the Body editor, each step validated by the core', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.setTimeout(process.env.CI ? 600_000 : 300_000);
    const seed = Number(process.env.MFBE_FUZZ_SEED ?? 6);
    const file = book(dir);
    await core.openApp(page);
    await core.enqueueDialog('dialog.openFile', { paths: [file] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, file);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof window.__mfbeTest?.tables?.fuzz === 'function' &&
            typeof window.__mfbeTest?.scripts?.document === 'function',
        ),
      )
      .toBe(true);

    const report = await page.evaluate(([s, steps]) => window.__mfbeTest!.tables!.fuzz(s, steps), [
      seed,
      1000,
    ] as const);
    expect(report.failures, JSON.stringify(report.failures[0] ?? null, null, 1)).toEqual([]);
    expect(report.seed).toBe(seed);
    expect(report.steps).toBe(1000);
    expect(report.validations).toBe(1000);

    // The final document once more, from the test.
    const document = await page.evaluate(() => window.__mfbeTest!.scripts!.document());
    const result = await core.rpcJob<{ errorCount: number }>('doc.validate', {
      docId: document.docId,
      document,
    });
    expect(result.errorCount).toBe(0);
  });
});
