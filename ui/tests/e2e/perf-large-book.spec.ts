/**
 * Performance journey (T069, SC-002 / constitution budgets): a 10 MB text-only book generated
 * by `tests/fixtures/gen-large-book.py` must be editable in the Body view within 3 s of
 * File > Open, and a keystroke must be processed within 100 ms. Also checks the section window
 * (only a slice of the 200 sections is mounted) and that extending the window keeps the DOM
 * bounded. The second journey (feature 003 US8, FR-074) types in the Source view of the same
 * book: the tag completion list must appear within 300 ms of the last keystroke and keystrokes
 * must stay under 100 ms. The third journey (feature 004 US7, FR-073, tagged `@perf`) switches
 * Body -> Source -> Body with the caret and selection mapping on and off
 * (`__mfbeTest.sourceMapping.enabled`): the mapping step - the difference of the medians - must
 * stay under 100 ms x `MFBE_PERF_FACTOR`, and every `doc.mapPositions` call under 100 ms in the
 * core. Needs the real core and `python3`; skipped otherwise.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, waitForBook, type RpcCallError } from './fixtures/core';
import { LINE_END, LINE_START, MOD } from './fixtures/keys';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');

/** Budgets from the constitution (performance budgets are release gates). */
const EDITABLE_BUDGET_MS = 3000;
const KEYSTROKE_BUDGET_MS = 100;
/** Feature 003 FR-074: the completion list within 300 ms of the last keystroke. */
const COMPLETION_LIST_BUDGET_MS = 300;
/** Feature 004 FR-073: the Body <-> Source mapping step (switch with minus switch without). */
const MAPPING_BUDGET_MS = 100;
/** Hosted CI runners against a 2020-era laptop (docs/performance.md). */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
/** Round trips per mode of the mapping journey. */
const MAPPING_ROUND_TRIPS = 5;

/**
 * In-page timing of one view switch: from the click on the view's tab until the view is shown
 * and loaded (the Source view reports `data-status="ready"` once its text - and the mapped
 * selection - is in; the Body view once its editor is mounted), plus one frame.
 */
