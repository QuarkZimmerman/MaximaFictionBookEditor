/**
 * Script benchmark (feature 002, T054; SC-008, FR-050): the bundled non-interactive clean-up
 * scripts on the generated 1 MB and 10 MB books of `tests/bench/gen-text-book.py` (5,000 and
 * 50,000 paragraphs carrying what the scripts change). Each script runs through
 * `window.__mfbeTest.scripts.run` on the unchanged book (Undo after every run) and is timed in
 * the page from the start of the run to its end, the final report message answered at once.
 *
 * Assertions (every change, CI): a script's 10 MB time is at most 12 times its 1 MB time, and
 * its 1 MB time is under 5 s x `MFBE_PERF_FACTOR` (default 2, the gap between the CI runners
 * and a 2020-era laptop, docs/performance.md). With `MFBE_PERF_RESULTS=<file>` the measured
 * times are also written there as JSON (the release workflow records them). Tagged `@perf`:
 * CI runs it apart from the journeys, on one worker. Needs the real core and `python3`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = path.join(REPO_ROOT, 'tests', 'bench', 'gen-text-book.py');
const BOOKS_DIR = path.join(REPO_ROOT, 'tests', 'bench', 'books');

/** The generated books, smallest first (gen-text-book.py names them `clean-<size>.fb2`). */
const BOOKS = ['1mb', '10mb'] as const;
type BookSize = (typeof BOOKS)[number];

/**
 * The bundled clean-up scripts that work through the whole book without asking anything
 * (docs/performance.md names the excluded ones and why).
 */
const BENCHMARK_SCRIPTS = [
  '06/general-cleanup',
  '06/latin-to-cyrillic',
  '06/external-links-to-text',
  '06/remove-style-tags',
  '12/place-quotes',
  '12/place-guillemets-only',
  '13/subtitles-empty-lines',
  '13/subtitles-empty-lines-unbold-titles',
  '13/subtitles-empty-lines-plain-titles',
] as const;

/** SC-008: a 1 MB run finishes in 5 s on a 2020-era laptop. */
const LAPTOP_BUDGET_MS = 5_000;
/** SC-008: the 10 MB run takes at most this many times the 1 MB run. */
const MAX_SIZE_RATIO = 12;
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;

/**
 * Runs one script through the test hooks and times it in the page. Report messages are
 * answered as soon as they appear (their first button); a prompt or a form means the script
 * is not a non-interactive one: the run is cancelled and reported. Error dialogs are closed so
 * the run can end.
 */
const RUN_AND_MEASURE = `(async (scriptId) => {
  const hooks = window.__mfbeTest.scripts;
  let asked = false;
  const answer = () => {
    for (const id of ['dialog-script-message', 'dialog-script-error']) {
      const dialog = document.querySelector('[data-testid="' + id + '"]');
      const button = dialog && dialog.querySelector('[data-testid^="' + id + '-button-"]');
      if (button) button.click();
    }
    if (document.querySelector('[data-testid="dialog-script-prompt"], [data-testid="dialog-script-form"]')) {
      if (!asked) {
        asked = true;
        hooks.cancel();
      }
    }
  };
  const observer = new MutationObserver(answer);
  observer.observe(document.body, { childList: true, subtree: true });
  const started = performance.now();
  try {
    const result = await hooks.run(scriptId);
    return {
      ms: performance.now() - started,
      status: result.status,
      message: result.message ?? null,
      asked,
    };
  } finally {
    observer.disconnect();
  }
})`;

interface Measurement {
  ms: number;
  status: string;
  message: string | null;
  asked: boolean;
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      list(): { id: string }[];
      document(): { docId: string; path?: string } | null;
      state(): { status: string } | null;
    };
  };
};

function bookPath(size: BookSize): string {
  return path.join(BOOKS_DIR, `clean-${size}.fb2`);
}

async function openBook(page: Page, core: CoreHandle, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  // The runs and their undo left the previous book modified: do not save it.
  const asked = await page
    .getByTestId('dialog-save-changes')
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await page.getByTestId('dialog-save-changes-button-no').click();
  await expect
    .poll(() => page.evaluate(() => window.__mfbeTest?.scripts?.document()?.path ?? null), {
      timeout: 60_000,
    })
    .toBe(file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
}

/** Takes the book back to its state before the run (one Undo per run). */
async function undoRun(page: Page): Promise<void> {
  const undo = page.getByTestId('toolbar-edit.undo');
  if (await undo.isEnabled()) {
    await undo.click();
    await expect(undo).toBeDisabled({ timeout: 30_000 });
  }
}

test.describe('script benchmark', { tag: '@perf' }, () => {
  test.beforeAll(() => {
    mkdirSync(BOOKS_DIR, { recursive: true });
    if (BOOKS.every((size) => existsSync(bookPath(size)))) return;
    spawnSync('python3', [GENERATOR, '--out-dir', BOOKS_DIR], { encoding: 'utf8' });
  });

  test('bundled clean-up scripts: 1 MB within budget, 10 MB within 12 times the 1 MB time', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(
      !BOOKS.every((size) => existsSync(bookPath(size))),
      'python3 / the book generator are not available',
    );
    test.setTimeout(20 * 60_000);

    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await expect
      .poll(() => page.evaluate(() => window.__mfbeTest?.scripts?.list().length ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const listed = await page.evaluate(
      () => window.__mfbeTest?.scripts?.list().map((s) => s.id) ?? [],
    );
    for (const id of BENCHMARK_SCRIPTS) expect(listed, `${id} is bundled`).toContain(id);

    const times: Record<string, Partial<Record<BookSize, Measurement>>> = {};
    for (const size of BOOKS) {
      await openBook(page, core, bookPath(size));
      for (const id of BENCHMARK_SCRIPTS) {
        const measured = await page.evaluate<Measurement>(
          `${RUN_AND_MEASURE}(${JSON.stringify(id)})`,
        );
        (times[id] ??= {})[size] = measured;
        test.info().annotations.push({
          type: 'perf',
          description: `${id} ${size}: ${Math.round(measured.ms)} ms (${measured.status})`,
        });
        await undoRun(page);
      }
    }

    const results = BENCHMARK_SCRIPTS.map((id) => ({
      script: id,
      '1mb': Math.round(times[id]!['1mb']!.ms),
      '10mb': Math.round(times[id]!['10mb']!.ms),
    }));
    const file = process.env.MFBE_PERF_RESULTS;
    if (file) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify({ perfFactor: PERF_FACTOR, maxRatio: MAX_SIZE_RATIO, results }, null, 2)}\n`,
      );
    }

    for (const id of BENCHMARK_SCRIPTS) {
      for (const size of BOOKS) {
        const measured = times[id]![size]!;
        expect(measured.asked, `${id} (${size}) asked the user something`).toBe(false);
        expect(measured.status, `${id} (${size}): ${measured.message ?? ''}`).toBe('done');
      }
      const small = times[id]!['1mb']!.ms;
      const large = times[id]!['10mb']!.ms;
      expect(small, `${id}: 1 MB time`).toBeLessThan(LAPTOP_BUDGET_MS * PERF_FACTOR);
      expect(large, `${id}: 10 MB time (1 MB: ${Math.round(small)} ms)`).toBeLessThanOrEqual(
        MAX_SIZE_RATIO * small,
      );
    }
  });
});
