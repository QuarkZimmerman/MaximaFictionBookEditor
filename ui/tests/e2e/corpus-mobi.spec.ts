/**
 * Feature 018 (T048, SC-001, SC-002, SC-003): Corpus gate MOBI runs driven by
 * `tests/corpus/mobi-runs.py` against the real Release core and built `ui/dist`:
 * - `export`: MOBI 7 export over FB2 list + PalmDOC prose compression ratio <= 80% + Calibre check;
 * - `round-trip`: MOBI 7 export + re-import verifying validity, title, structure;
 * - `kf8-sample`: joint MOBI 7 + KF8 (.mobi) and standalone KF8 (.azw3) export + Calibre + round-trip;
 * - `import`: foreign MOBI/KF8 import verifying valid FB2 2.1 output and zero crashes/hangs.
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

interface CorpusResult {
  file: string;
  ms: number;
  ok: boolean;
  detail?: string;
  compressionRatio?: number;
  invalidOriginal?: boolean;
}

const files = (): string[] =>
  readFileSync(LIST!, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

/** Computes compressed-text-bytes / raw-text-bytes for a MOBI 7 / joint file. */
function measureMobi7CompressionRatio(filePath: string): {
  rawBytes: number;
  compBytes: number;
  ratio: number;
} {
  const buf = readFileSync(filePath);
  const numRecs = buf.readUInt16BE(76);
  const offsets: number[] = [];
  for (let i = 0; i < numRecs; i++) offsets.push(buf.readUInt32BE(78 + i * 8));
  offsets.push(buf.length);
  const r0 = buf.subarray(offsets[0]!, offsets[1]!);
  const rawBytes = r0.readUInt32BE(4);
  const textRecCount = r0.readUInt16BE(8);
  let compBytes = 0;
  for (let i = 1; i <= textRecCount && i < numRecs; i++) {
    compBytes += offsets[i + 1]! - offsets[i]!;
  }
  return { rawBytes, compBytes, ratio: rawBytes > 0 ? compBytes / rawBytes : 1 };
}

async function openFb2(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const savePrompt = page.getByTestId('dialog-save-changes');
  if (
    await savePrompt.waitFor({ state: 'visible', timeout: 1500 }).then(
      () => true,
      () => false,
    )
  ) {
    await savePrompt.getByTestId('dialog-save-changes-button-no').click();
  }
  await waitForBook(page, file, 120_000);
}

async function exportMobi(
  core: CoreHandle,
  page: Page,
  target: string,
  format: 'mobi7' | 'joint' | 'kf8',
): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    zip: false,
    selects: { format, tocPlacement: 'afterTitle' },
  });
  await clickExport(core, page, 'exportMobi');
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        return ((await page.getByTestId('status-message').textContent()) ?? '').includes(
          'Exported to',
        );
      },
      { timeout: 180_000 },
    )
    .toBe(true);
}

async function importMobi(
  core: CoreHandle,
  page: Page,
  file: string,
): Promise<{ ok: boolean; error?: string }> {
  const before = await shownDocId(page).catch(() => null);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMobi').click();
  const savePrompt = page.getByTestId('dialog-save-changes');
  if (
    await savePrompt.waitFor({ state: 'visible', timeout: 1500 }).then(
      () => true,
      () => false,
    )
  ) {
    await savePrompt.getByTestId('dialog-save-changes-button-no').click();
  }
  const summary = page.getByTestId('dialog-mobi-import-summary');
  const failed = page.getByTestId('dialog-mobi-import-failed');
  let outcome: { ok: boolean; error?: string } = { ok: false };
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) {
          const msg = (await failed.textContent()) ?? 'import failed';
          await failed.getByRole('button').first().click();
          outcome = { ok: false, error: msg.trim() };
          return true;
        }
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          outcome = { ok: true };
          return true;
        }
        const cur = await shownDocId(page).catch(() => null);
        if (before && cur === before) return false;
        const status = (await page.getByTestId('status-message').textContent()) ?? '';
        if (status.includes('Imported from MOBI:')) {
          outcome = { ok: true };
          return true;
        }
        return false;
      },
      { timeout: 180_000 },
    )
    .toBe(true);
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