const switchTimed = (target: 'source' | 'body') => `(async () => {
  const start = performance.now();
  document.querySelector('[data-testid="view-${target}"]').click();
  const shown = () => ${
    target === 'source'
      ? `document.querySelector('[data-testid="source-view"]')?.getAttribute('data-status') === 'ready'`
      : `!!document.querySelector('[data-testid="body-editor"]')`
  };
  while (!shown()) await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;

/** The core's own time of the last `doc.mapPositions` call the UI made (-1 when none). */
const LAST_MAPPING_MS = `(() => {
  const last = window.__mfbeTest?.sourceMapping?.last;
  return last && typeof last.coreMs === 'number' ? last.coreMs : -1;
})()`;

/** In-page keystroke timing: inserts a character and waits for the editor to settle. */
const typeAndMeasure = (character: string) => `(async () => {
  const start = performance.now();
  document.execCommand('insertText', false, ${JSON.stringify(character)});
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;
const TYPE_AND_MEASURE = typeAndMeasure('x');

/**
 * Records the last keydown made while no list was shown and the moment the list enters the DOM
 * (a keystroke that finds the list already there leaves the measurement alone).
 */
const INSTALL_COMPLETION_TIMER = `(() => {
  const w = window;
  w.__mfbeCompletionTiming = { lastKey: 0, shown: 0 };
  document.addEventListener('keydown', () => {
    if (document.querySelector('.cm-tooltip-autocomplete')) return;
    w.__mfbeCompletionTiming.lastKey = performance.now();
    w.__mfbeCompletionTiming.shown = 0;
  }, true);
  const observer = new MutationObserver(() => {
    const timing = w.__mfbeCompletionTiming;
    if (!timing.shown && document.querySelector('.cm-tooltip-autocomplete')) {
      timing.shown = performance.now();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})()`;

/** Milliseconds from the last keystroke to the completion list (-1 when it was not shown). */
const COMPLETION_LATENCY = `(() => {
  const timing = window.__mfbeCompletionTiming;
  return timing && timing.shown ? timing.shown - timing.lastKey : -1;
})()`;

function median(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

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
    // The book, not the new document the editor starts with.
    await waitForBook(page, book, EDITABLE_BUDGET_MS * 4);
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
    const typical = median(samples);
    test.info().annotations.push({
      type: 'perf',
      description: `keystroke latency median ${typical.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`,
    });
    expect(
      typical,
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

  test('Source view: the completion list appears within 300 ms and typing stays under 100 ms', async ({
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

    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, book, EDITABLE_BUDGET_MS * 4);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true', {
      timeout: EDITABLE_BUDGET_MS * 4,
    });

    // The whole 10 MB serialisation in the Source view; the cursor in the last section.
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    const content = page.locator('.mfbe-source-editor .cm-content');
    await content.click();
    await page.keyboard.press(`${MOD}+End`);
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowUp');
    await page.keyboard.press(LINE_START);
    const activeLine = page.locator('.mfbe-source-editor .cm-activeLine').first();
    await expect(activeLine).toContainText('</section>');
    // A line of its own before the closing tag of the last section.
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press(LINE_END);

    // The list after `<sec` (section is offered whether or not the parser has reached here).
    const list = page.locator('.cm-tooltip-autocomplete');
    await page.evaluate(INSTALL_COMPLETION_TIMER);
    await page.keyboard.type('<sec');
    await expect(list).toBeVisible({ timeout: 5_000 });
    await expect(list.locator('li[role="option"]')).toContainText(['section']);
    const listAfterMs = await page.evaluate<number>(COMPLETION_LATENCY);
    test.info().annotations.push({
      type: 'perf',
      description: `completion list after ${listAfterMs.toFixed(0)} ms`,
    });
    expect(listAfterMs, 'time from the last keystroke to the list').toBeGreaterThan(0);
    expect(listAfterMs, 'time from the last keystroke to the list').toBeLessThanOrEqual(
      COMPLETION_LIST_BUDGET_MS,
    );

    // Keystrokes with the list open (`tion` keeps filtering it) and after the space closed it.
    const samples: number[] = [];
    for (const character of 'tion') {
      samples.push(await page.evaluate<number>(typeAndMeasure(character)));
    }
    await expect(list.locator('li[role="option"]')).toHaveText(['section']);
    for (const character of ' id="x"') {
      samples.push(await page.evaluate<number>(typeAndMeasure(character)));
    }
    await expect(list).toHaveCount(0);
    const typical = median(samples);
    test.info().annotations.push({
      type: 'perf',
      description: `Source keystroke latency median ${typical.toFixed(1)} ms, worst ${Math.max(...samples).toFixed(1)} ms`,
    });
    expect(
      typical,
      `Source keystroke latencies ${samples.map((s) => s.toFixed(0)).join(', ')} ms`,
    ).toBeLessThan(KEYSTROKE_BUDGET_MS);
    await expect(activeLine).toContainText('<section id="x"');
    await expect(page).toHaveTitle(/^large\.fb2\* - /);
  });

  test(
    'Body <-> Source switches: the caret mapping adds under 100 ms (feature 004 US7, FR-073)',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.skip(!book || !existsSync(book), 'python3 / the generator are not available');
      const supportsDocuments = await core
        .rpc('doc.recent')
        .then(() => true)
        .catch((error: RpcCallError) => error.code !== -32601);
      test.skip(!supportsDocuments, 'the core does not implement doc.* yet');

      await core.openApp(page);
      await expect(page.getByTestId('status-message')).toHaveText('Ready');
      await core.enqueueDialog('dialog.openFile', { paths: [book] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, book, EDITABLE_BUDGET_MS * 4);
      const editor = page.getByTestId('body-editor');
      await expect(editor).toHaveAttribute('contenteditable', 'true', {
        timeout: EDITABLE_BUDGET_MS * 4,
      });
      // The caret deep in a mounted paragraph: the position the switches carry back and forth.
      await editor
        .locator('.fb-section p.fb-p')
        .nth(3)
        .click({ position: { x: 40, y: 8 } });
      await expect(page.getByTestId('status-path')).toContainText('/p[');

      // Warm-up: the first Source visit serialises the 10 MB text and builds the editor state.
      await page.getByTestId('view-source').click();
      await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready', {
        timeout: 60_000,
      });
      await page.getByTestId('view-body').click();
      await expect(editor).toBeVisible();

      const setMapping = (enabled: boolean) =>
        page.evaluate(`window.__mfbeTest.sourceMapping.enabled = ${enabled ? 'true' : 'false'}`);
      const roundTrip = async (): Promise<number> => {
        const toSource = await page.evaluate<number>(switchTimed('source'));
        const toBody = await page.evaluate<number>(switchTimed('body'));
        return toSource + toBody;
      };
      const on: number[] = [];
      const off: number[] = [];
      const coreTimes: number[] = [];
      for (let i = 0; i < MAPPING_ROUND_TRIPS; i += 1) {
        await setMapping(true);
        on.push(await roundTrip());
        // The core's time of the last of the two doc.mapPositions calls of the round trip.
        coreTimes.push(await page.evaluate<number>(LAST_MAPPING_MS));
        await setMapping(false);
        off.push(await roundTrip());
      }
      await setMapping(true);
      const mappingMs = median(on) - median(off);
      test.info().annotations.push({
        type: 'perf',
        description:
          `Body <-> Source round trip median ${median(on).toFixed(0)} ms with the mapping, ` +
          `${median(off).toFixed(0)} ms without: mapping step ${mappingMs.toFixed(0)} ms ` +
          `(on ${on.map((t) => t.toFixed(0)).join(', ')}; off ${off.map((t) => t.toFixed(0)).join(', ')}); ` +
          `doc.mapPositions in the core ${coreTimes.map((t) => t.toFixed(1)).join(', ')} ms`,
      });
      expect(mappingMs, 'the mapping step (median with minus median without)').toBeLessThan(
        MAPPING_BUDGET_MS * PERF_FACTOR,
      );
      for (const coreMs of coreTimes) {
        expect(coreMs, 'doc.mapPositions was called and timed').toBeGreaterThanOrEqual(0);
        expect(coreMs, 'doc.mapPositions in the core').toBeLessThan(MAPPING_BUDGET_MS);
      }
      // The caret came back to its paragraph after every round trip.
      await expect(page.getByTestId('status-path')).toContainText('/p[');
    },
  );
});
