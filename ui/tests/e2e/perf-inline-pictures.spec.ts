/**
 * Performance journey of inline pictures at their natural size (feature 007, T107; FR-060 to
 * FR-063 against the constitution's budgets; tagged `@perf`, so CI runs it apart from the
 * journeys). The book is `tests/fixtures/books/many-inline-pictures.fb2`: 300 inline pictures
 * of 800 x 600 in running text, each now shown at its natural size (before feature 007 they
 * were 1.6em high). Checks:
 *   - File > Open until the Body view is editable within 3 s (the budget of a book this size);
 *   - scrolling the Body view from top to bottom a screen at a time: every step painted within
 *     100 ms (x `MFBE_PERF_FACTOR` on hosted runners, docs/performance.md), the reserved boxes
 *     keeping the layout from jumping while pictures load;
 *   - a keystroke in a paragraph that holds pictures within 100 ms (median of 10).
 * Needs the real core; run it against the Release core
 * (MFBE_CORE_BIN=../build/linux-core-release/bin/mfbe-core).
 */

import { expect, fixtureBook, test, waitForBook } from './fixtures/core';

const EDITABLE_BUDGET_MS = 3000;
const INTERACTION_BUDGET_MS = 100;
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
/**
 * The slowest scroll step on GitHub's macOS runners (virtual machines without a GPU) is allowed
 * four times the interaction budget instead of `PERF_FACTOR` (requester, 2026-11-03): there it is
 * 190-290 ms, before feature 008 as after it, against 33 ms on Linux. A step that hangs still
 * fails, after `STUCK_STEP_MS`, with a message of its own.
 */
const SCROLL_FACTOR =
  process.platform === 'darwin' && process.env.CI === 'true'
    ? Math.max(PERF_FACTOR, 4)
    : PERF_FACTOR;
const STUCK_STEP_MS = 5000;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** In-page: scrolls the Body panel one screen down and waits for the painted frame. */
const SCROLL_STEP = `(async () => {
  // The Body view's scroll container: the editor's nearest ancestor that scrolls.
  let panel = document.querySelector('[data-testid="body-editor"]');
  while (panel && !(panel.scrollHeight > panel.clientHeight + 1 &&
      ['auto', 'scroll'].includes(getComputedStyle(panel).overflowY))) {
    panel = panel.parentElement;
  }
  if (!panel) return { ms: 0, atEnd: true };
  const start = performance.now();
  panel.scrollTop += panel.clientHeight;
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return {
    ms: performance.now() - start,
    atEnd: panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2,
  };
})()`;

/** In-page keystroke timing, as perf-large-book.spec.ts measures it. */
const TYPE_AND_MEASURE = `(async () => {
  const start = performance.now();
  document.execCommand('insertText', false, 'x');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;

test.describe(
  'performance - 300 inline pictures at their natural size (FR-060)',
  { tag: '@perf' },
  () => {
    test('opens within 3 s, scrolls and types within 100 ms', async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs the real core (MFBE_CORE_BIN)');
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1280, height: 800 });
      await core.openApp(page);
      const book = fixtureBook('many-inline-pictures.fb2');
      await core.enqueueDialog('dialog.openFile', { paths: [book] });
      const started = Date.now();
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, 'many-inline-pictures.fb2', EDITABLE_BUDGET_MS * 4);
      const editor = page.getByTestId('body-editor');
      await expect(editor).toHaveAttribute('contenteditable', 'true', {
        timeout: EDITABLE_BUDGET_MS * 4,
      });
      await expect(editor.locator('.fb-inline-image img').first()).toBeVisible();
      const editableAfterMs = Date.now() - started;

      // The pictures show at their natural size: 800 x 600 in a text area at least that wide,
      // else scaled to its width.
      const first = await editor
        .locator('.fb-inline-image img')
        .first()
        .evaluate((img) => {
          const r = img.getBoundingClientRect();
          const p = img.closest('p')!;
          return { width: r.width, height: r.height, area: p.clientWidth };
        });
      const expected = Math.min(800, first.area);
      expect(Math.abs(first.width - expected)).toBeLessThanOrEqual(1);
      expect(Math.abs(first.height - (expected * 600) / 800)).toBeLessThanOrEqual(1);

      // Scrolling from the top to the bottom, a screen at a time.
      const steps: number[] = [];
      for (let i = 0; i < 400; i += 1) {
        const step = (await Promise.race([
          page.evaluate(SCROLL_STEP),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `scroll step ${i + 1} did not finish within ${STUCK_STEP_MS} ms - stuck`,
                  ),
                ),
              STUCK_STEP_MS,
            ),
          ),
        ])) as { ms: number; atEnd: boolean };
        steps.push(step.ms);
        if (step.atEnd) break;
      }
      const worstStep = Math.max(...steps);

      // A keystroke in a paragraph that holds pictures.
      const paragraph = editor.locator('p:has(.fb-inline-image)').first();
      await paragraph.scrollIntoViewIfNeeded();
      await paragraph.click({ position: { x: 4, y: 4 } });
      await page.evaluate(TYPE_AND_MEASURE);
      const strokes: number[] = [];
      for (let i = 0; i < 10; i += 1)
        strokes.push((await page.evaluate(TYPE_AND_MEASURE)) as number);

      const summary =
        `editable after ${editableAfterMs} ms; ${steps.length} scroll steps, median ` +
        `${median(steps).toFixed(0)} ms, worst ${worstStep.toFixed(0)} ms; keystroke median ` +
        `${median(strokes).toFixed(1)} ms, worst ${Math.max(...strokes).toFixed(1)} ms`;
      test.info().annotations.push({ type: 'perf', description: summary });
      console.log(`inline pictures: ${summary}`);

      expect(editableAfterMs, 'time until the Body view is editable').toBeLessThan(
        EDITABLE_BUDGET_MS,
      );
      expect(steps.length).toBeGreaterThan(5);
      expect(worstStep, 'the slowest scroll step').toBeLessThan(
        INTERACTION_BUDGET_MS * SCROLL_FACTOR,
      );
      expect(median(strokes), 'keystroke latency (median)').toBeLessThan(INTERACTION_BUDGET_MS);
    });
  },
);
