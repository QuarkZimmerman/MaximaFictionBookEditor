/**
 * Feature 023 (T046, SC-001, SC-002, SC-003): Corpus gate DOCX runs driven by
 * `tests/corpus/docx-runs.py` against the real Release core and built `ui/dist`:
 * - `round-trip`: DOCX export over FB2 list + Calibre `ebook-convert` parse check + re-import
 *   verifying valid originals stay 100% valid FB2 2.1 and invalid originals reopen cleanly;
 * - `import`: foreign Calibre-generated DOCX import verifying valid FB2 2.1 output and zero crashes.
 * Skipped unless `MFBE_CORPUS_MODE` is set.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, shownDocId, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';

const MODE = process.env.MFBE_CORPUS_MODE;
const LIST = process.env.MFBE_CORPUS_LIST;
const OUT = process.env.MFBE_CORPUS_OUT;

interface DocxCorpusResult {
  file: string;
  ms: number;
  exportMs?: number;
  ok: boolean;
  detail?: string;
  invalidOriginal?: boolean;
}

const files = (): string[] =>
  readFileSync(LIST!, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

async function dismissDiscardPromptIfShown(page: Page): Promise<void> {
  const noBtn = page.getByRole('dialog').getByRole('button', { name: 'No' });
  try {
    await noBtn.waitFor({ state: 'visible', timeout: 800 });
    await noBtn.click();
  } catch {
    // No unsaved-changes prompt appeared.
  }
}

async function openFb2(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await dismissDiscardPromptIfShown(page);
  await waitForBook(page, file, 120_000);
}

async function exportDocx(core: CoreHandle, page: Page, target: string): Promise<number> {
  const started = Date.now();
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    zip: false,
    selects: { pageSize: 'a4' },
  });
  await clickExport(core, page, 'exportDocx');
  const summary = page.getByTestId('dialog-docx-export-summary');
  const failed = page.getByTestId('dialog-docx-export-failed');
  const base = path.basename(target);
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          throw new Error(`DOCX export failed: ${await failed.textContent()}`);
        }
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        const status = (await page.getByTestId('status-message').textContent()) ?? '';
        return status.includes('Exported to') && status.includes(base);
      },
      { timeout: 180_000 },
    )
    .toBe(true);
  return Date.now() - started;
}

async function importDocx(
  core: CoreHandle,
  page: Page,
  file: string,
): Promise<{ ok: boolean; error?: string }> {
  const before = await shownDocId(page).catch(() => null);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importDocx').click();
  await dismissDiscardPromptIfShown(page);

  const summary = page.getByTestId('dialog-docx-import-summary');
  const failed = page.getByTestId('dialog-docx-import-failed');
  let outcome: { ok: boolean; error?: string } = { ok: false };
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          const msg = (await failed.textContent()) ?? 'import failed';
          await failed.getByRole('button').first().click();
          await failed.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
          outcome = { ok: false, error: msg.trim() };
          return true;
        }
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          await summary.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
          outcome = { ok: true };
          return true;
        }
        const cur = await shownDocId(page).catch(() => null);
        if (cur && cur !== before) {
          outcome = { ok: true };
          return true;
        }
        return false;
      },
      { timeout: 180_000 },
    )
    .toBe(true);

  if (outcome.ok) {
    // Summary modal opens right after `loadImported`; wait briefly and dismiss if it appears.
    if (
      await summary.waitFor({ state: 'visible', timeout: 300 }).then(
        () => true,
        () => false,
      )
    ) {
      await summary.getByRole('button').first().click();
      await summary.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    }
    await expect.poll(() => shownDocId(page).catch(() => null), { timeout: 10_000 }).not.toBeNull();
  }
  return outcome;
}

async function validateCurrentBook(
  core: CoreHandle,
  page: Page,
): Promise<{ valid: boolean; text: string }> {
  const docId = await shownDocId(page);
  if (docId) {
    const res = await core.rpc<
      | {
          errorCount: number;
          issues: Array<{
            severity: string;
            code?: string;
            message?: string;
            params?: { message?: string; code?: string };
          }>;
        }
      | { jobId: string }
    >('doc.validate', { docId });
    if ('errorCount' in res && Array.isArray(res.issues)) {
      if (res.errorCount === 0) return { valid: true, text: 'No errors' };
      const errs = res.issues
        .filter((i) => i.severity === 'error')
        .slice(0, 3)
        .map((i) => i.params?.message || i.message || `${i.code ?? '?'}:${i.params?.code ?? ''}`);
      return { valid: false, text: `${res.errorCount} error(s): ${errs.join(' | ')}` };
    }
  }
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByTestId('status-message')).toContainText(
    /No errors|error found|errors found|valid/i,
    { timeout: 30_000 },
  );
  const text = ((await page.getByTestId('status-message').textContent()) ?? '').trim();
  return { valid: /No errors|valid/i.test(text), text };
}

function calibreDocxCheck(docxPath: string, tmpTxt: string): string | null {
  try {
    execFileSync('ebook-convert', [docxPath, tmpTxt], { stdio: 'pipe', timeout: 120_000 });
    if (!existsSync(tmpTxt) || readFileSync(tmpTxt, 'utf8').trim().length === 0) {
      return 'ebook-convert produced empty text';
    }
    return null;
  } catch (err) {
    return `Calibre failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

test.describe('corpus gate - DOCX (feature 023)', () => {
  test.use({ actionTimeout: 60_000 });

  test.beforeEach(({ core }) => {
    test.skip(!MODE || !LIST || !OUT || !core.hasCore, 'corpus gate sets MFBE_CORPUS_MODE');
  });

  test('the DOCX corpus run', async ({ core, page }) => {
    test.setTimeout(6 * 60 * 60 * 1000);
    mkdirSync(OUT!, { recursive: true });
    await core.openApp(page);
    const results: DocxCorpusResult[] = [];

    for (const [index, file] of files().entries()) {
      const started = Date.now();
      const push = (ok: boolean, detail?: string, extra: Partial<DocxCorpusResult> = {}) => {
        results.push({
          file,
          ms: Date.now() - started,
          ok,
          ...(detail ? { detail } : {}),
          ...extra,
        });
      };

      try {
        if (MODE === 'import') {
          const imp = await importDocx(core, page, file);
          if (!imp.ok) {
            push(false, imp.error ?? 'refused');
            continue;
          }
          const val = await validateCurrentBook(core, page);
          push(val.valid, val.valid ? undefined : `validation: ${val.text}`);
          continue;
        }

        await openFb2(core, page, file);
        const origVal = await validateCurrentBook(core, page);

        const outDocx = path.join(OUT!, `${index}.docx`);
        const exportMs = await exportDocx(core, page, outDocx);

        const calErr = calibreDocxCheck(outDocx, path.join(OUT!, `${index}.txt`));

        const imp = await importDocx(core, page, outDocx);
        if (!imp.ok) {
          push(false, `re-import failed: ${imp.error ?? '?'}`, {
            exportMs,
            invalidOriginal: !origVal.valid,
          });
          continue;
        }
        const backVal = await validateCurrentBook(core, page);
        const problems: string[] = [];
        if (calErr) problems.push(calErr);
        if (origVal.valid && !backVal.valid) {
          problems.push(`round-trip validation failed: ${backVal.text}`);
        }
        push(problems.length === 0, problems.join('; ') || undefined, {
          exportMs,
          invalidOriginal: !origVal.valid,
        });
      } catch (error) {
        push(false, String(error).split('\n')[0]);
        await core.openApp(page).catch(() => undefined);
      } finally {
        writeFileSync(path.join(OUT!, 'results.json'), JSON.stringify(results, null, 1));
      }
    }

    writeFileSync(path.join(OUT!, 'results.json'), JSON.stringify(results, null, 1));
    expect(results.length).toBeGreaterThan(0);
  });
});