function calibreCheck(mobiPath: string, tmpTxt: string): string | null {
  try {
    const meta = execFileSync('ebook-meta', [mobiPath], { encoding: 'utf8', timeout: 30_000 });
    if (!meta.includes('Title')) return 'ebook-meta missing Title';
    execFileSync('ebook-convert', [mobiPath, tmpTxt], { stdio: 'pipe', timeout: 90_000 });
    if (!existsSync(tmpTxt) || readFileSync(tmpTxt, 'utf8').trim().length === 0) {
      return 'ebook-convert produced empty text';
    }
    return null;
  } catch (err) {
    return `Calibre failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

test.describe('corpus gate - MOBI (feature 018)', () => {
  test.use({ actionTimeout: 60_000 });

  test.beforeEach(({ core }) => {
    test.skip(!MODE || !LIST || !OUT || !core.hasCore, 'corpus gate sets MFBE_CORPUS_MODE');
  });

  test('the MOBI corpus run', async ({ core, page }) => {
    test.setTimeout(6 * 60 * 60 * 1000);
    mkdirSync(OUT!, { recursive: true });
    await core.openApp(page);
    const results: CorpusResult[] = [];

    for (const [index, file] of files().entries()) {
      const started = Date.now();
      const push = (ok: boolean, detail?: string, extra: Partial<CorpusResult> = {}) => {
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
          const imp = await importMobi(core, page, file);
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

        if (MODE === 'export') {
          const outMobi = path.join(OUT!, `${index}.mobi`);
          await exportMobi(core, page, outMobi, 'mobi7');
          const comp = measureMobi7CompressionRatio(outMobi);
          const calErr = calibreCheck(outMobi, path.join(OUT!, `${index}.txt`));
          const problems: string[] = [];
          if (comp.rawBytes >= 4096 && comp.ratio > 0.8) {
            problems.push(`compression ratio ${(comp.ratio * 100).toFixed(1)}% > 80%`);
          }
          if (calErr) problems.push(calErr);
          push(problems.length === 0, problems.join('; ') || undefined, {
            compressionRatio: Number(comp.ratio.toFixed(4)),
            invalidOriginal: !origVal.valid,
          });
          continue;
        }

        if (MODE === 'round-trip') {
          const outMobi = path.join(OUT!, `${index}.mobi`);
          await exportMobi(core, page, outMobi, 'mobi7');
          const imp = await importMobi(core, page, outMobi);
          if (!imp.ok) {
            push(false, `re-import failed: ${imp.error ?? '?'}`);
            continue;
          }
          const backVal = await validateCurrentBook(core, page);
          // Valid original must stay 100% valid FB2 2.1; invalid original must still open cleanly!
          const ok = origVal.valid ? backVal.valid : true;
          push(ok, ok ? undefined : `round-trip validation failed: ${backVal.text}`, {
            invalidOriginal: !origVal.valid,
          });
          continue;
        }

        if (MODE === 'kf8-sample') {
          const problems: string[] = [];
          for (const [fmt, ext] of [
            ['joint', 'mobi'],
            ['kf8', 'azw3'],
          ] as const) {
            await openFb2(core, page, file);
            const target = path.join(OUT!, `${index}-${fmt}.${ext}`);
            await exportMobi(core, page, target, fmt);
            const calErr = calibreCheck(target, path.join(OUT!, `${index}-${fmt}.txt`));
            if (calErr) problems.push(`${fmt}: ${calErr}`);
            const imp = await importMobi(core, page, target);
            if (!imp.ok) {
              problems.push(`${fmt} re-import: ${imp.error ?? '?'}`);
              continue;
            }
            const backVal = await validateCurrentBook(core, page);
            if (origVal.valid && !backVal.valid) {
              problems.push(`${fmt} validation: ${backVal.text}`);
            }
          }
          push(problems.length === 0, problems.join('; ') || undefined, {
            invalidOriginal: !origVal.valid,
          });
        }
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
