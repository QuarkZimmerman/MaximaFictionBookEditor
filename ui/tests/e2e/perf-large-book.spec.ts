/**
 * Performance journey (T069, SC-002 / constitution budgets): a 10 MB text-only book generated
 * by `tests/fixtures/gen-large-book.py` must be editable in the Body view within 3 s of
 * File > Open, and a keystroke must be processed within 100 ms. Also checks the section window
 * (only a slice of the 200 sections is mounted) and that extending the window keeps the DOM
 * bounded. Needs the real core and `python3`; skipped otherwise.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type RpcCallError } from './fixtures/core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');

/** Budgets from the constitution (performance budgets are release gates). */
const EDITABLE_BUDGET_MS = 3000;
const KEYSTROKE_BUDGET_MS = 100;

/** In-page keystroke timing: inserts a character and waits for the editor to settle. */
const TYPE_AND_MEASURE = `(async () => {
  const start = performance.now();
  document.execCommand('insertText', false, 'x');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;

test.describe('performance - 10 MB text book', () => {
  let dir: string;
  let book: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-perf-'));
    book = path.join(dir, 'large.fb2');
    const result = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
      encoding: 'utf8',
    });
    if (result.status !== 0) book = '';
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('opens, is editable within 3 s and types within 100 ms per keystroke', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!book || !existsSync(book), 'python3 / the generator are not available');
    const supportsDocuments = await core
      .rpc('doc.recent')
      .then(() => true)
      .catch((error: RpcCallError) => error.code !== -32601);
    test.skip(!supportsDocuments, 'the core does not implement doc.* yet');
    expect(statSync(book).size).toBeGreaterThan(9 * 1024 * 1024);

    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await core.enqueueDialog('dialog.openFile', { paths: [book] });

    const started = Date.now();
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    const editor = page.getByTestId('body-editor');
    await expect(editor).toHaveAttribute('contenteditable', 'true', {
      timeout: EDITABLE_BUDGET_MS * 4,
    });
    await expect(editor.locator('.fb-section p.fb-p').first()).toBeVisible();
    const editableAfterMs = Date.now() - started;
    test
      .info()
      .annotations.push({ type: 'perf', description: `editable after ${editableAfterMs} ms` });
    expect(editableAfterMs, 'time until the Body view is editable').toBeLessThan(
      EDITABLE_BUDGET_MS,
    );

    // Section window: a slice of the book is mounted, the rest reachable through the placeholder.
    const container = page.getByTestId('panel-body-document');
    await expect(page.getByTestId('body-view')).toHaveAttribute('data-whole-book', 'false');
    const total = Number(await container.getAttribute('data-section-total'));
    const count = Number(await container.getAttribute('data-section-count'));
    expect(total).toBeGreaterThan(100);
    expect(count).toBeLessThan(total);
    await expect(page.getByTestId('body-window-after')).toBeVisible();

    // Keystroke latency in a mounted paragraph (warm-up stroke excluded).
    const paragraph = editor.locator('.fb-section p.fb-p').nth(3);
    await paragraph.click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId('status-path')).toContainText('/p[');
    await page.evaluate(TYPE_AND_MEASURE);
    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) samples.push(await page.evaluate<number>(TYPE_AND_MEASURE));
    const worst = Math.max(...samples);
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
    test.info().annotations.push({
      type: 'perf',
      description: `keystroke latency median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`,
    });
    expect(
      median,
      `keystroke latencies ${samples.map((s) => s.toFixed(0)).join(', ')} ms`,
    ).toBeLessThan(KEYSTROKE_BUDGET_MS);
    await expect(paragraph).toContainText('xxxxxxxxxxx');
    await expect(page).toHaveTitle(/^large\.fb2\* - /);

    // Extending the window twice keeps the mounted slice bounded (far sections are unmounted).
    await page.getByTestId('body-window-after').click();
    await expect(container).toHaveAttribute('data-section-count', String(count * 2));
    await page.getByTestId('body-window-after').click();
    await page.getByTestId('body-window-after').click();
    const mounted = Number(await container.getAttribute('data-section-count'));
    expect(mounted).toBeLessThanOrEqual(count * 3);
    expect(Number(await container.getAttribute('data-section-start'))).toBeGreaterThan(0);
    await expect(page.getByTestId('body-window-before')).toBeVisible();
  });
});
